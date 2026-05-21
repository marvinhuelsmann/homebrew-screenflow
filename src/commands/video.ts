import path from 'path';
import os from 'os';
import fs from 'fs';
import { spawnSync } from 'child_process';
import { confirm } from '@inquirer/prompts';
import sharp from 'sharp';
import { compose } from '../composer';
import { Config } from '../config';
import { DEFAULT_DEVICE } from '../frames';

interface VideoOptions {
  output?: string;
  color?: string;
  device?: string;
}

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

export async function videoAction(file: string, options: VideoOptions): Promise<void> {
  await ensureFfmpeg();

  const config = new Config();
  const device = options.device ?? config.device ?? DEFAULT_DEVICE;
  const color  = options.color  ?? config.color  ?? 'silver';

  const inputPath = path.resolve(file);
  const base = path.basename(inputPath, path.extname(inputPath));
  const dir = path.dirname(inputPath);

  const outputPath = options.output
    ? path.resolve(options.output)
    : path.join(dir, `${base}_${device}_${color}.mp4`);

  const ts = Date.now();
  const tmpPng  = path.join(os.tmpdir(), `screenflow_${ts}.png`);
  const tmpMask = path.join(os.tmpdir(), `screenflow_mask_${ts}.png`);

  process.stdout.write(`Composing ${path.basename(inputPath)} ... `);
  await compose(inputPath, device, tmpPng, 'png', color);

  // Flatten transparency to black before ffmpeg so bilinear scale doesn't
  // produce gray fringes at semi-transparent device frame edges.
  const flatBuf = await sharp(tmpPng).flatten({ background: { r: 0, g: 0, b: 0 } }).png().toBuffer();
  fs.writeFileSync(tmpPng, flatBuf);

  // How many pixels to compress each side of the bottom edge — controls tilt strength.
  const perspOffset = 200;

  // Pre-render the two corner triangles that fall outside the perspective
  // trapezoid as a static black mask (much faster than per-pixel geq eval).
  const maskSvg = [
    `<svg width="1920" height="1080" xmlns="http://www.w3.org/2000/svg">`,
    `<polygon points="0,0 ${perspOffset},1080 0,1080" fill="black"/>`,
    `<polygon points="1920,0 ${1920 - perspOffset},1080 1920,1080" fill="black"/>`,
    `</svg>`,
  ].join('');
  await sharp(Buffer.from(maskSvg)).png().toFile(tmpMask);

  console.log('done');

  // 4 s total @ 60 fps = 240 frames (60 fps → smooth motion)
  // Phase 1 (frames 0–50, ~0.8 s): zoom 1× → 2.2× with cosine ease-out
  // Phase 2 (frames 50–240, ~3.2 s): pan straight up with cosine ease-in-out
  // Both phases reach the handoff point at near-zero velocity → seamless blend.
  const fps = 60;
  const d   = 240;  // total frames
  const p1  = 50;   // end of zoom-in phase

  // Zoom: cosine ease-in-out so it decelerates into frame p1 instead of cutting hard
  const zoomT  = `min(on/${p1},1)`;
  const Z = `(1+1.2*(1-cos(PI*${zoomT}))/2)`;

  // Phase-2 ease-in-out progress (0 → 1 over frames p1 → d)
  const phase2 = `max((on-${p1})/${d - p1},0)`;
  const eased  = `(1-cos(PI*min(${phase2},1)))/2`;

  // Zoom + centered-horizontal pan with straight-up vertical pan
  const zoompan = [
    `zoompan=z='${Z}'`,
    `d=${d}`,
    `x='iw/2-iw/(2*${Z})'`,
    `y='ih*(1-1/${Z})*(1-${eased})'`,
    `s=1920x1080`,
    `fps=${fps}`,
  ].join(':');

  // 3-D perspective tilt: bottom edge compressed ~10 % each side,
  // top edge full-width → device appears to tilt upward toward viewer
  const persp = `perspective=x0=0:y0=0:x1=1920:y1=0:x2=${perspOffset}:y2=1080:x3=${1920 - perspOffset}:y3=1080:interpolation=linear`;

  const mainFilter = [
    'scale=1920:1080:force_original_aspect_ratio=decrease',
    'pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black',
    zoompan,
    persp,
  ].join(',');

  // Overlay the static corner mask via filter_complex — a simple blit per
  // frame, far faster than per-pixel geq expression evaluation.
  const filterComplex = `[0:v]${mainFilter}[main];[main][1:v]overlay=0:0`;

  process.stdout.write(`Rendering video ${path.basename(outputPath)} ... `);

  const result = spawnSync('ffmpeg', [
    '-y',
    '-loop', '1', '-i', tmpPng,
    '-loop', '1', '-i', tmpMask,
    '-filter_complex', filterComplex,
    '-c:v', 'libx264',
    '-profile:v', 'high',
    '-t', '4',
    '-pix_fmt', 'yuv420p',
    '-r', String(fps),
    '-preset', 'slow',
    '-crf', '14',
    outputPath,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  fs.unlinkSync(tmpPng);
  fs.unlinkSync(tmpMask);

  if (result.error) throw new Error(result.error.message);
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed:\n${result.stderr.toString()}`);
  }

  console.log('done');
}
