import sharp from 'sharp';
import * as fs from 'fs';
import * as path from 'path';
import { FRAMES, DEFAULT_DEVICE, FrameSpec } from './frames';

export type Format = 'svg' | 'png' | 'jpeg';

export const DEVICES = Object.keys(FRAMES);

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

function extractPhoneBodyPath(svgContent: string): string {
  const match = svgContent.match(/<path[^>]+id="Screen mask"[^>]+d="([^"]+)"/);
  if (!match) throw new Error('Could not find Screen mask path in SVG frame');
  const parts = match[1].split('Z');
  if (parts.length < 2) throw new Error('Unexpected Screen mask path format');
  return parts[1].trim() + 'Z';
}

function buildVectorSvg(
  frameSvg: string,
  screenshotB64: string,
  screen: { x: number; y: number; w: number; h: number },
): string {
  const phoneBodyPath = extractPhoneBodyPath(frameSvg);
  const defs = [
    `<defs>`,
    `<clipPath id="sf-screen-clip"><path d="${phoneBodyPath}"/></clipPath>`,
    `</defs>`,
  ].join('');
  const image = `<image clip-path="url(#sf-screen-clip)" x="${screen.x}" y="${screen.y}" width="${screen.w}" height="${screen.h}" href="data:image/png;base64,${screenshotB64}"/>`;
  return frameSvg
    .replace('<svg ', '<svg xmlns:xlink="http://www.w3.org/1999/xlink" ')
    .replace('<g id="Phone">', `<g id="Phone">${defs}${image}`);
}

async function composeVector(
  inputPath: string, spec: FrameSpec, frameSvg: string,
  outputPath: string, format: Format,
): Promise<void> {
  const screenshot = await sharp(inputPath)
    .resize(spec.screen.w, spec.screen.h, { fit: 'cover', position: 'top' })
    .png()
    .toBuffer();

  const compositeSvg = buildVectorSvg(frameSvg, screenshot.toString('base64'), spec.screen);

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

  const screenshot = await sharp(inputPath)
    .resize(spec.screen.w, spec.screen.h, { fit: 'cover', position: 'top' })
    .png()
    .toBuffer();

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

// ── Public API ────────────────────────────────────────────────────────────────

export async function compose(
  inputPath: string,
  deviceInput: string,
  outputPath: string,
  format: Format = 'svg',
  colorInput = 'silver',
): Promise<void> {
  const device = resolveDevice(deviceInput);
  const color = resolveColor(device, colorInput);
  const spec = FRAMES[device];

  const framePath = path.join(__dirname, 'frames', device, spec.colors[color]);
  const frameSvg = fs.readFileSync(framePath, 'utf8');

  if (spec.frameType === 'raster') {
    await composeRaster(inputPath, spec, frameSvg, outputPath, format);
  } else {
    await composeVector(inputPath, spec, frameSvg, outputPath, format);
  }
}
