#!/usr/bin/env node
// screenflow MCP server — exposes screenflow's device-framing capabilities as
// Model Context Protocol tools so AI agents (Claude Code, Codex, Cursor, …) can
// frame screenshots, build App Store screenshots and wrap screen recordings on
// the user's behalf. Communicates over stdio: nothing is written to stdout
// except the MCP protocol itself (all helpers used here are side-effect-free).

import path from 'path';
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

const ok = (text: string) => ({ content: [{ type: 'text' as const, text }] });
const fail = (text: string) => ({ content: [{ type: 'text' as const, text }], isError: true });

const server = new McpServer({ name: 'screenflow', version });

// Thin wrapper around registerTool. The SDK's generic overload + zod shape
// triggers TS2589 ("excessively deep") at our call sites; isolating the cast
// here keeps the four registrations below clean and type-checked at runtime.
type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };
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
      'Wrap a still screenshot (PNG/JPG/HEIC) in a pixel-perfect device frame (iPhone, iPad, iMac, Apple Watch). Use this whenever the user wants an app screenshot placed inside a realistic device mockup. Output is PNG by default (transparent around the device); use format "svg" for vector or "jpeg" for a smaller file.',
    inputSchema: {
      input_path: z.string().describe('Absolute path to the screenshot (PNG/JPG/HEIC).'),
      device: z.string().optional().describe(`Device frame id (default ${DEFAULT_DEVICE}). Use list_devices to see options.`),
      color: z.string().optional().describe('Frame color for the device (default: first color of the device).'),
      format: z.enum(['png', 'svg', 'jpeg']).optional().describe('Output format (default png).'),
      output_path: z.string().optional().describe('Absolute output path. Defaults next to the input.'),
    },
  },
  async ({ input_path, device, color, format, output_path }) => {
    try {
      const inputPath = path.resolve(input_path);
      if (detectInputKind(inputPath) === 'video') {
        return fail('frame_screenshot is for still images. For a screen recording use frame_recording.');
      }
      const resolved = resolveDeviceColor(device, color);
      const fmt: Format = format ?? 'png';
      const ext = fmt === 'svg' ? '.svg' : fmt === 'jpeg' ? '.jpeg' : '.png';
      const outputPath = output_path
        ? path.resolve(output_path)
        : defaultOutput(inputPath, `${resolved.device}_${resolved.color}`, ext);
      await compose(inputPath, resolved.device, outputPath, fmt, resolved.color);
      return ok(`Framed screenshot saved to ${outputPath} (${resolved.device} · ${resolved.color} · ${fmt.toUpperCase()}).`);
    } catch (err) {
      return fail(`frame_screenshot failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

// ── frame_recording ──────────────────────────────────────────────────────────
tool(
  'frame_recording',
  {
    title: 'Frame a screen recording in a device mockup',
    description:
      'Wrap a screen recording (MP4/MOV/…) in a device frame: the device stays still while the screen plays the recording. Output length matches the recording. Defaults to a transparent .mov (HEVC with alpha, ~90× smaller than ProRes, plays in QuickTime/Keynote/Final Cut); set format "mp4" for H.264 on a black background. Requires ffmpeg.',
    inputSchema: {
      input_path: z.string().describe('Absolute path to the screen recording (MP4/MOV/M4V/WEBM/MKV/AVI).'),
      device: z.string().optional().describe(`Device frame id (default ${DEFAULT_DEVICE}).`),
      color: z.string().optional().describe('Frame color for the device.'),
      format: z.enum(['mov', 'mp4']).optional().describe('mov = transparent HEVC (default); mp4 = H.264 on black.'),
      mute: z.boolean().optional().describe('Drop the audio track (default false).'),
      output_path: z.string().optional().describe('Absolute output path. Defaults next to the input.'),
    },
  },
  async ({ input_path, device, color, format, mute, output_path }) => {
    try {
      if (!ffmpegAvailable()) {
        return fail('ffmpeg is required for screen recordings but was not found. Install it with: brew install ffmpeg');
      }
      const inputPath = path.resolve(input_path);
      if (detectInputKind(inputPath) !== 'video') {
        return fail('frame_recording is for screen recordings. For a still image use frame_screenshot.');
      }
      const resolved = resolveDeviceColor(device, color);
      const ext = format === 'mp4' ? '.mp4' : '.mov';
      const outputPath = output_path
        ? path.resolve(output_path)
        : defaultOutput(inputPath, `${resolved.device}_${resolved.color}`, ext);
      const info = probeVideo(inputPath);
      const { exitCode, stderr } = await composeStaticVideo({
        inputPath, device: resolved.device, color: resolved.color, outputPath, info, mute: Boolean(mute),
      });
      if (exitCode !== 0) return fail(`ffmpeg failed:\n${stderr}`);
      const kind = ext === '.mov' ? 'transparent MOV · HEVC' : 'MP4 · H.264';
      return ok(`Framed recording saved to ${outputPath} (${resolved.device} · ${resolved.color} · ${kind}).`);
    } catch (err) {
      return fail(`frame_recording failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

// ── create_appstore_screenshot ───────────────────────────────────────────────
tool(
  'create_appstore_screenshot',
  {
    title: 'Create an App Store screenshot',
    description:
      `Turn a screenshot into a ready-to-upload App Store screenshot at the mandatory ${APPSTORE_SIZE.w}×${APPSTORE_SIZE.h} (iPhone 6.5") size: a headline caption on top (SF Pro Display, auto-contrast color), the framed device below, on a solid background. Use this when the user wants App Store / marketing screenshots with a tagline.`,
    inputSchema: {
      input_path: z.string().describe('Absolute path to the screenshot (PNG/JPG/HEIC).'),
      caption: z.string().optional().describe('Headline text above the device. Use "\\n" for a manual line break.'),
      align: z.enum(['left', 'center', 'right']).optional().describe('Caption alignment (default center).'),
      bg: z.string().optional().describe('Background color as hex, e.g. "#0A84FF" (default #0A84FF).'),
      device: z.string().optional().describe(`Device frame id (default ${DEFAULT_DEVICE}).`),
      color: z.string().optional().describe('Frame color for the device.'),
      jpeg: z.boolean().optional().describe('Output JPEG instead of PNG (default false).'),
      output_path: z.string().optional().describe('Absolute output path. Defaults next to the input.'),
    },
  },
  async ({ input_path, caption, align, bg, device, color, jpeg, output_path }) => {
    try {
      const inputPath = path.resolve(input_path);
      const resolved = resolveDeviceColor(device, color);
      const ext = jpeg ? '.jpg' : '.png';
      const outputPath = output_path
        ? path.resolve(output_path)
        : defaultOutput(inputPath, `${resolved.device}_appstore`, ext);
      const res = await renderAppStore({
        inputPath, device: resolved.device, color: resolved.color,
        caption, align, bg, outputPath, jpeg,
      });
      return ok(`App Store screenshot saved to ${res.outputPath} (${res.width}×${res.height}, ${resolved.device} · ${resolved.color}).`);
    } catch (err) {
      return fail(`create_appstore_screenshot failed: ${err instanceof Error ? err.message : String(err)}`);
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
