#!/usr/bin/env node
// screenflow MCP server — exposes screenflow's device-framing capabilities as
// Model Context Protocol tools so AI agents (Claude Code, Codex, Cursor, …) can
// frame screenshots, build App Store screenshots and wrap screen recordings on
// the user's behalf. Communicates over stdio: nothing is written to stdout
// except the MCP protocol itself (all helpers used here are side-effect-free).

import path from 'path';
import fs from 'fs';
import os from 'os';
import sharp from 'sharp';
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

// Resolve an input given ONE of: inline base64 data, a URL, or a filesystem
// path. base64/URL make the tool work across environment boundaries (sandboxed
// or containerised agents whose filesystem the MCP server can't see) — the data
// travels in the call instead of relying on a shared path.
async function resolveInput(opts: {
  inputBase64?: string;
  inputUrl?: string;
  inputPath?: string;
  ext: string;
}): Promise<{ path: string; cleanup: () => void; inline: boolean }> {
  const { inputBase64, inputUrl, inputPath, ext } = opts;

  if (inputBase64) {
    const b64 = inputBase64.replace(/^data:[^;]+;base64,/, '');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'screenflow-in-'));
    const p = path.join(dir, `input${ext}`);
    fs.writeFileSync(p, Buffer.from(b64, 'base64'));
    return { path: p, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }), inline: true };
  }

  if (inputUrl) {
    const res = await fetch(inputUrl);
    if (!res.ok) throw new Error(`Could not download input_url (${res.status} ${res.statusText}).`);
    const buf = Buffer.from(await res.arrayBuffer());
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'screenflow-in-'));
    const p = path.join(dir, `input${ext}`);
    fs.writeFileSync(p, buf);
    return { path: p, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }), inline: true };
  }

  if (inputPath) {
    const resolved = path.resolve(inputPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(
        `No file at "${resolved}". Do NOT guess paths. If the image was uploaded/attached (not a real file on the user's machine), pass it as input_base64 (the file's raw bytes, base64-encoded) or input_url instead. If it is a local file, ask the user for its exact path.`,
      );
    }
    return { path: resolved, cleanup: () => {}, inline: false };
  }

  throw new Error(
    'No input given. Provide exactly one of: input_base64 (preferred — the file bytes, base64-encoded), input_url (a public URL), or input_path (an existing file on the user\'s machine).',
  );
}

// Return a produced still as inline MCP content. PNG/JPEG are downscaled to a
// max long edge (default 1568px — the size vision models use anyway) so the
// response stays small and fast; the full-resolution file is still written to
// output_path. SVG is returned as text. maxPx = 0 keeps the original size.
async function stillContent(filePath: string, fmt: Format, maxPx = 1568): Promise<ContentItem> {
  if (fmt === 'svg') return { type: 'text', text: fs.readFileSync(filePath, 'utf8') };

  let img = sharp(filePath);
  if (maxPx > 0) {
    const meta = await img.metadata();
    const long = Math.max(meta.width ?? 0, meta.height ?? 0);
    if (long > maxPx) img = img.resize({ width: maxPx, height: maxPx, fit: 'inside' });
  }
  const buf = fmt === 'jpeg'
    ? await img.jpeg({ quality: 85 }).toBuffer()
    : await img.png({ compressionLevel: 9 }).toBuffer();
  return {
    type: 'image',
    data: buf.toString('base64'),
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
      'Wrap a still screenshot (PNG/JPG/HEIC) in a pixel-perfect device frame (iPhone, iPad, iMac, Apple Watch). The framed image is returned INLINE (downscaled preview; full resolution goes to output_path). ' +
      'HOW TO PASS THE IMAGE — in order of preference: (1) input_path = path to a real EXISTING file on the machine running this server — FASTEST, use this whenever you have a real local path (e.g. you are an agent on the same computer); (2) input_url = a public http(s) URL the server downloads; (3) input_base64 = the raw bytes base64-encoded — works anywhere but is SLOW and expensive for files over ~500 KB (you must emit the whole blob), so only use it when no path or URL is available. Never invent a path you have not verified.',
    inputSchema: {
      input_path: z.string().optional().describe('Path to a real EXISTING screenshot on the machine running this server. Fastest — prefer this when you have a real local path.'),
      input_url: z.string().optional().describe('Public http(s) URL of the screenshot; the server downloads it. Fast.'),
      input_base64: z.string().optional().describe('The screenshot bytes, base64-encoded (data: URI prefix OK). Works anywhere but SLOW for large files — last resort.'),
      device: z.string().optional().describe(`Device frame id (default ${DEFAULT_DEVICE}). Use list_devices to see options.`),
      color: z.string().optional().describe('Frame color for the device (default: first color of the device).'),
      format: z.enum(['png', 'svg', 'jpeg']).optional().describe('Output format (default png).'),
      output_path: z.string().optional().describe('Optional path to save the FULL-resolution result on the server machine.'),
      inline_max_px: z.number().optional().describe('Max long edge of the inline preview image (default 1568; 0 = full resolution inline).'),
    },
  },
  async ({ input_base64, input_url, input_path, device, color, format, output_path, inline_max_px }) => {
    let input: { path: string; cleanup: () => void; inline: boolean } | undefined;
    let outTmp: string | undefined;
    try {
      const fmt: Format = format ?? 'png';
      const ext = fmt === 'svg' ? '.svg' : fmt === 'jpeg' ? '.jpeg' : '.png';
      input = await resolveInput({ inputBase64: input_base64, inputUrl: input_url, inputPath: input_path, ext: '.png' });
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
          await stillContent(outputPath, fmt, inline_max_px ?? 1568),
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
      'Wrap a screen recording (MP4/MOV/…) in a device frame: the device stays still while the screen plays the recording. Output length matches the recording. Defaults to a transparent .mov (HEVC with alpha, ~90× smaller than ProRes, plays in QuickTime/Keynote/Final Cut); set format "mp4" for H.264 on a black background. ' +
      'HOW TO PASS THE RECORDING — pick one: input_base64 (raw bytes, base64), input_url (public URL), or input_path (an EXISTING local file). Never invent a path. Requires ffmpeg. ' +
      'Videos are large: pass output_path to save to disk; without it the result is returned inline (base64) only when under 40 MB.',
    inputSchema: {
      input_base64: z.string().optional().describe('The recording bytes, base64-encoded. Works without a shared filesystem.'),
      input_url: z.string().optional().describe('Public http(s) URL of the recording; the server downloads it.'),
      input_path: z.string().optional().describe('Path to an EXISTING recording on the server machine (MP4/MOV/M4V/WEBM/MKV/AVI).'),
      device: z.string().optional().describe(`Device frame id (default ${DEFAULT_DEVICE}).`),
      color: z.string().optional().describe('Frame color for the device.'),
      format: z.enum(['mov', 'mp4']).optional().describe('mov = transparent HEVC (default); mp4 = H.264 on black.'),
      mute: z.boolean().optional().describe('Drop the audio track (default false).'),
      output_path: z.string().optional().describe('Optional path to save the result on the server machine.'),
    },
  },
  async ({ input_base64, input_url, input_path, device, color, format, mute, output_path }) => {
    let input: { path: string; cleanup: () => void; inline: boolean } | undefined;
    let outTmp: string | undefined;
    try {
      if (!ffmpegAvailable()) {
        return fail('ffmpeg is required for screen recordings but was not found. Install it with: brew install ffmpeg');
      }
      const ext = format === 'mp4' ? '.mp4' : '.mov';
      input = await resolveInput({ inputBase64: input_base64, inputUrl: input_url, inputPath: input_path, ext: '.mp4' });
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
      `Turn a screenshot into a ready-to-upload App Store screenshot at the mandatory ${APPSTORE_SIZE.w}×${APPSTORE_SIZE.h} (iPhone 6.5") size: a headline caption on top (SF Pro Display, auto-contrast color), the framed device below, on a solid background. The result is returned INLINE (downscaled preview; full resolution goes to output_path). ` +
      'HOW TO PASS THE IMAGE — in order of preference: input_path (a real EXISTING local file — FASTEST), input_url (public URL), or input_base64 (raw bytes — works anywhere but SLOW for large files, last resort). Never invent a path.',
    inputSchema: {
      input_path: z.string().optional().describe('Path to a real EXISTING screenshot on the server machine. Fastest — prefer this.'),
      input_url: z.string().optional().describe('Public http(s) URL of the screenshot; the server downloads it. Fast.'),
      input_base64: z.string().optional().describe('The screenshot bytes, base64-encoded (data: URI prefix OK). Works anywhere but SLOW for large files — last resort.'),
      caption: z.string().optional().describe('Headline text above the device. Use "\\n" for a manual line break.'),
      align: z.enum(['left', 'center', 'right']).optional().describe('Caption alignment (default center).'),
      bg: z.string().optional().describe('Background color as hex, e.g. "#0A84FF" (default #0A84FF).'),
      device: z.string().optional().describe(`Device frame id (default ${DEFAULT_DEVICE}).`),
      color: z.string().optional().describe('Frame color for the device.'),
      jpeg: z.boolean().optional().describe('Output JPEG instead of PNG (default false).'),
      output_path: z.string().optional().describe('Optional path to save the FULL-resolution result on the server machine.'),
      inline_max_px: z.number().optional().describe('Max long edge of the inline preview (default 1568; 0 = full resolution inline).'),
    },
  },
  async ({ input_base64, input_url, input_path, caption, align, bg, device, color, jpeg, output_path, inline_max_px }) => {
    let input: { path: string; cleanup: () => void; inline: boolean } | undefined;
    let outTmp: string | undefined;
    try {
      input = await resolveInput({ inputBase64: input_base64, inputUrl: input_url, inputPath: input_path, ext: '.png' });
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
          await stillContent(outputPath, jpeg ? 'jpeg' : 'png', inline_max_px ?? 1568),
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
