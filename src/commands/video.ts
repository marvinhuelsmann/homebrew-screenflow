import path from 'path';
import os from 'os';
import fs from 'fs';
import { spawnSync, spawn } from 'child_process';
import { confirm } from '@inquirer/prompts';
import sharp from 'sharp';
import { compose } from '../composer';
import { Config } from '../config';
import { DEFAULT_DEVICE, getDefaultColor, hasFrameColor } from '../frames';

export type VideoStyle = 'zoom-in' | 'zoom-out' | 'pan-down' | 'pan-left' | 'pan-right';

interface VideoOptions {
  output?: string;
  color?: string;
  device?: string;
  style?: string;
  tilt?: string;
  fps?: string;
  duration?: string;
}

const DEFAULT_DURATION = 9; // seconds

// ── Output helpers ────────────────────────────────────────────────────────────
const tty = Boolean(process.stdout.isTTY);
const cyan  = (s: string) => tty ? `\x1b[36m${s}\x1b[0m` : s;
const green = (s: string) => tty ? `\x1b[32m${s}\x1b[0m` : s;
const bold  = (s: string) => tty ? `\x1b[1m${s}\x1b[0m`  : s;
const dim   = (s: string) => tty ? `\x1b[2m${s}\x1b[0m`  : s;
const dot   = () => ` ${dim('·')} `;

function fmtName(s: string): string {
  return s.split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
    .replace(/^Iphone\b/, 'iPhone')
    .replace(/^Ipad\b/,   'iPad');
}

// Bouncing-dot spinner — animates while async work runs.
// Dots rise and fall in a 3-column wave pattern.
const SPINNER_FRAMES = [
  '▁▁▁', '▂▁▁', '▃▂▁', '▄▃▂', '▅▄▃', '▆▅▄', '▇▆▅',
  '█▇▆', '▇█▇', '▆▇█', '▅▆▇', '▄▅▆', '▃▄▅', '▂▃▄', '▁▂▃', '▁▁▂',
];

class Spinner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private frame = 0;

  constructor(private msg: string) {}

  start(): void {
    if (!tty) { process.stdout.write(`  ${this.msg}\n`); return; }
    this.render();
    this.timer = setInterval(() => this.render(), 80);
  }

  private render(): void {
    const wave = cyan(SPINNER_FRAMES[this.frame % SPINNER_FRAMES.length]);
    process.stdout.write(`\r${wave} ${this.msg}  `);
    this.frame++;
  }

  stop(finalLine: string): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (tty) process.stdout.write('\r\x1b[K');
    console.log(finalLine);
  }
}

function runFfmpeg(args: string[]): Promise<{ exitCode: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const errChunks: Buffer[] = [];
    proc.stderr?.on('data', (d: Buffer) => errChunks.push(d));
    proc.on('error', reject);
    proc.on('close', code => resolve({ exitCode: code ?? 1, stderr: Buffer.concat(errChunks).toString() }));
  });
}

// Working canvas = 2.25× output. At 2.2× max zoom the crop covers 1964×1105
// pixels from the 4320×2430 source → downscaled to 1920×1080 (ratio 0.978).
// No upscaling occurs, so zoomed frames are just as sharp as the original.
const CANVAS_W = 4320;
const CANVAS_H = 2430;

function ffmpegAvailable(): boolean {
  const r = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  return !r.error;
}

async function ensureFfmpeg(): Promise<void> {
  if (ffmpegAvailable()) return;

  console.log(`${cyan('✦')} ffmpeg is required but was not found.`);
  const install = await confirm({ message: 'Install ffmpeg via Homebrew now?' });
  if (!install) throw new Error('ffmpeg is required — install it with: brew install ffmpeg');

  console.log(`${cyan('✦')} Installing ffmpeg via Homebrew...`);
  const r = spawnSync('brew', ['install', 'ffmpeg'], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('Homebrew install failed. Run: brew install ffmpeg');
  if (!ffmpegAvailable()) throw new Error('ffmpeg still not found after install — check your PATH');
}

// Applied AFTER the zoom/pan animation so the pan direction is unaffected by
// the perspective warp. The shrink→pad→stretch pre-step compensates for the
// horizontal squeeze so the device appears the same size as without tilt.
function buildTiltFilter(tilt: number): string[] {
  if (tilt <= 0) return [];
  const O  = Math.round(1080 * Math.tan((tilt * Math.PI) / 180));
  const W  = 1920 + 2 * O;
  const cW = Math.round((1920 * 1920) / W);
  const cH = Math.round((1080 * 1920) / W);
  return [
    `scale=${cW}:${cH}:flags=lanczos`,
    `pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black`,
    `scale=${W}:1080:flags=lanczos`,
    `perspective=x0=0:y0=0:x1=${W}:y1=0:x2=${O}:y2=1080:x3=${W - O}:y3=1080:interpolation=linear`,
    `crop=1920:1080:${O}:0`,
  ];
}

// Per-frame crop + lanczos scale replacing zoompan.
// Input must be CANVAS_W×CANVAS_H. Output is 1920×1080.
// Expressions use `t` (seconds) so timing is fps-independent.
// Single-quoted expressions protect commas from the filter-chain parser.
function buildAnimFilter(style: VideoStyle, dur: number): string[] {
  const W   = CANVAS_W;   // 4320
  const H   = CANVAS_H;   // 2430
  const sc  = 'scale=1920:1080:flags=lanczos';

  if (style === 'zoom-in') {
    // Constant 2× crop (same structure as pan-down), pan from bottom to top.
    const zoom = 2.0;
    const cw   = Math.round(W / zoom);
    const ch   = Math.round(H / zoom);
    const xc   = Math.round(W / 2 - W / (2 * zoom));
    const yMax = Math.round(H * (1 - 1 / zoom));
    const e    = `((1-cos(PI*min(t/${dur},1)))/2)`;
    return [`crop=w='${cw}':h='${ch}':x='${xc}':y='${yMax}*(1-${e})'`, sc];
  }

  if (style === 'zoom-out') {
    // Crop shrinks from full canvas (Z=1) to 1.8× centered: push-in to device center.
    const Z = `(1+0.8*(1-cos(PI*min(t/${dur},1)))/2)`;  // 1.0 → 1.8
    return [
      `crop=w='${W}/${Z}':h='${H}/${Z}':x='${W}/2-${W}/(2*${Z})':y='${H}/2-${H}/(2*${Z})'`,
      sc,
    ];
  }

  const e = `((1-cos(PI*min(t/${dur},1)))/2)`;

  // Pan-down: 1.4× zoom, gentle top-to-bottom reveal
  if (style === 'pan-down') {
    const zoom = 1.4;
    const cw   = Math.round(W / zoom);
    const ch   = Math.round(H / zoom);
    const xc   = Math.round(W / 2 - W / (2 * zoom));
    const yMax = Math.round(H * (1 - 1 / zoom));
    return [`crop=w='${cw}':h='${ch}':x='${xc}':y='${yMax}*${e}'`, sc];
  }

  // Pan-left / pan-right: full device visible (zoomed out), slides across.
  // Scale canvas to output size → pad to 3× width → crop window slides across.
  // Device centered at x=1920..3840 in the 5760 canvas. Slide ±960 from center
  // (x: 960↔2880) so device is half-visible at extremes, fully visible at midpoint.
  const xExpr = style === 'pan-left' ? `960+1920*(1-${e})` : `960+1920*${e}`;
  return [
    `scale=1920:1080:flags=lanczos`,
    `pad=5760:1080:1920:0:black`,
    `crop=1920:1080:'${xExpr}':0`,
  ];
}

export async function videoAction(file: string, options: VideoOptions): Promise<void> {
  await ensureFfmpeg();

  const config = new Config();
  const device = options.device ?? config.device ?? DEFAULT_DEVICE;
  const color = options.color
    ?? (!options.device && config.color && hasFrameColor(device, config.color)
      ? config.color
      : getDefaultColor(device));
  const style  = (options.style ?? 'zoom-in') as VideoStyle;
  const tilt   = parseFloat(options.tilt ?? '0');
  if (isNaN(tilt) || tilt < 0 || tilt > 45) {
    throw new Error('--tilt must be a number between 0 and 45');
  }
  const fps = parseInt(options.fps ?? '60', 10);
  if (isNaN(fps) || fps < 24 || fps > 120) {
    throw new Error('--fps must be a number between 24 and 120');
  }
  const duration = parseFloat(options.duration ?? String(DEFAULT_DURATION));
  if (isNaN(duration) || duration < 1 || duration > 60) {
    throw new Error('--duration must be a number between 1 and 60');
  }
  const h264Level = fps <= 60 ? '4.2' : '5.1';

  const inputPath = path.resolve(file);
  const base = path.basename(inputPath, path.extname(inputPath));
  const dir  = path.dirname(inputPath);

  const outputPath = options.output
    ? path.resolve(options.output)
    : path.join(dir, `${base}_${device}_${color}.mp4`);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'screenflow-'));
  const tmpPng = path.join(tmpDir, 'frame.png');

  const composeLabel = `Compositing ${bold(fmtName(device))}${dot()}${bold(fmtName(color))}`;
  const s1 = new Spinner(`${composeLabel}...`);
  s1.start();
  await compose(inputPath, device, tmpPng, 'png', color);

  // Scale the composed frame so its 16:9 letterbox canvas fits within
  // CANVAS_W×CANVAS_H. This preserves native device pixels for the zoom
  // animation instead of discarding them with an early 1920×1080 downscale.
  const meta = await sharp(tmpPng).metadata();
  const nW = meta.width!;
  const nH = meta.height!;
  const srcCanvasW = Math.max(nW, Math.round(nH * 16 / 9));
  const srcCanvasH = Math.max(nH, Math.round(nW * 9 / 16));
  const sc   = Math.min(CANVAS_W / srcCanvasW, CANVAS_H / srcCanvasH);
  const newW = Math.floor(nW * sc / 2) * 2;
  const newH = Math.floor(nH * sc / 2) * 2;

  const flatBuf = await sharp(tmpPng)
    .flatten({ background: { r: 0, g: 0, b: 0 } })
    .resize(newW, newH, { kernel: 'lanczos3', fit: 'fill' })
    .png()
    .toBuffer();
  fs.writeFileSync(tmpPng, flatBuf);
  s1.stop(`${cyan('✦')} ${composeLabel}`);

  const animFilters = buildAnimFilter(style, duration);
  const tiltFilters = buildTiltFilter(tilt);

  // fps filter first to normalise input timestamps before the crop expressions
  // read `t` — same reason we kept it before zoompan previously.
  const vf = [
    `fps=${fps}`,
    `pad=${CANVAS_W}:${CANVAS_H}:(ow-iw)/2:(oh-ih)/2:black`,
    ...animFilters,   // crop → scale → 1920×1080
    ...tiltFilters,   // perspective warp last (pan unaffected)
  ].join(',');

  const encodeParts = [bold(style), ...(tilt > 0 ? ['3D tilt'] : []), `${fps}fps`, `${duration}s`];
  const encodeLabel = `Encoding ${encodeParts.join(dot())}`;
  const s2 = new Spinner(`${encodeLabel}...`);
  s2.start();

  const { exitCode, stderr } = await runFfmpeg([
    '-y',
    '-loop', '1', '-i', tmpPng,
    '-vf', vf,
    '-c:v', 'libx264',
    '-profile:v', 'high',
    '-level', h264Level,
    '-t', String(duration),
    '-pix_fmt', 'yuv420p',
    '-r', String(fps),
    '-g', String(fps * 2),
    '-preset', 'slow',
    '-crf', '12',
    '-movflags', '+faststart',
    outputPath,
  ]);

  fs.rmSync(tmpDir, { recursive: true, force: true });
  s2.stop(`${cyan('✦')} ${encodeLabel}`);

  if (exitCode !== 0) throw new Error(`ffmpeg failed:\n${stderr}`);

  console.log(`${green('✓')} Saved ${dim('→')} ${bold(path.basename(outputPath))}`);
}
