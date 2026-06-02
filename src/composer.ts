import sharp from 'sharp';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FRAMES, FrameSpec, getDefaultColor } from './frames';
import { ffmpegAvailable, runFfmpeg } from './ffmpeg';

export type Format = 'svg' | 'png' | 'jpeg';

export const DEVICES = Object.keys(FRAMES).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

function resolveDevice(input: string): string {
  const id = input.toLowerCase().trim();
  if (id in FRAMES) return id;
  throw new Error(`Unknown device "${input}". Available: ${DEVICES.join(', ')}`);
}

function resolveColor(device: string, input: string): string {
  const id = input.toLowerCase().trim();
  const colors = FRAMES[device].colors;
  if (id in colors) return id;
  throw new Error(`Unknown color "${input}" for ${device}. Available: ${Object.keys(colors).join(', ')}`);
}

// ── Vector compositing (iPhone-style: pure SVG with Screen mask clip path) ───

function extractScreenMaskPaths(svgContent: string): { phoneBody: string; cutouts: string[] } {
  const match = svgContent.match(/<path[^>]+id="Screen mask"[^>]+d="([^"]+)"/);
  if (!match) throw new Error('Could not find Screen mask path in SVG frame');
  // parts[0] = outer canvas rect, parts[1] = phone body, parts[2+] = cutouts (Dynamic Island etc.)
  const parts = match[1].split('Z').filter(p => p.trim()).map(p => p.trim() + 'Z');
  if (parts.length < 2) throw new Error('Unexpected Screen mask path format');
  return { phoneBody: parts[1], cutouts: parts.slice(2) };
}

function buildVectorSvg(
  frameSvg: string,
  screenshotB64: string,
  screen: { x: number; y: number; w: number; h: number },
  cutoutBleed = 0,
): string {
  const { phoneBody, cutouts } = extractScreenMaskPaths(frameSvg);
  const cutoutStrokeWidth = cutoutBleed * 2;
  const defs = [
    `<defs>`,
    `<clipPath id="sf-screen-clip"><path d="${phoneBody}"/></clipPath>`,
    `</defs>`,
  ].join('');
  const image = [
    `<image clip-path="url(#sf-screen-clip)"`,
    `x="${screen.x}" y="${screen.y}" width="${screen.w}" height="${screen.h}"`,
    `href="data:image/png;base64,${screenshotB64}"/>`,
  ].join(' ');
  const cutoutCovers = cutouts
    .map(p => [
      `<path d="${p}" fill="black" stroke="black"`,
      `stroke-width="${cutoutStrokeWidth}" stroke-linejoin="round" stroke-linecap="round"/>`,
    ].join(' '))
    .join('');
  return frameSvg
    .replace('<svg ', '<svg xmlns:xlink="http://www.w3.org/1999/xlink" ')
    .replace('<g id="Phone">', `<g id="Phone">${defs}${image}${cutoutCovers}`);
}

async function composeVector(
  inputPath: string, spec: FrameSpec, frameSvg: string,
  outputPath: string, format: Format,
): Promise<void> {
  let screenshot = await sharp(inputPath)
    .resize(spec.screen.w, spec.screen.h, { fit: 'cover', position: 'top' })
    .png()
    .toBuffer();

  // Punch out Dynamic Island (and any other screen cutouts) from the screenshot buffer
  // before embedding. A black cover is also drawn in the SVG to hide slight native
  // screenshot/asset geometry mismatches without leaving transparent halos.
  const { cutouts } = extractScreenMaskPaths(frameSvg);
  if (cutouts.length > 0) {
    const ox = spec.screen.x;
    const oy = spec.screen.y;
    const cutoutBleed = spec.cutoutBleed ?? 0;
    const cutoutStrokeWidth = cutoutBleed * 2;
    const punchSvg = [
      `<svg width="${spec.screen.w}" height="${spec.screen.h}" xmlns="http://www.w3.org/2000/svg">`,
      ...cutouts.map(p => [
        `<path d="${p}" transform="translate(${-ox},${-oy})"`,
        `fill="white" stroke="white" stroke-width="${cutoutStrokeWidth}"`,
        `stroke-linejoin="round" stroke-linecap="round"/>`,
      ].join(' ')),
      `</svg>`,
    ].join('');
    const punchMask = await sharp(Buffer.from(punchSvg)).png().toBuffer();
    screenshot = await sharp(screenshot)
      .composite([{ input: punchMask, blend: 'dest-out' }])
      .png()
      .toBuffer();
  }

  const compositeSvg = buildVectorSvg(
    frameSvg,
    screenshot.toString('base64'),
    spec.screen,
    spec.cutoutBleed,
  );

  if (format === 'svg') {
    fs.writeFileSync(outputPath, compositeSvg, 'utf8');
    return;
  }
  const rendered = sharp(Buffer.from(compositeSvg));
  if (format === 'jpeg') await rendered.jpeg({ quality: 90 }).toFile(outputPath);
  else await rendered.png({ compressionLevel: 6 }).toFile(outputPath);
}

// ── Raster compositing (iPad-style: PNG embedded in SVG) ─────────────────────

function extractEmbeddedPng(svgContent: string): Buffer {
  const match = svgContent.match(/xlink:href="data:image\/png;base64,([^"]+)"/);
  if (!match) throw new Error('No embedded PNG found in raster frame SVG');
  return Buffer.from(match[1], 'base64');
}

async function composeRaster(
  inputPath: string, spec: FrameSpec, frameSvg: string,
  outputPath: string, format: Format,
): Promise<void> {
  const frameBuffer = extractEmbeddedPng(frameSvg);
  const r = spec.cornerRadius ?? 0;

  let screenshot = await sharp(inputPath)
    .resize(spec.screen.w, spec.screen.h, { fit: 'cover', position: 'top' })
    .png()
    .toBuffer();

  if (r > 0) {
    screenshot = await roundedClip(screenshot, spec.screen.w, spec.screen.h, r);
  }

  if (format === 'svg') {
    const screenshotB64 = screenshot.toString('base64');
    const frameB64 = frameBuffer.toString('base64');
    const svgOut = [
      `<svg width="${spec.canvas.w}" height="${spec.canvas.h}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">`,
      `<image x="${spec.screen.x}" y="${spec.screen.y}" width="${spec.screen.w}" height="${spec.screen.h}" href="data:image/png;base64,${screenshotB64}"/>`,
      `<image x="0" y="0" width="${spec.canvas.w}" height="${spec.canvas.h}" href="data:image/png;base64,${frameB64}"/>`,
      `</svg>`,
    ].join('\n');
    fs.writeFileSync(outputPath, svgOut, 'utf8');
    return;
  }

  const composed = sharp({
    create: {
      width: spec.canvas.w,
      height: spec.canvas.h,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite([
    { input: screenshot, left: spec.screen.x, top: spec.screen.y },
    { input: frameBuffer, left: 0, top: 0 },
  ]);

  if (format === 'jpeg') await composed.jpeg({ quality: 90 }).toFile(outputPath);
  else await composed.png({ compressionLevel: 6 }).toFile(outputPath);
}

// ── Overlay compositing (transparent SVG outline drawn on top) ───────────────

async function roundedClip(img: Buffer, w: number, h: number, r: number): Promise<Buffer> {
  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
    `<rect width="${w}" height="${h}" rx="${r}" fill="white"/>` +
    `</svg>`,
  );
  return sharp(img)
    .composite([{ input: await sharp(mask).png().toBuffer(), blend: 'dest-in' }])
    .png()
    .toBuffer();
}

async function composeOverlay(
  inputPath: string, spec: FrameSpec, frameSvg: string,
  outputPath: string, format: Format,
): Promise<void> {
  const r = spec.cornerRadius ?? 0;

  let screenshot = await sharp(inputPath)
    .resize(spec.screen.w, spec.screen.h, { fit: 'cover', position: 'top' })
    .png()
    .toBuffer();

  if (r > 0) {
    screenshot = await roundedClip(screenshot, spec.screen.w, spec.screen.h, r);
  }

  if (format === 'svg') {
    const screenshotB64 = screenshot.toString('base64');
    const frameB64Svg = Buffer.from(frameSvg).toString('base64');
    const svgOut = [
      `<svg width="${spec.canvas.w}" height="${spec.canvas.h}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">`,
      `<image x="${spec.screen.x}" y="${spec.screen.y}" width="${spec.screen.w}" height="${spec.screen.h}" href="data:image/png;base64,${screenshotB64}"/>`,
      `<image x="0" y="0" width="${spec.canvas.w}" height="${spec.canvas.h}" href="data:image/svg+xml;base64,${frameB64Svg}"/>`,
      `</svg>`,
    ].join('\n');
    fs.writeFileSync(outputPath, svgOut, 'utf8');
    return;
  }

  const frameBuffer = await sharp(Buffer.from(frameSvg)).png().toBuffer();

  const composed = sharp({
    create: {
      width: spec.canvas.w,
      height: spec.canvas.h,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite([
    { input: screenshot, left: spec.screen.x, top: spec.screen.y },
    { input: frameBuffer, left: 0, top: 0 },
  ]);

  if (format === 'jpeg') await composed.jpeg({ quality: 90 }).toFile(outputPath);
  else await composed.png({ compressionLevel: 6 }).toFile(outputPath);
}

// ── Frame assets for the video pipeline ──────────────────────────────────────

export interface FrameAssets {
  spec: FrameSpec;
  // Canvas-sized PNG with a transparent screen hole (and transparent area
  // outside the device). Composited on top of every video frame by ffmpeg.
  overlayPng: Buffer;
  // screen-sized white-on-black rounded-rect luma mask for ffmpeg `alphamerge`,
  // or null when the bezel itself defines the rounded screen (vector frames).
  cornerMaskPng: Buffer | null;
}

// Builds the static overlay + corner mask once so the video compositing can run
// in a single ffmpeg pass. The rounded-corner handling mirrors the still
// pipeline: raster/overlay frames round the screen via `cornerRadius`, vector
// frames rely on the opaque bezel in the overlay covering the screen corners.
export async function buildFrameAssets(
  deviceInput: string,
  colorInput = getDefaultColor(deviceInput),
): Promise<FrameAssets> {
  const device = resolveDevice(deviceInput);
  const color = resolveColor(device, colorInput);
  const spec = FRAMES[device];

  const framePath = path.join(__dirname, 'frames', device, spec.colors[color]);
  const frameSvg = fs.readFileSync(framePath, 'utf8');

  const overlayPng = spec.frameType === 'raster'
    ? extractEmbeddedPng(frameSvg)
    : await sharp(Buffer.from(frameSvg)).png().toBuffer();

  const r = spec.cornerRadius ?? 0;
  let cornerMaskPng: Buffer | null = null;
  if (r > 0) {
    cornerMaskPng = await sharp(Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${spec.screen.w}" height="${spec.screen.h}">` +
      `<rect width="${spec.screen.w}" height="${spec.screen.h}" fill="black"/>` +
      `<rect width="${spec.screen.w}" height="${spec.screen.h}" rx="${r}" fill="white"/>` +
      `</svg>`,
    )).png().toBuffer();
  } else if (!spec.frameType || spec.frameType === 'vector') {
    // Vector frames rely on the SVG clip path for stills, but the video pipeline
    // composites a rasterised overlay PNG — which has transparent corner zones
    // outside the rounded phone body where the bezel elements don't reach.
    // Build a luma mask from the actual phone body path so alphamerge can clip
    // the recording to the correct rounded shape.
    const { phoneBody } = extractScreenMaskPaths(frameSvg);
    const maskSvg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${spec.screen.w}" height="${spec.screen.h}">` +
      `<path d="${phoneBody}" transform="translate(${-spec.screen.x},${-spec.screen.y})" fill="white"/>` +
      `</svg>`;
    cornerMaskPng = await sharp(Buffer.from(maskSvg)).png().toBuffer();
  }

  return { spec, overlayPng, cornerMaskPng };
}

// Makes the input readable by sharp. PNG/JPG/WebP/TIFF decode natively; HEIC/HEIF
// need a libheif HEVC plugin that isn't always present, so on decode failure we
// transparently fall back to decoding a single frame with ffmpeg.
async function ensureStillReadable(
  inputPath: string,
): Promise<{ path: string; cleanup: () => void }> {
  const noop = { path: inputPath, cleanup: () => {} };
  const ext = path.extname(inputPath).toLowerCase();
  if (ext !== '.heic' && ext !== '.heif') return noop;

  try {
    await sharp(inputPath).stats(); // forces a real decode
    return noop;
  } catch {
    if (!ffmpegAvailable()) {
      throw new Error(
        `Could not decode "${path.basename(inputPath)}". HEIC/HEIF support needs ffmpeg — install it with: brew install ffmpeg`,
      );
    }
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'screenflow-'));
    const pngPath = path.join(tmpDir, 'input.png');
    const { exitCode, stderr } = await runFfmpeg(['-y', '-i', inputPath, '-frames:v', '1', pngPath]);
    if (exitCode !== 0) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      throw new Error(`Could not decode "${path.basename(inputPath)}":\n${stderr}`);
    }
    return { path: pngPath, cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }) };
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function compose(
  inputPath: string,
  deviceInput: string,
  outputPath: string,
  format: Format = 'svg',
  colorInput = getDefaultColor(deviceInput),
): Promise<void> {
  const device = resolveDevice(deviceInput);
  const color = resolveColor(device, colorInput);
  const spec = FRAMES[device];

  const framePath = path.join(__dirname, 'frames', device, spec.colors[color]);
  const frameSvg = fs.readFileSync(framePath, 'utf8');

  const { path: input, cleanup } = await ensureStillReadable(inputPath);
  try {
    if (spec.frameType === 'raster') {
      await composeRaster(input, spec, frameSvg, outputPath, format);
    } else if (spec.frameType === 'overlay') {
      await composeOverlay(input, spec, frameSvg, outputPath, format);
    } else {
      await composeVector(input, spec, frameSvg, outputPath, format);
    }
  } finally {
    cleanup();
  }
}
