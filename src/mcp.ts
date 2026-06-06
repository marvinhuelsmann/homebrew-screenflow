#!/usr/bin/env node
// screenflow MCP server — exposes screenflow's device-framing capabilities as
// Model Context Protocol tools so AI agents (Claude Code, Codex, Cursor, …) can
// frame screenshots, build App Store screenshots and wrap screen recordings on
// the user's behalf. Communicates over stdio: nothing is written to stdout
// except the MCP protocol itself (all helpers used here are side-effect-free).

import path from 'path';
import fs from 'fs';
import os from 'os';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { version } from '../package.json';
import { compose, DEVICES, Format } from './composer';
import { FRAMES, DEFAULT_DEVICE, getDefaultColor, getFrameColors } from './frames';
import { composeStaticVideo } from './video-compose';
import { probeVideo, ffmpegAvailable, detectInputKind } from './ffmpeg';
import { renderAppStore, APPSTORE_SIZE } from './commands/appstore';

// Resolve device/color to concrete ids, falling back to sensible defaults.
function resolveDeviceColor(device?: string, color?: string): { device: string; color: string } {
  const d = (device ?? DEFAULT_DEVICE).toLowerCase().trim();
  if (!(d in FRAMES)) {
    throw new Error(`Unknown device "${device}". Available: ${DEVICES.join(', ')}`);
  }
  const c = (color ?? getDefaultColor(d)).toLowerCase().trim();
  if (!(c in FRAMES[d].colors)) {
    throw new Error(`Unknown color "${color}" for ${d}. Available: ${getFrameColors(d).join(', ')}`);
  }
  return { device: d, color: c };
}

function defaultOutput(inputPath: string, suffix: string, ext: string): string {
  const dir = path.dirname(inputPath);
  const base = path.basename(inputPath, path.extname(inputPath));
  return path.join(dir, `${base}_${suffix}${ext}`);
}

type ContentItem =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

const ok = (text: string) => ({ content: [{ type: 'text' as const, text }] });
const fail = (text: string) => ({ content: [{ type: 'text' as const, text }], isError: true });

// Resolve an input given EITHER inline base64 data OR a filesystem path. base64
// makes the tool work across environment boundaries (sandboxed/containerised
// agents whose filesystem the MCP server can't see) — the data travels in the
// call instead of relying on a shared path.
function resolveInput(
  inputPath: string | undefined,
  inputBase64: string | undefined,
  ext: string,
): { path: string; cleanup: () => void; inline: boolean } {
  if (inputBase64) {
    const b64 = inputBase64.replace(/^data:[^;]+;base64,/, '');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'screenflow-in-'));
    const p = path.join(dir, `input${ext}`);
    fs.writeFileSync(p, Buffer.from(b64, 'base64'));
    return { path: p, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }), inline: true };
  }
  if (inputPath) {
    return { path: path.resolve(inputPath), cleanup: () => {}, inline: false };
  }
  throw new Error('Provide either input_path (a file on this machine) or input_base64 (the file contents).');
}

// Read a produced still and return it as inline MCP content: an image block for
// PNG/JPEG (so the agent receives the bytes even without a shared filesystem),
// or text for SVG.
function stillContent(filePath: string, fmt: Format): ContentItem {
  if (fmt === 'svg') return { type: 'text', text: fs.readFileSync(filePath, 'utf8') };
  return {
    type: 'image',
    data: fs.readFileSync(filePath).toString('base64'),
    mimeType: fmt === 'jpeg' ? 'image/jpeg' : 'image/png',
  };
}

const server = new McpServer({ name: 'screenflow', version });

// Thin wrapper around registerTool. The SDK's generic overload + zod shape
// triggers TS2589 ("excessively deep") at our call sites; isolating the cast
// here keeps the four registrations below clean and type-checked at runtime.
type ToolResult = { content: ContentItem[]; isError?: boolean };
type ToolConfig = { title: string; description: string; inputSchema: z.ZodRawShape };
function tool(name: string, config: ToolConfig, handler: (args: any) => Promise<ToolResult>): void {
  (server.registerTool as (n: string, c: ToolConfig, h: (a: any) => Promise<ToolResult>) => void)(name, config, handler);
}

// ── list_devices ─────────────────────────────────────────────────────────────
tool(
  'list_devices',
  {
    title: 'List device frames',
    description:
      'List every available device frame and its colors. Call this first when you need to pick a device or color for framing a screenshot/recording or building an App Store screenshot.',
    inputSchema: {},
  },
  async () => {
    const lines = DEVICES.map(d => `- ${d}: ${getFrameColors(d).join(', ')}`);
    const text = [
      `Default device: ${DEFAULT_DEVICE}`,
      `App Store screenshot size: ${APPSTORE_SIZE.w}×${APPSTORE_SIZE.h} (iPhone 6.5")`,
      '',
      'Available devices and colors:',
      ...lines,
    ].join('\n');
    return ok(text);
  },
);

// ── frame_screenshot ─────────────────────────────────────────────────────────
tool(
  'frame_screenshot',
  {
    title: 'Frame a screenshot in a device mockup',
    description:
      'Wrap a still screenshot (PNG/JPG/HEIC) in a pixel-perfect device frame (iPhone, iPad, iMac, Apple Watch). Use this whenever the user wants an app screenshot placed inside a realistic device mockup. Pass the image as input_base64 (recommended — works everywhere) or input_path (only if this server shares the agent\'s filesystem). The framed image is returned inline; output_path additionally saves it to disk. Output is PNG by default; use format "svg" for vector or "jpeg" for a smaller file.',
    inputSchema: {
      input_base64: z.string().optional().describe('The screenshot file contents, base64-encoded (data: URI prefix is OK). Preferred — works without a shared filesystem.'),
      input_path: z.string().optional().describe('Path to the screenshot on THIS machine. Only works if the server shares the agent\'s filesystem.'),
      device: z.string().optional().describe(`Device frame id (default ${DEFAULT_DEVICE}). Use list_devices to see options.`),
      color: z.string().optional().describe('Frame color for the device (default: first color of the device).'),
      format: z.enum(['png', 'svg', 'jpeg']).optional().describe('Output format (default png).'),
      output_path: z.string().optional().describe('Optional path to also save the result on this machine.'),
    },
  },
  async ({ input_base64, input_path, device, color, format, output_path }) => {
    let input: { path: string; cleanup: () => void; inline: boolean } | undefined;
    let outTmp: string | undefined;
    try {
      const fmt: Format = format ?? 'png';
      const ext = fmt === 'svg' ? '.svg' : fmt === 'jpeg' ? '.jpeg' : '.png';
      input = resolveInput(input_path, input_base64, '.png');
      if (detectInputKind(input.path) === 'video') {
        return fail('frame_screenshot is for still images. For a screen recording use frame_recording.');
      }
      const resolved = resolveDeviceColor(device, color);

      // Decide where to write: explicit path, next to a real input, or a temp file.
      let outputPath: string;
      if (output_path) outputPath = path.resolve(output_path);
      else if (!input.inline) outputPath = defaultOutput(input.path, `${resolved.device}_${resolved.color}`, ext);
      else { outTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'screenflow-out-')); outputPath = path.join(outTmp, `framed${ext}`); }

      await compose(input.path, resolved.device, outputPath, fmt, resolved.color);

      const saved = output_path || !input.inline ? `Saved to ${outputPath}. ` : '';
      return {
        content: [
          { type: 'text', text: `${saved}Framed ${resolved.device} · ${resolved.color} · ${fmt.toUpperCase()}.` },
          stillContent(outputPath, fmt),
        ],
      };
    } catch (err) {
      return fail(`frame_screenshot failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      input?.cleanup();
      if (outTmp) fs.rmSync(outTmp, { recursive: true, force: true });
    }
  },
);

// ── frame_recording ──────────────────────────────────────────────────────────
tool(
  'frame_recording',
  {
    title: 'Frame a screen recording in a device mockup',
    description:
      'Wrap a screen recording (MP4/MOV/…) in a device frame: the device stays still while the screen plays the recording. Output length matches the recording. Defaults to a transparent .mov (HEVC with alpha, ~90× smaller than ProRes, plays in QuickTime/Keynote/Final Cut); set format "mp4" for H.264 on a black background. Pass the recording as input_base64 or input_path. Requires ffmpeg. Note: results can be large — provide output_path to save to disk; without it the result is returned inline as base64 only when small (<40 MB).',
    inputSchema: {
      input_base64: z.string().optional().describe('The recording file contents, base64-encoded. Works without a shared filesystem.'),
      input_path: z.string().optional().describe('Path to the recording on THIS machine (MP4/MOV/M4V/WEBM/MKV/AVI).'),
      device: z.string().optional().describe(`Device frame id (default ${DEFAULT_DEVICE}).`),
      color: z.string().optional().describe('Frame color for the device.'),
      format: z.enum(['mov', 'mp4']).optional().describe('mov = transparent HEVC (default); mp4 = H.264 on black.'),
      mute: z.boolean().optional().describe('Drop the audio track (default false).'),
      output_path: z.string().optional().describe('Optional path to save the result on this machine.'),
    },
  },
  async ({ input_base64, input_path, device, color, format, mute, output_path }) => {
    let input: { path: string; cleanup: () => void; inline: boolean } | undefined;
    let outTmp: string | undefined;
    try {
      if (!ffmpegAvailable()) {
        return fail('ffmpeg is required for screen recordings but was not found. Install it with: brew install ffmpeg');
      }
      const ext = format === 'mp4' ? '.mp4' : '.mov';
      input = resolveInput(input_path, input_base64, '.mp4');
      if (detectInputKind(input.path) !== 'video') {
        return fail('frame_recording is for screen recordings. For a still image use frame_screenshot.');
      }
      const resolved = resolveDeviceColor(device, color);

      let outputPath: string;
      if (output_path) outputPath = path.resolve(output_path);
      else if (!input.inline) outputPath = defaultOutput(input.path, `${resolved.device}_${resolved.color}`, ext);
      else { outTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'screenflow-out-')); outputPath = path.join(outTmp, `framed${ext}`); }

      const info = probeVideo(input.path);
      const { exitCode, stderr } = await composeStaticVideo({
        inputPath: input.path, device: resolved.device, color: resolved.color, outputPath, info, mute: Boolean(mute),
      });
      if (exitCode !== 0) return fail(`ffmpeg failed:\n${stderr}`);
      const kind = ext === '.mov' ? 'transparent MOV · HEVC' : 'MP4 · H.264';

      // Persisted to a real path → just report it. Inline (base64) input with no
      // output_path → return the bytes if small enough, else ask for a path.
      if (output_path || !input.inline) {
        return ok(`Framed recording saved to ${outputPath} (${resolved.device} · ${resolved.color} · ${kind}).`);
      }
      const size = fs.statSync(outputPath).size;
      if (size > 40 * 1024 * 1024) {
        return fail(`Framed recording is ${(size / 1048576).toFixed(0)} MB — too large to return inline. Pass output_path to save it to disk instead.`);
      }
      const mime = ext === '.mov' ? 'video/quicktime' : 'video/mp4';
      const data = fs.readFileSync(outputPath).toString('base64');
      return {
        content: [
          { type: 'text', text: `Framed recording (${resolved.device} · ${resolved.color} · ${kind}). Base64 ${mime} data URI follows.` },
          { type: 'text', text: `data:${mime};base64,${data}` },
        ],
      };
    } catch (err) {
      return fail(`frame_recording failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      input?.cleanup();
      if (outTmp) fs.rmSync(outTmp, { recursive: true, force: true });
    }
  },
);

// ── create_appstore_screenshot ───────────────────────────────────────────────
tool(
  'create_appstore_screenshot',
  {
    title: 'Create an App Store screenshot',
    description:
      `Turn a screenshot into a ready-to-upload App Store screenshot at the mandatory ${APPSTORE_SIZE.w}×${APPSTORE_SIZE.h} (iPhone 6.5") size: a headline caption on top (SF Pro Display, auto-contrast color), the framed device below, on a solid background. Use this when the user wants App Store / marketing screenshots with a tagline. Pass the image as input_base64 (recommended) or input_path; the result is returned inline, and output_path additionally saves it.`,
    inputSchema: {
      input_base64: z.string().optional().describe('The screenshot file contents, base64-encoded (data: URI prefix is OK). Preferred — works without a shared filesystem.'),
      input_path: z.string().optional().describe('Path to the screenshot on THIS machine. Only works if the server shares the agent\'s filesystem.'),
      caption: z.string().optional().describe('Headline text above the device. Use "\\n" for a manual line break.'),
      align: z.enum(['left', 'center', 'right']).optional().describe('Caption alignment (default center).'),
      bg: z.string().optional().describe('Background color as hex, e.g. "#0A84FF" (default #0A84FF).'),
      device: z.string().optional().describe(`Device frame id (default ${DEFAULT_DEVICE}).`),
      color: z.string().optional().describe('Frame color for the device.'),
      jpeg: z.boolean().optional().describe('Output JPEG instead of PNG (default false).'),
      output_path: z.string().optional().describe('Optional path to also save the result on this machine.'),
    },
  },
  async ({ input_base64, input_path, caption, align, bg, device, color, jpeg, output_path }) => {
    let input: { path: string; cleanup: () => void; inline: boolean } | undefined;
    let outTmp: string | undefined;
    try {
      input = resolveInput(input_path, input_base64, '.png');
      const resolved = resolveDeviceColor(device, color);
      const ext = jpeg ? '.jpg' : '.png';

      let outputPath: string;
      if (output_path) outputPath = path.resolve(output_path);
      else if (!input.inline) outputPath = defaultOutput(input.path, `${resolved.device}_appstore`, ext);
      else { outTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'screenflow-out-')); outputPath = path.join(outTmp, `appstore${ext}`); }

      const res = await renderAppStore({
        inputPath: input.path, device: resolved.device, color: resolved.color,
        caption, align, bg, outputPath, jpeg,
      });
      const saved = output_path || !input.inline ? `Saved to ${res.outputPath}. ` : '';
      return {
        content: [
          { type: 'text', text: `${saved}App Store screenshot ${res.width}×${res.height} (${resolved.device} · ${resolved.color}).` },
          stillContent(outputPath, jpeg ? 'jpeg' : 'png'),
        ],
      };
    } catch (err) {
      return fail(`create_appstore_screenshot failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      input?.cleanup();
      if (outTmp) fs.rmSync(outTmp, { recursive: true, force: true });
    }
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(err => {
  // stderr is safe — stdout is reserved for the MCP protocol.
  console.error('screenflow MCP server failed to start:', err);
  process.exit(1);
});
