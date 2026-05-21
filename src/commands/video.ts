import path from 'path';
import os from 'os';
import fs from 'fs';
import { spawnSync } from 'child_process';
import { confirm } from '@inquirer/prompts';
import sharp from 'sharp';
import { compose } from '../composer';
import { Config } from '../config';
import { DEFAULT_DEVICE } from '../frames';

export type VideoStyle = 'zoom-in' | 'zoom-out' | 'pan-down' | 'pan-left' | 'pan-right';

interface VideoOptions {
  output?: string;
  color?: string;
  device?: string;
  style?: string;
  tilt?: string;
  fps?: string;
}

const DURATION = 9; // seconds

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

  console.log('ffmpeg is required for video output but was not found.');
  const install = await confirm({ message: 'Install ffmpeg via Homebrew now?' });
  if (!install) throw new Error('ffmpeg is required — install it with: brew install ffmpeg');

  console.log('Installing ffmpeg...');
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
function buildAnimFilter(style: VideoStyle): string[] {
  const W   = CANVAS_W;   // 4320
  const H   = CANVAS_H;   // 2430
  const dur = DURATION;   // 9 s
  const sc  = 'scale=1920:1080:flags=lanczos';

  if (style === 'zoom-in') {
    const zDur = 2;           // seconds — zoom phase
    const pDur = dur - zDur;  // 7 s    — pan phase
    const Z  = `(1+0.6*(1-cos(PI*min(t/${zDur},1))))`;
    const e2 = `((1-cos(PI*min(max((t-${zDur})/${pDur},0),1)))/2)`;
    return [
      `crop=w='${W}/${Z}':h='${H}/${Z}':x='${W}/2-${W}/(2*${Z})':y='(${H}-${H}/${Z})*(1-${e2})'`,
      sc,
    ];
  }

  if (style === 'zoom-out') {
    const Z = `(1.8-0.8*(1-cos(PI*min(t/${dur},1)))/2)`;
    return [
      `crop=w='${W}/${Z}':h='${H}/${Z}':x='${W}/2-${W}/(2*${Z})':y='${H}/2-${H}/(2*${Z})'`,
      sc,
    ];
  }

  // Pan styles — constant 1.4× zoom, cosine ease over full duration
  const zoom = 1.4;
  const cw   = Math.round(W / zoom);
  const ch   = Math.round(H / zoom);
  const xc   = Math.round(W / 2 - W / (2 * zoom));
  const yc   = Math.round(H / 2 - H / (2 * zoom));
  const xMax = Math.round(W * (1 - 1 / zoom));
  const yMax = Math.round(H * (1 - 1 / zoom));
  const e    = `((1-cos(PI*min(t/${dur},1)))/2)`;

  if (style === 'pan-down')  return [`crop=w='${cw}':h='${ch}':x='${xc}':y='${yMax}*${e}'`, sc];
  if (style === 'pan-left')  return [`crop=w='${cw}':h='${ch}':x='${xMax}*(1-${e})':y='${yc}'`, sc];
  /* pan-right */            return [`crop=w='${cw}':h='${ch}':x='${xMax}*${e}':y='${yc}'`, sc];
}

export async function videoAction(file: string, options: VideoOptions): Promise<void> {
  await ensureFfmpeg();

  const config = new Config();
  const device = options.device ?? config.device ?? DEFAULT_DEVICE;
  const color  = options.color  ?? config.color  ?? 'silver';
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

  const ts     = Date.now();
  const tmpPng = path.join(os.tmpdir(), `screenflow_${ts}.png`);

  process.stdout.write(`Composing ${path.basename(inputPath)} ... `);
  await compose(inputPath, device, tmpPng, 'png', color);

  // Scale the composed frame so its 16:9 letterbox canvas fits within
  // CANVAS_W×CANVAS_H. This preserves native device pixels for the zoom
  // animation instead of discarding them with an early 1920×1080 downscale.
  const meta = await sharp(tmpPng).metadata();
  const nW = meta.width!;
  const nH = meta.height!;
  const srcCanvasW = Math.max(nW, Math.round(nH * 16 / 9));
  const srcCanvasH = Math.max(nH, Math.round(nW * 9 / 16));
  const s    = Math.min(CANVAS_W / srcCanvasW, CANVAS_H / srcCanvasH);
  const newW = Math.floor(nW * s / 2) * 2;
  const newH = Math.floor(nH * s / 2) * 2;

  const flatBuf = await sharp(tmpPng)
    .flatten({ background: { r: 0, g: 0, b: 0 } })
    .resize(newW, newH, { kernel: 'lanczos3', fit: 'fill' })
    .png()
    .toBuffer();
  fs.writeFileSync(tmpPng, flatBuf);

  console.log('done');

  const animFilters = buildAnimFilter(style);
  const tiltFilters = buildTiltFilter(tilt);

  // fps filter first to normalise input timestamps before the crop expressions
  // read `t` — same reason we kept it before zoompan previously.
  const vf = [
    `fps=${fps}`,
    `pad=${CANVAS_W}:${CANVAS_H}:(ow-iw)/2:(oh-ih)/2:black`,
    ...animFilters,   // crop → scale → 1920×1080
    ...tiltFilters,   // perspective warp last (pan unaffected)
  ].join(',');

  const tiltLabel = tilt > 0 ? ` tilt=${tilt}°` : '';
  process.stdout.write(`Rendering video ${path.basename(outputPath)} [${style}${tiltLabel} ${fps}fps] ... `);

  const result = spawnSync('ffmpeg', [
    '-y',
    '-loop', '1', '-i', tmpPng,
    '-vf', vf,
    '-c:v', 'libx264',
    '-profile:v', 'high',
    '-level', h264Level,
    '-t', String(DURATION),
    '-pix_fmt', 'yuv420p',
    '-r', String(fps),
    '-g', String(fps * 2),
    '-preset', 'slow',
    '-crf', '12',
    '-movflags', '+faststart',
    outputPath,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  fs.unlinkSync(tmpPng);

  if (result.error) throw new Error(result.error.message);
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed:\n${result.stderr.toString()}`);
  }

  console.log('done');
}
