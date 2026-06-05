import path from 'path';
import os from 'os';
import fs from 'fs';
import { buildFrameAssets } from './composer';
import { runFfmpeg, VideoInfo } from './ffmpeg';
import { FrameSpec } from './frames';

// Builds the filter_complex chain that composites the screen recording inside
// the device, producing label `[<out>]` at canvas size (spec.canvas).
//
// ffmpeg input order assumed by the labels below:
//   [0:v] = screen recording   [1:v] = frame overlay PNG   [2:v] = corner mask (if hasMask)
//
// transparent=true keeps an alpha background (for HEVC-with-alpha .mov); false
// fills the background and rounded-corner cut-outs with black (for H.264 .mp4 /
// animation).
export function deviceCompositeChain(opts: {
  spec: FrameSpec;
  fps: number;
  transparent: boolean;
  hasMask: boolean;
  out: string;
}): string {
  const { spec, fps, transparent, hasMask, out } = opts;
  const { x: SX, y: SY, w: SW, h: SH } = spec.screen;
  const CW = spec.canvas.w;
  const CH = spec.canvas.h;
  const baseColor = transparent ? 'black@0' : 'black';

  // `overlay`'s default format is yuv420, which would force the whole upstream
  // chain (including `crop`) into 4:2:0 and clamp odd screen widths/heights down
  // to even — breaking the alphamerge size match with the corner mask. We keep
  // compositing in a non-subsampled space so odd sizes survive:
  //   • Transparent path: RGBA links ([scr] + base) — preserves alpha for HEVC.
  //   • Opaque path: overlay `format=yuv444` (4:4:4) — alpha isn't needed and
  //     yuv420p is produced at encode time.
  // fit:'cover', position:'top' — matches the still composer's resize.
  const fmt = transparent ? ',format=rgba' : '';
  const overlayFmt = transparent ? '' : ':format=yuv444';
  const parts = [
    `[0:v]fps=${fps},scale=${SW}:${SH}:force_original_aspect_ratio=increase:flags=lanczos,` +
      `crop=${SW}:${SH}:(iw-ow)/2:0,setsar=1${fmt}[scr]`,
  ];
  let scr = 'scr';
  if (hasMask) { parts.push(`[scr][2:v]alphamerge[scrm]`); scr = 'scrm'; }
  parts.push(`color=c=${baseColor}:s=${CW}x${CH}:r=${fps}${fmt}[base]`);
  parts.push(`[base][${scr}]overlay=${SX}:${SY}:shortest=1${overlayFmt}[d1]`);
  parts.push(`[d1][1:v]overlay=0:0${overlayFmt}[${out}]`);
  return parts.join(';');
}

// Writes the frame overlay (and corner mask) to a temp dir and returns the
// ffmpeg `-i` input args plus the temp dir to clean up.
export async function writeFrameInputs(
  device: string,
  color: string,
  fps: number,
  info?: VideoInfo,
): Promise<{ tmpDir: string; inputArgs: string[]; hasMask: boolean; spec: FrameSpec }> {
  const { spec, overlayPng, cornerMaskPng } = await buildFrameAssets(device, color, info?.width, info?.height);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'screenflow-'));
  const overlayPath = path.join(tmpDir, 'overlay.png');
  fs.writeFileSync(overlayPath, overlayPng);

  const inputArgs = ['-loop', '1', '-framerate', String(fps), '-i', overlayPath];
  if (cornerMaskPng) {
    const maskPath = path.join(tmpDir, 'mask.png');
    fs.writeFileSync(maskPath, cornerMaskPng);
    inputArgs.push('-loop', '1', '-framerate', String(fps), '-i', maskPath);
  }
  return { tmpDir, inputArgs, hasMask: Boolean(cornerMaskPng), spec };
}

// Static framing of a screen recording: the device stays still while the screen
// plays the recording. Output length = recording length. `.mov` keeps a
// transparent background (HEVC with alpha — ~90× smaller than ProRes, plays
// natively in QuickTime/Keynote/Final Cut); any other extension renders on
// black H.264.
export async function composeStaticVideo(opts: {
  inputPath: string;
  device: string;
  color: string;
  outputPath: string;
  info: VideoInfo;
  mute: boolean;
}): Promise<{ exitCode: number; stderr: string }> {
  const { inputPath, device, color, outputPath, info, mute } = opts;
  const transparent = path.extname(outputPath).toLowerCase() === '.mov';
  const fps = info.avgFps > 0 ? info.avgFps : 30;

  const { tmpDir, inputArgs, hasMask, spec } = await writeFrameInputs(device, color, fps, info);

  try {
    const chain = deviceCompositeChain({ spec, fps, transparent, hasMask, out: 'comp' });
    // Both HEVC (yuva420p) and H.264 (yuv420p) need even dimensions; device
    // canvases can be odd (e.g. iphone-16 1359w, imac 3485h), so pad up to even.
    // The transparent path pads with transparent black (black@0) to keep alpha.
    const filter = transparent
      ? `${chain};[comp]pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0:black@0[outv]`
      : `${chain};[comp]pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0:black,format=yuv420p[outv]`;
    const vLabel = 'outv';

    // HEVC with alpha via VideoToolbox: ~90× smaller than ProRes 4444 at
    // visually identical quality, hardware-encoded, hvc1-tagged so it plays in
    // QuickTime, Keynote, Final Cut and After Effects.
    const videoCodec = transparent
      ? ['-c:v', 'hevc_videotoolbox', '-alpha_quality', '0.9', '-tag:v', 'hvc1', '-pix_fmt', 'yuva420p']
      : ['-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'slow'];

    const audio = (mute || !info.hasAudio)
      ? ['-an']
      : ['-map', '0:a?', '-c:a', 'aac', '-b:a', '192k'];

    return await runFfmpeg([
      '-y',
      '-i', inputPath,
      ...inputArgs,
      '-filter_complex', filter,
      '-map', `[${vLabel}]`,
      ...audio,
      ...videoCodec,
      '-t', info.durationSec.toFixed(3),
      '-movflags', '+faststart',
      outputPath,
    ]);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
