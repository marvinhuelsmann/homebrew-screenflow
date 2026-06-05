import path from 'path';
import os from 'os';
import fs from 'fs';
import sharp from 'sharp';
import { compose } from '../composer';
import { Config } from '../config';
import { DEFAULT_DEVICE, getDefaultColor, hasFrameColor } from '../frames';
import { bold, cyan, dim, dot, fmtName, green, Spinner } from '../ui';
import { detectInputKind } from '../ffmpeg';

interface AppStoreOptions {
  output?: string;
  color?: string;
  device?: string;
  caption?: string;
  align?: string;
  bg?: string;
  jpeg?: boolean;
}

// App Store Connect 6.9" portrait (iPhone 16/15 Pro Max) — a mandatory size.
const CANVAS_W = 1290;
const CANVAS_H = 2796;

// Layout constants (tuned against the 1290×2796 canvas).
const SIDE_MARGIN   = 96;   // text block left/right inset
const TOP_MARGIN    = 150;  // gap above the caption
const TEXT_GAP      = 110;  // gap between caption and device
const DEVICE_INSET  = 150;  // device left/right inset (breathing room)
const BOTTOM_MARGIN = 96;   // gap below the device

type Align = 'left' | 'center' | 'right';

// #RGB / #RRGGBB / RRGGBB → {r,g,b}. Throws on anything else.
function parseHexColor(input: string): { r: number; g: number; b: number } {
  let h = input.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(h)) h = h.split('').map(c => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) {
    throw new Error(`Invalid --bg color "${input}". Use a hex color like "#0A84FF" or "1c1c1e".`);
  }
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

// Relative luminance (sRGB) → pick black or white text for best contrast.
function contrastText(bg: { r: number; g: number; b: number }): string {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const L = 0.2126 * lin(bg.r) + 0.7152 * lin(bg.g) + 0.0722 * lin(bg.b);
  return L > 0.4 ? '#000000' : '#FFFFFF';
}

// Pango/SVG markup needs the usual XML entities escaped.
function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export async function appstoreAction(file: string, options: AppStoreOptions): Promise<void> {
  const config = new Config();
  const device = options.device ?? config.device ?? DEFAULT_DEVICE;
  const color = options.color
    ?? (!options.device && config.color && hasFrameColor(device, config.color)
      ? config.color
      : getDefaultColor(device));

  const inputPath = path.resolve(file);
  if (detectInputKind(inputPath) === 'video') {
    throw new Error('App Store screenshots are still images — pass a screenshot (PNG/JPG/HEIC), not a screen recording.');
  }

  const align = (options.align ?? 'center').toLowerCase() as Align;
  if (!['left', 'center', 'right'].includes(align)) {
    throw new Error(`--align must be left, center, or right (got "${options.align}")`);
  }

  const bg = parseHexColor(options.bg ?? '#0A84FF');
  const textColor = contrastText(bg);

  const base = path.basename(inputPath, path.extname(inputPath));
  const dir = path.dirname(inputPath);
  const jpeg = options.jpeg || /\.jpe?g$/i.test(options.output ?? '');
  const outExt = jpeg ? '.jpg' : '.png';
  const outputPath = options.output
    ? path.resolve(options.output)
    : path.join(dir, `${base}_${device}_appstore${outExt}`);

  const composeLabel = `App Store ${bold(fmtName(device))}${dot()}${bold(fmtName(color))}${dot()}${dim('1290×2796')}`;
  const s = new Spinner(`${composeLabel}...`);
  s.start();

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'screenflow-'));
  try {
    // 1. Frame the screenshot in the device (transparent PNG at spec.canvas size).
    const devicePng = path.join(tmpDir, 'device.png');
    await compose(inputPath, device, devicePng, 'png', color);

    // 2. Render the caption (auto-contrast, wrapped, aligned) — if provided.
    let textBuf: Buffer | null = null;
    let textH = 0;
    if (options.caption && options.caption.trim()) {
      const pangoAlign = align === 'center' ? 'centre' : align;
      // Turn literal "\n" (as typed in the shell) into real line breaks; Pango
      // honours actual newlines for manual line wrapping.
      const caption = options.caption.replace(/\\n/g, '\n').trim();
      const markup = `<span foreground="${textColor}">${escapeXml(caption)}</span>`;
      textBuf = await sharp({
        text: {
          text: markup,
          // SF Pro Display — Apple's system font, resolved via CoreText on macOS.
          font: 'SF Pro Display Bold 116',
          rgba: true,
          width: CANVAS_W - 2 * SIDE_MARGIN,
          align: pangoAlign as 'left' | 'centre' | 'right',
          dpi: 72,
          spacing: 14,
        },
      }).png().toBuffer();
      textH = (await sharp(textBuf).metadata()).height ?? 0;
    }

    // 3. Fit the device into the region below the caption.
    const deviceTop = textBuf ? TOP_MARGIN + textH + TEXT_GAP : TOP_MARGIN;
    const availW = CANVAS_W - 2 * DEVICE_INSET;
    const availH = CANVAS_H - deviceTop - BOTTOM_MARGIN;
    const dMeta = await sharp(devicePng).metadata();
    const dW = dMeta.width!;
    const dH = dMeta.height!;
    const scale = Math.min(availW / dW, availH / dH);
    const newW = Math.max(1, Math.round(dW * scale));
    const newH = Math.max(1, Math.round(dH * scale));
    const deviceResized = await sharp(devicePng)
      .resize(newW, newH, { kernel: 'lanczos3', fit: 'fill' })
      .png()
      .toBuffer();

    // Center the device horizontally; sit it just below the caption, vertically
    // centered within the remaining space so short captions don't float it high.
    const deviceLeft = Math.round((CANVAS_W - newW) / 2);
    const deviceTopFinal = Math.round(deviceTop + (availH - newH) / 2);

    // 4. Composite: solid background → caption (top) → device.
    const layers: sharp.OverlayOptions[] = [];
    if (textBuf) {
      // Align the text block within the side margins.
      const tW = (await sharp(textBuf).metadata()).width ?? (CANVAS_W - 2 * SIDE_MARGIN);
      const textLeft = align === 'left'
        ? SIDE_MARGIN
        : align === 'right'
          ? CANVAS_W - SIDE_MARGIN - tW
          : Math.round((CANVAS_W - tW) / 2);
      layers.push({ input: textBuf, left: textLeft, top: TOP_MARGIN });
    }
    layers.push({ input: deviceResized, left: deviceLeft, top: deviceTopFinal });

    const canvas = sharp({
      create: { width: CANVAS_W, height: CANVAS_H, channels: 4, background: { ...bg, alpha: 1 } },
    }).composite(layers);

    if (jpeg) await canvas.jpeg({ quality: 92 }).toFile(outputPath);
    else await canvas.png({ compressionLevel: 6 }).toFile(outputPath);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  s.stop(`${cyan('✦')} ${composeLabel}`);
  console.log(`${green('✓')} Saved ${dim('→')} ${bold(path.basename(outputPath))}`);
}
