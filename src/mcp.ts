#!/usr/bin/env node
// screenflow MCP server — exposes screenflow's device-framing capabilities as
// Model Context Protocol tools so AI agents (Claude Code, Codex, Cursor, …) can
// frame screenshots, build App Store screenshots and wrap screen recordings on
// the user's behalf. Communicates over stdio: nothing is written to stdout
// except the MCP protocol itself (all helpers used here are side-effect-free).

import path from 'path';
import fs from 'fs';
import os from 'os';
import { execSync } from 'child_process';
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
    // LLMs silently truncate large verbatim strings in tool calls, producing corrupt files.
    // Hard-reject anything over ~150 KB of decoded data; callers must use find_recent_files
    // or get_clipboard_path to get a real path instead.
    const decodedBytes = Math.floor(b64.length * 0.75);
    if (decodedBytes > 150_000) {
      throw new Error(
        `input_base64 rejected: the encoded data is ~${Math.round(decodedBytes / 1024)} KB — too large. ` +
        `LLMs truncate large base64 strings, which corrupts the file. ` +
        `Instead: (1) call find_recent_files() to locate the file by path, then use input_path; ` +
        `or (2) call get_clipboard_path() if the user copied the file in Finder; ` +
        `or (3) use input_url if the file is at a public URL.`,
      );
    }
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
    'No input given. Best approach: call find_recent_files() to locate the file by path, then pass it as input_path. ' +
    'Alternatively: input_url for a public URL, or input_path if you already know the real filesystem path. ' +
    'input_base64 is only accepted for small files (< ~150 KB).',
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

// ── write_temp_file ──────────────────────────────────────────────────────────
// Chunked file ingestion so large images and recordings from Claude Desktop
// (or other MCP clients that can't resolve local paths) can be transferred to
// the server without hitting per-call base64 size limits.  Typical flow:
//   1. handle = write_temp_file(chunk=first_500k_b64, ext=".png")
//   2. handle = write_temp_file(chunk=next_500k_b64, handle=handle)
//   3. path   = write_temp_file(chunk=last_b64, handle=handle, done=true)
//   4. frame_screenshot(input_path=path)
tool(
  'write_temp_file',
  {
    title: 'Write large file to temp path for processing',
    description:
      'Write a file to a temporary path on the server machine so it can be used as input_path in frame_screenshot, frame_recording, or create_appstore_screenshot. ' +
      'For large files (images > ~500 KB, any video) split the base64 into chunks of ~500 000 characters and call this tool repeatedly, passing the returned handle back on each call. ' +
      'Pass done: true on the last chunk — the tool then returns the final temp path. ' +
      'Use this instead of inline input_base64 whenever the file is too large to fit in a single tool call.',
    inputSchema: {
      chunk: z.string().describe('Base64-encoded chunk of file bytes. A data: URI prefix on the first chunk is fine and will be stripped.'),
      handle: z.string().optional().describe('Temp-file path returned by a previous write_temp_file call. Omit on the first chunk.'),
      ext: z.string().optional().describe('File extension including the dot, e.g. ".png" or ".mp4". Required on the first chunk; ignored on subsequent chunks.'),
      done: z.boolean().optional().describe('Set true on the last chunk to signal the file is complete. The response will include the final path to pass as input_path.'),
    },
  },
  async ({ chunk, handle, ext, done }) => {
    try {
      let filePath: string;
      if (handle) {
        filePath = path.resolve(handle);
        if (!fs.existsSync(filePath)) {
          return fail(`Invalid handle "${handle}" — file not found. Start a new upload without passing a handle.`);
        }
      } else {
        const fileExt = (ext ?? '.bin').replace(/^(?!\.)/, '.');
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'screenflow-upload-'));
        filePath = path.join(dir, `input${fileExt}`);
      }
      const b64 = chunk.replace(/^data:[^;]+;base64,/, '');
      fs.appendFileSync(filePath, Buffer.from(b64, 'base64'));
      if (done) {
        return ok(`File ready. Use input_path: "${filePath}" in frame_screenshot, frame_recording, or create_appstore_screenshot.`);
      }
      return ok(`Chunk written. Continue with: handle: "${filePath}". Call again with the next chunk (or set done: true on the last one).`);
    } catch (err) {
      return fail(`write_temp_file failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

// ── find_recent_files ────────────────────────────────────────────────────────
tool(
  'find_recent_files',
  {
    title: 'Find recent images / recordings on this machine',
    description:
      'List the most recently modified screenshot and video files on the local machine (Desktop, Downloads, Pictures/Screenshots, Movies). ' +
      'Use this to locate a file the user just took a screenshot of or recorded — returns real filesystem paths that can be passed directly as input_path to frame_screenshot or frame_recording. ' +
      'This is the FASTEST approach: no file data travels through MCP at all.',
    inputSchema: {
      limit: z.number().optional().describe('Max files to return (default 10).'),
      type: z.enum(['image', 'video', 'any']).optional().describe('Filter by type: image (PNG/JPG/HEIC), video (MP4/MOV), or any (default).'),
      folder: z.string().optional().describe('Optional extra folder path to scan in addition to the standard locations.'),
    },
  },
  async ({ limit, type, folder }) => {
    const imageExts = new Set(['.png', '.jpg', '.jpeg', '.heic', '.webp']);
    const videoExts = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv']);
    const allowed = type === 'image' ? imageExts : type === 'video' ? videoExts : new Set([...imageExts, ...videoExts]);
    const dirs = [
      path.join(os.homedir(), 'Desktop'),
      path.join(os.homedir(), 'Downloads'),
      path.join(os.homedir(), 'Pictures', 'Screenshots'),
      path.join(os.homedir(), 'Movies'),
      path.join(os.homedir(), 'Movies', 'Screen Recordings'),
    ];
    if (folder) dirs.push(folder);
    const files: { filePath: string; mtime: number; size: number }[] = [];
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue;
      try {
        for (const name of fs.readdirSync(dir)) {
          if (!allowed.has(path.extname(name).toLowerCase())) continue;
          const fp = path.join(dir, name);
          try {
            const st = fs.statSync(fp);
            if (st.isFile()) files.push({ filePath: fp, mtime: st.mtimeMs, size: st.size });
          } catch { /* skip unreadable entries */ }
        }
      } catch { /* skip unreadable dirs */ }
    }
    files.sort((a, b) => b.mtime - a.mtime);
    const top = files.slice(0, limit ?? 10);
    if (top.length === 0) return ok('No matching files found in standard locations (Desktop, Downloads, Screenshots, Movies).');
    const lines = top.map(f =>
      `${f.filePath}  [${(f.size / 1024).toFixed(0)} KB · ${new Date(f.mtime).toLocaleString()}]`
    );
    return ok('Recent files (newest first):\n' + lines.join('\n') + '\n\nPass the desired path as input_path to frame_screenshot or frame_recording.');
  },
);

// ── get_clipboard_path ───────────────────────────────────────────────────────
tool(
  'get_clipboard_path',
  {
    title: 'Get file path from macOS clipboard',
    description:
      'Read the filesystem path of the file currently copied in Finder (Cmd+C). Returns a real path that can be passed directly as input_path — no file data travels through MCP. ' +
      'Workflow: user copies a file in Finder → calls this tool → passes result as input_path to frame_screenshot or frame_recording.',
    inputSchema: {},
  },
  async () => {
    if (process.platform !== 'darwin') {
      return fail('get_clipboard_path is only available on macOS.');
    }
    try {
      const raw = execSync(
        `osascript -e 'POSIX path of (the clipboard as «class furl»)'`,
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
      ).trim();
      if (!raw) return fail('No file found in clipboard. Copy a file in Finder with Cmd+C first.');
      const resolved = path.resolve(raw);
      if (!fs.existsSync(resolved)) return fail(`Clipboard points to "${resolved}" but the file does not exist.`);
      return ok(`Clipboard file: ${resolved}\n\nUse input_path: "${resolved}" to frame it.`);
    } catch {
      return fail('No file in clipboard, or clipboard contains text/image data instead of a file reference. Copy a file in Finder with Cmd+C, then try again.');
    }
  },
);

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
      'HOW TO PASS THE IMAGE — BEST: call find_recent_files or get_clipboard_path to discover a real filesystem path, then use input_path (no data transfer at all). If you already have a path: input_path. If you have a public URL: input_url. Only as last resort: input_base64 for small files (< ~300 KB) — larger files get truncated by the AI and cause corrupt-header errors. Never invent a path you have not verified.',
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
      'HOW TO PASS THE RECORDING — BEST: call find_recent_files(type:"video") to discover the real path, then use input_path. If you already have a path: input_path. If you have a public URL: input_url. Never invent a path. Requires ffmpeg. ' +
      'Videos are large — always pass output_path to save to disk; without it the result is returned inline only when under 40 MB.',
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
      'HOW TO PASS THE IMAGE — BEST: call find_recent_files or get_clipboard_path first to discover a real path, then use input_path (zero data transfer). Fallback: input_url for public URLs. Last resort: input_base64 for small files only (< ~300 KB — larger files get truncated). Never invent a path.',
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
