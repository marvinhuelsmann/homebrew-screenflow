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
}

const FPS = 60;
const FRAMES = 240; // 4 s @ 60 fps

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

// fps= is intentionally omitted from zoompan — it is set as a standalone fps
// filter before zoompan so input timestamps are normalised first, preventing
// the frame-timing conflict that caused stutter at the start of animations.
function buildZoompan(style: VideoStyle): string {
  const d = FRAMES;

  if (style === 'zoom-in') {
    // Phase 1 (0–50): cosine ease zoom 1× → 2.2×
    // Phase 2 (50–240): cosine ease-in-out pan from bottom to top
    const p1 = 50;
    const zoomT  = `min(on/${p1},1)`;
    const Z      = `(1+1.2*(1-cos(PI*${zoomT}))/2)`;
    const phase2 = `max((on-${p1})/${d - p1},0)`;
    const eased  = `(1-cos(PI*min(${phase2},1)))/2`;
    return [
      `zoompan=z='${Z}'`,
      `d=${d}`,
      `x='iw/2-iw/(2*${Z})'`,
      `y='ih*(1-1/${Z})*(1-${eased})'`,
      `s=1920x1080`,
    ].join(':');
  }

  if (style === 'zoom-out') {
    // Cosine ease zoom 1.8× → 1×, centered throughout
    const Z = `(1.8-0.8*(1-cos(PI*min(on/${d - 1},1)))/2)`;
    return [
      `zoompan=z='${Z}'`,
      `d=${d}`,
      `x='iw/2-iw/(2*${Z})'`,
      `y='ih/2-ih/(2*${Z})'`,
      `s=1920x1080`,
    ].join(':');
  }

  // Pan styles — constant 1.4× zoom, cosine ease from start to end position
  const zoom    = 1.4;
  const eased   = `(1-cos(PI*min(on/${d - 1},1)))/2`;
  const xCenter = `iw/2-iw/(2*${zoom})`;
  const yCenter = `ih/2-ih/(2*${zoom})`;
  const xMax    = `iw*(1-1/${zoom})`;
  const yMax    = `ih*(1-1/${zoom})`;

  if (style === 'pan-down') {
    return [
      `zoompan=z='${zoom}'`,
      `d=${d}`,
      `x='${xCenter}'`,
      `y='${yMax}*${eased}'`,
      `s=1920x1080`,
    ].join(':');
  }

  if (style === 'pan-left') {
    return [
      `zoompan=z='${zoom}'`,
      `d=${d}`,
      `x='${xMax}*(1-${eased})'`,
      `y='${yCenter}'`,
      `s=1920x1080`,
    ].join(':');
  }

  // pan-right
  return [
    `zoompan=z='${zoom}'`,
    `d=${d}`,
    `x='${xMax}*${eased}'`,
    `y='${yCenter}'`,
    `s=1920x1080`,
  ].join(':');
}

export async function videoAction(file: string, options: VideoOptions): Promise<void> {
  await ensureFfmpeg();

  const config = new Config();
  const device = options.device ?? config.device ?? DEFAULT_DEVICE;
  const color  = options.color  ?? config.color  ?? 'silver';
  const style  = (options.style ?? 'zoom-in') as VideoStyle;

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

  // Flatten transparency to black so bilinear scale doesn't produce gray
  // fringes at semi-transparent device frame edges.
  const flatBuf = await sharp(tmpPng).flatten({ background: { r: 0, g: 0, b: 0 } }).png().toBuffer();
  fs.writeFileSync(tmpPng, flatBuf);

  console.log('done');

  const zoompan = buildZoompan(style);

  // fps filter BEFORE zoompan normalises input timestamps — prevents the
  // frame-timing conflict between -r on the input and zoompan's internal
  // frame counter that causes stutter at the start of animations.
  const vf = [
    `fps=${FPS}`,
    'scale=1920:1080:force_original_aspect_ratio=decrease:flags=lanczos',
    'pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black',
    zoompan,
  ].join(',');

  process.stdout.write(`Rendering video ${path.basename(outputPath)} [${style}] ... `);

  const result = spawnSync('ffmpeg', [
    '-y',
    '-loop', '1', '-i', tmpPng,
    '-vf', vf,
    '-c:v', 'libx264',
    '-profile:v', 'high',
    '-level', '4.2',
    '-t', '4',
    '-pix_fmt', 'yuv420p',
    '-r', String(FPS),
    '-g', String(FPS * 2),
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
