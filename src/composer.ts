import sharp from 'sharp';
import * as fs from 'fs';
import * as path from 'path';
import { FRAMES, DEFAULT_DEVICE } from './frames';

export type Format = 'svg' | 'png' | 'jpeg';

export const DEVICES = Object.keys(FRAMES);
export const COLORS = Object.keys(FRAMES[DEFAULT_DEVICE].colors);

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

function extractPhoneBodyPath(svgContent: string): string {
  const match = svgContent.match(/<path[^>]+id="Screen mask"[^>]+d="([^"]+)"/);
  if (!match) throw new Error('Could not find Screen mask path in SVG frame');
  // Path format: outer_rect Z phone_body Z DI_pill Z — take the phone body (second subpath)
  const parts = match[1].split('Z');
  if (parts.length < 2) throw new Error('Unexpected Screen mask path format');
  return parts[1].trim() + 'Z';
}

function buildCompositeSvg(
  frameSvg: string,
  screenshotB64: string,
  screen: { x: number; y: number; w: number; h: number },
): string {
  const phoneBodyPath = extractPhoneBodyPath(frameSvg);

  const defs = [
    `<defs>`,
    `<clipPath id="sf-screen-clip">`,
    `<path d="${phoneBodyPath}"/>`,
    `</clipPath>`,
    `</defs>`,
  ].join('');

  const image = `<image clip-path="url(#sf-screen-clip)" x="${screen.x}" y="${screen.y}" width="${screen.w}" height="${screen.h}" href="data:image/png;base64,${screenshotB64}"/>`;

  return frameSvg
    .replace('<svg ', '<svg xmlns:xlink="http://www.w3.org/1999/xlink" ')
    .replace('<g id="Phone">', `<g id="Phone">${defs}${image}`);
}

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

  const screenshot = await sharp(inputPath)
    .resize(spec.screen.w, spec.screen.h, { fit: 'cover', position: 'top' })
    .png()
    .toBuffer();

  const compositeSvg = buildCompositeSvg(frameSvg, screenshot.toString('base64'), spec.screen);

  if (format === 'svg') {
    fs.writeFileSync(outputPath, compositeSvg, 'utf8');
    return;
  }

  const rendered = sharp(Buffer.from(compositeSvg));
  if (format === 'jpeg') {
    await rendered.jpeg({ quality: 90 }).toFile(outputPath);
  } else {
    await rendered.png({ compressionLevel: 6 }).toFile(outputPath);
  }
}
