import sharp from 'sharp';
import * as fs from 'fs';
import * as path from 'path';

export type Color = 'silver' | 'deep-blue' | 'cosmic-orange';
export type Format = 'svg' | 'png' | 'jpeg';

const CANVAS = { w: 880, h: 1832 };
// Transparent screen area measured from rendered frame (pixel transitions)
const SCREEN = { x: 38, y: 42, w: 804, h: 1748 };

const COLOR_FILES: Record<Color, string> = {
  'silver': 'iPhone_17_Pro_Silver.svg',
  'deep-blue': 'iPhone_17_Pro_Deep_Blue.svg',
  'cosmic-orange': 'iPhone_17_Pro_CosmicOrange.svg',
};

export const COLORS = Object.keys(COLOR_FILES) as Color[];

function resolveColor(input: string): Color {
  const normalized = input.toLowerCase().trim();
  if (normalized in COLOR_FILES) return normalized as Color;
  throw new Error(`Unknown color "${input}". Available: ${COLORS.join(', ')}`);
}

function extractPhoneBodyPath(svgContent: string): string {
  const match = svgContent.match(/<path[^>]+id="Screen mask"[^>]+d="([^"]+)"/);
  if (!match) throw new Error('Could not find Screen mask path in SVG frame');
  // Path format: outer_rect Z phone_body Z DI_pill Z — take the phone body (second subpath)
  const parts = match[1].split('Z');
  if (parts.length < 2) throw new Error('Unexpected Screen mask path format');
  return parts[1].trim() + 'Z';
}

function buildCompositeSvg(frameSvg: string, screenshotB64: string): string {
  const phoneBodyPath = extractPhoneBodyPath(frameSvg);

  const defs = [
    `<defs>`,
    `<clipPath id="sf-screen-clip">`,
    `<path d="${phoneBodyPath}"/>`,
    `</clipPath>`,
    `</defs>`,
  ].join('');

  const image = `<image clip-path="url(#sf-screen-clip)" x="${SCREEN.x}" y="${SCREEN.y}" width="${SCREEN.w}" height="${SCREEN.h}" href="data:image/png;base64,${screenshotB64}"/>`;

  // Add xlink namespace for broad SVG viewer compatibility and inject screenshot behind phone chrome
  return frameSvg
    .replace('<svg ', '<svg xmlns:xlink="http://www.w3.org/1999/xlink" ')
    .replace('<g id="Phone">', `<g id="Phone">${defs}${image}`);
}

export async function compose(
  inputPath: string,
  _deviceId: string,
  outputPath: string,
  format: Format = 'svg',
  colorInput = 'silver',
): Promise<void> {
  const color = resolveColor(colorInput);
  const framePath = path.join(__dirname, 'frames', COLOR_FILES[color]);
  const frameSvg = fs.readFileSync(framePath, 'utf8');

  const screenshot = await sharp(inputPath)
    .resize(SCREEN.w, SCREEN.h, { fit: 'cover', position: 'top' })
    .png()
    .toBuffer();

  const compositeSvg = buildCompositeSvg(frameSvg, screenshot.toString('base64'));

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
