import path from 'path';
import os from 'os';
import fs from 'fs';
import sharp from 'sharp';
import { compose } from '../composer';
import { Config } from '../config';
import { DEFAULT_DEVICE, getDefaultColor, hasFrameColor } from '../frames';
import { bold, cyan, dim, dot, fmtName, green, Spinner } from '../ui';
import { detectInputKind, ensureFfmpeg, probeVideo, runFfmpeg } from '../ffmpeg';
import { deviceCompositeChain, writeFrameInputs } from '../video-compose';

export type VideoStyle = 'zoom-in' | 'zoom-out' | 'pan-down' | 'pan-left' | 'pan-right';

interface VideoOptions {
  output?: string;
  color?: string;
  device?: string;
  style?: string;
  tilt?: string;
  fps?: string;
  duration?: string;
  mute?: boolean;
}

const DEFAULT_DURATION = 9; // seconds

// Working canvas = 2.25× output. At 2.2× max zoom the crop covers 1964×1105
// pixels from the 4320×2430 source → downscaled to 1920×1080 (ratio 0.978).
// No upscaling occurs, so zoomed frames are just as sharp as the original.
const CANVAS_W = 4320;
const CANVAS_H = 2430;

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
  const h264Level = fps <= 60 ? '4.2' : '5.1';

  const inputPath = path.resolve(file);
  const base = path.basename(inputPath, path.extname(inputPath));
  const dir  = path.dirname(inputPath);
  const outputPath = options.output
    ? path.resolve(options.output)
    : path.join(dir, `${base}_${device}_${color}.mp4`);

  if (detectInputKind(inputPath) === 'video') {
    if (options.duration !== undefined && options.duration !== String(DEFAULT_DURATION)) {
      console.log(`${dim('·')} --duration is ignored for screen recordings — the clip matches the recording length.`);
    }
    await animateRecording({ inputPath, outputPath, device, color, style, tilt, fps, h264Level, mute: Boolean(options.mute) });
    return;
  }

  const duration = parseFloat(options.duration ?? String(DEFAULT_DURATION));
  if (isNaN(duration) || duration < 1 || duration > 60) {
    throw new Error('--duration must be a number between 1 and 60');
  }

  await animateStill({ inputPath, outputPath, device, color, style, tilt, fps, h264Level, duration });
}

// Existing behaviour: composite a still, loop it, and apply the camera move.
async function animateStill(args: {
  inputPath: string; outputPath: string; device: string; color: string;
  style: VideoStyle; tilt: number; fps: number; h264Level: string; duration: number;
}): Promise<void> {
  const { inputPath, outputPath, device, color, style, tilt, fps, h264Level, duration } = args;

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

  // fps filter first to normalise input timestamps before the crop expressions
  // read `t` — same reason we kept it before zoompan previously.
  const vf = [
    `fps=${fps}`,
    `pad=${CANVAS_W}:${CANVAS_H}:(ow-iw)/2:(oh-ih)/2:black`,
    ...buildAnimFilter(style, duration),
    ...buildTiltFilter(tilt),
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

// New behaviour: the screen recording plays live inside the device while the
// camera move runs. Clip length = recording length (overrides --duration).
async function animateRecording(args: {
  inputPath: string; outputPath: string; device: string; color: string;
  style: VideoStyle; tilt: number; fps: number; h264Level: string; mute: boolean;
}): Promise<void> {
  const { inputPath, outputPath, device, color, style, tilt, fps, h264Level, mute } = args;

  const info = probeVideo(inputPath);
  const duration = info.durationSec;

  const { tmpDir, inputArgs, hasMask, spec } = await writeFrameInputs(device, color, fps, info);

  try {
    // Same fit-to-canvas scaling as animateStill, but using the device canvas
    // dimensions (the per-frame composite is exactly spec.canvas).
    const nW = spec.canvas.w;
    const nH = spec.canvas.h;
    const srcCanvasW = Math.max(nW, Math.round(nH * 16 / 9));
    const srcCanvasH = Math.max(nH, Math.round(nW * 9 / 16));
    const sc   = Math.min(CANVAS_W / srcCanvasW, CANVAS_H / srcCanvasH);
    const newW = Math.floor(nW * sc / 2) * 2;
    const newH = Math.floor(nH * sc / 2) * 2;

    const dev = deviceCompositeChain({ spec, fps, transparent: false, hasMask, out: 'dev' });
    const post = [
      `scale=${newW}:${newH}:flags=lanczos`,
      `pad=${CANVAS_W}:${CANVAS_H}:(ow-iw)/2:(oh-ih)/2:black`,
      ...buildAnimFilter(style, duration),
      ...buildTiltFilter(tilt),
    ].join(',');
    const filter = `${dev};[dev]${post}[outv]`;

    const audio = (mute || !info.hasAudio)
      ? ['-an']
      : ['-map', '0:a?', '-c:a', 'aac', '-b:a', '192k'];

    const encodeParts = [bold(style), ...(tilt > 0 ? ['3D tilt'] : []), `${fps}fps`, `${duration.toFixed(1)}s`];
    const encodeLabel = `Encoding ${encodeParts.join(dot())}`;
    const s = new Spinner(`${encodeLabel}...`);
    s.start();

    const { exitCode, stderr } = await runFfmpeg([
      '-y',
      '-i', inputPath,
      ...inputArgs,
      '-filter_complex', filter,
      '-map', '[outv]',
      ...audio,
      '-c:v', 'libx264',
      '-profile:v', 'high',
      '-level', h264Level,
      '-t', duration.toFixed(3),
      '-pix_fmt', 'yuv420p',
      '-r', String(fps),
      '-g', String(fps * 2),
      '-preset', 'slow',
      '-crf', '12',
      '-movflags', '+faststart',
      outputPath,
    ]);

    s.stop(`${cyan('✦')} ${encodeLabel}`);
    if (exitCode !== 0) throw new Error(`ffmpeg failed:\n${stderr}`);
    console.log(`${green('✓')} Saved ${dim('→')} ${bold(path.basename(outputPath))}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
