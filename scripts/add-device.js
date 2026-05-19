#!/usr/bin/env node
/**
 * Usage: node scripts/add-device.js <device-id> [display-name]
 *
 * Example: node scripts/add-device.js ipad-pro-13 'iPad Pro 13"'
 *
 * What it does:
 *  1. Reads SVGs from src/frames/<device-id>/
 *  2. Detects frame type (vector/raster) and computes screen coordinates
 *  3. Updates src/frames/index.ts — registers the device
 *  4. Updates package.json — adds cp to build script
 *  5. Updates completions/_screenflow — adds device + colors
 *  6. Updates completions/screenflow.fish — adds device + colors
 *  7. Updates README.md — adds row to device table
 */

const fs   = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT      = path.join(__dirname, '..');
const deviceId  = process.argv[2];
const displayArg = process.argv[3];

if (!deviceId) {
  console.error('Usage: node scripts/add-device.js <device-id> [display-name]');
  process.exit(1);
}

const framesDir = path.join(ROOT, 'src', 'frames', deviceId);
if (!fs.existsSync(framesDir)) {
  console.error(`Directory not found: src/frames/${deviceId}`);
  process.exit(1);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toDisplayName(id) {
  const parts = id.split('-');
  return parts.map((p, i) => {
    if (p === 'iphone') return 'iPhone';
    if (p === 'ipad')   return 'iPad';
    if (p === 'pro')    return 'Pro';
    if (p === 'mini')   return 'Mini';
    if (p === 'air')    return 'Air';
    // Trailing number → treat as screen size
    if (/^\d+$/.test(p) && i === parts.length - 1) return p + '"';
    return p.charAt(0).toUpperCase() + p.slice(1);
  }).join(' ');
}

function toColorDisplayName(colorId) {
  return colorId.split('-').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
}

function parseSvgCanvas(svgContent) {
  const m = svgContent.match(/<svg[^>]+width="([^"]+)"[^>]+height="([^"]+)"/);
  if (m) return { w: parseInt(m[1]), h: parseInt(m[2]) };
  const vb = svgContent.match(/viewBox="0 0 (\d+) (\d+)"/);
  if (vb) return { w: parseInt(vb[1]), h: parseInt(vb[2]) };
  throw new Error('Could not parse canvas size from SVG');
}

async function detectScreenFromBuffer(pngBuffer, xFraction = 0.5) {
  const { data, info } = await sharp(pngBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  // Scan at xFraction column for y transitions, find largest transparent span = screen
  const cx = Math.floor(width * xFraction);
  const ySegs = [];
  let segStart = 0;
  let segOpaque = data[cx * channels + 3] > 10;
  for (let y = 1; y < height; y++) {
    const opaque = data[(y * width + cx) * channels + 3] > 10;
    if (opaque !== segOpaque) {
      ySegs.push({ start: segStart, end: y - 1, opaque: segOpaque });
      segStart = y;
      segOpaque = opaque;
    }
  }
  ySegs.push({ start: segStart, end: height - 1, opaque: segOpaque });

  const screenYSeg = ySegs
    .filter(s => !s.opaque)
    .sort((a, b) => (b.end - b.start) - (a.end - a.start))[0];
  if (!screenYSeg) throw new Error('Could not find transparent screen region in Y axis');

  const screenTop    = screenYSeg.start;
  const screenBottom = screenYSeg.end;
  const midY         = Math.floor((screenTop + screenBottom) / 2);

  // Scan that row for x transitions
  const xSegs = [];
  let xSegStart = 0;
  let xSegOpaque = data[(midY * width) * channels + 3] > 10;
  for (let x = 1; x < width; x++) {
    const opaque = data[(midY * width + x) * channels + 3] > 10;
    if (opaque !== xSegOpaque) {
      xSegs.push({ start: xSegStart, end: x - 1, opaque: xSegOpaque });
      xSegStart = x;
      xSegOpaque = opaque;
    }
  }
  xSegs.push({ start: xSegStart, end: width - 1, opaque: xSegOpaque });

  const screenXSeg = xSegs
    .filter(s => !s.opaque)
    .sort((a, b) => (b.end - b.start) - (a.end - a.start))[0];
  if (!screenXSeg) throw new Error('Could not find transparent screen region in X axis');

  return {
    canvas: { w: width, h: height },
    screen: {
      x: screenXSeg.start,
      y: screenTop,
      w: screenXSeg.end - screenXSeg.start + 1,
      h: screenBottom - screenTop + 1,
    },
  };
}

async function detectRasterScreen(svgContent) {
  const match = svgContent.match(/xlink:href="data:image\/png;base64,([^"]+)"/);
  if (!match) throw new Error('No embedded PNG found in raster frame SVG');
  return detectScreenFromBuffer(Buffer.from(match[1], 'base64'));
}

function detectCornerRadius(svgContent) {
  // Find all closed rects with both rx and stroke-width, pick the one with the largest rx
  // Inner radius = rx - stroke-width/2
  let maxInnerRx = 0;
  for (const m of svgContent.matchAll(/<rect([^>]+)\/>/g)) {
    const attrs = m[1];
    const rxM = attrs.match(/rx="([^"]+)"/);
    const swM = attrs.match(/stroke-width="([^"]+)"/);
    if (rxM && swM) {
      const inner = parseFloat(rxM[1]) - parseFloat(swM[1]) / 2;
      if (inner > maxInnerRx) maxInnerRx = inner;
    }
  }
  return Math.round(maxInnerRx);
}

async function detectOverlayScreen(svgContent) {
  const pngBuffer = await sharp(Buffer.from(svgContent)).png().toBuffer();
  // Scan at 15% from left to avoid center notch/dynamic-island blocking the top boundary
  return detectScreenFromBuffer(pngBuffer, 0.15);
}

// ── File updaters ─────────────────────────────────────────────────────────────

function updateFramesIndex(deviceId, frameType, canvas, screen, colors, cornerRadius) {
  const filePath = path.join(ROOT, 'src', 'frames', 'index.ts');
  let content = fs.readFileSync(filePath, 'utf8');

  if (content.includes(`'${deviceId}':`)) {
    console.log(`  ⚠  ${deviceId} already in frames/index.ts — skipping`);
    return;
  }

  const colorLines = colors.map(c => `      '${c}': '${c}.svg',`).join('\n');
  const frameTypeLine = (frameType === 'raster' || frameType === 'overlay')
    ? `\n    frameType: '${frameType}',` : '';
  const cornerRadiusLine = (frameType === 'overlay' && cornerRadius > 0)
    ? `\n    cornerRadius: ${cornerRadius},` : '';

  const entry = `  '${deviceId}': {
    canvas: { w: ${canvas.w}, h: ${canvas.h} },
    screen: { x: ${screen.x}, y: ${screen.y}, w: ${screen.w}, h: ${screen.h} },${frameTypeLine}${cornerRadiusLine}
    colors: {
${colorLines}
    },
  },`;

  content = content.replace(/^};$/m, `${entry}\n};`);
  fs.writeFileSync(filePath, content, 'utf8');
}

function updatePackageJson(deviceId) {
  const filePath = path.join(ROOT, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const buildScript = pkg.scripts.build;
  const cpCmd = `cp -r src/frames/${deviceId} dist/frames/`;

  if (buildScript.includes(cpCmd)) {
    console.log(`  ⚠  ${deviceId} already in package.json build — skipping`);
    return;
  }

  pkg.scripts.build = buildScript + ` && ${cpCmd}`;
  fs.writeFileSync(filePath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
}

function updateZshCompletion(deviceId, colors, displayName) {
  const filePath = path.join(ROOT, 'completions', '_screenflow');
  let content = fs.readFileSync(filePath, 'utf8');

  if (content.includes(`${deviceId})`)) {
    console.log(`  ⚠  ${deviceId} already in _screenflow — skipping`);
    return;
  }

  // Add case block
  const colorEntries = colors.map(c => `'${c}:${toColorDisplayName(c)}'`).join(' ');
  const caseBlock = `    ${deviceId})\n      colors=(${colorEntries})\n      ;;`;
  content = content.replace(/(\s+\*\)\n\s+colors=\('silver:Silver \(default\)'\)\n\s+;;)/, `\n${caseBlock}$1`);

  // Add to devices array
  content = content.replace(
    /(devices=\(.*?)('\))/,
    `$1 '${deviceId}:${displayName}'$2`
  );

  fs.writeFileSync(filePath, content, 'utf8');
}

function updateFishCompletion(deviceId, colors, displayName) {
  const filePath = path.join(ROOT, 'completions', 'screenflow.fish');
  let content = fs.readFileSync(filePath, 'utf8');

  if (content.includes(`--device ${deviceId}`)) {
    console.log(`  ⚠  ${deviceId} already in screenflow.fish — skipping`);
    return;
  }

  // Add to device list
  content = content.replace(
    /(-a '.*?)'$/m,
    `$1 ${deviceId}\\t"${displayName}"'`
  );

  // Append color block
  const colorCompletions = colors.map(c => `${c}\\t"${toColorDisplayName(c)}"`).join(' ');
  content += `\ncomplete -c screenflow -l color -r -d 'Frame color' \\\n  -n '__fish_seen_argument --device ${deviceId}' \\\n  -a '${colorCompletions}'\n`;

  fs.writeFileSync(filePath, content, 'utf8');
}

function updateReadme(deviceId, colors, displayName) {
  const filePath = path.join(ROOT, 'README.md');
  let content = fs.readFileSync(filePath, 'utf8');

  if (content.includes(`\`${deviceId}\``)) {
    console.log(`  ⚠  ${deviceId} already in README — skipping`);
    return;
  }

  const colorList = colors.map(c => `\`${c}\``).join(', ');
  const row = `| ${displayName} | \`${deviceId}\` | ${colorList} |`;
  content = content.replace(/(^\| .+ \|\n)(^---$)/m, `$1${row}\n$2`);

  fs.writeFileSync(filePath, content, 'utf8');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const displayName = displayArg ?? toDisplayName(deviceId);

  // Collect SVG files
  const svgFiles = fs.readdirSync(framesDir).filter(f => f.endsWith('.svg'));
  if (svgFiles.length === 0) {
    console.error(`No SVG files found in src/frames/${deviceId}/`);
    process.exit(1);
  }

  const colors = svgFiles.map(f => path.basename(f, '.svg'));
  console.log(`\nDevice:   ${deviceId}`);
  console.log(`Display:  ${displayName}`);
  console.log(`Colors:   ${colors.join(', ')}`);

  // Detect frame type and screen from first SVG
  const firstSvg = fs.readFileSync(path.join(framesDir, svgFiles[0]), 'utf8');
  const isVector = firstSvg.includes('id="Screen mask"');
  const isRaster = firstSvg.includes('data:image/png;base64');

  let frameType, canvas, screen, cornerRadius;

  if (isVector) {
    frameType = 'vector';
    canvas = parseSvgCanvas(firstSvg);
    // Vector screen coords come from the SVG path — use placeholder, user must set
    console.log(`\nFrame type: vector`);
    console.log(`Canvas: ${canvas.w} x ${canvas.h}`);
    console.log(`⚠  Vector frame detected — screen coords must be measured manually.`);
    console.log(`   Update src/frames/index.ts after running this script.`);
    screen = { x: 0, y: 0, w: canvas.w, h: canvas.h };
  } else if (isRaster) {
    frameType = 'raster';
    process.stdout.write('\nDetecting screen bounds from PNG... ');
    ({ canvas, screen } = await detectRasterScreen(firstSvg));
    console.log('done');
    console.log(`Frame type: raster`);
    console.log(`Canvas: ${canvas.w} x ${canvas.h}`);
    console.log(`Screen: x=${screen.x} y=${screen.y} w=${screen.w} h=${screen.h}`);
  } else {
    // Transparent SVG overlay (strokes/outlines on transparent background)
    frameType = 'overlay';
    canvas = parseSvgCanvas(firstSvg);
    process.stdout.write('\nDetecting screen bounds from rendered SVG... ');
    ({ canvas, screen } = await detectOverlayScreen(firstSvg));
    console.log('done');
    cornerRadius = detectCornerRadius(firstSvg);
    console.log(`Frame type: overlay`);
    console.log(`Canvas: ${canvas.w} x ${canvas.h}`);
    console.log(`Screen: x=${screen.x} y=${screen.y} w=${screen.w} h=${screen.h}`);
    console.log(`Corner radius: ${cornerRadius}`);
  }

  console.log('\nUpdating files:');

  process.stdout.write('  src/frames/index.ts ... ');
  updateFramesIndex(deviceId, frameType, canvas, screen, colors, cornerRadius ?? 0);
  console.log('done');

  process.stdout.write('  package.json ... ');
  updatePackageJson(deviceId);
  console.log('done');

  process.stdout.write('  completions/_screenflow ... ');
  updateZshCompletion(deviceId, colors, displayName);
  console.log('done');

  process.stdout.write('  completions/screenflow.fish ... ');
  updateFishCompletion(deviceId, colors, displayName);
  console.log('done');

  process.stdout.write('  README.md ... ');
  updateReadme(deviceId, colors, displayName);
  console.log('done');

  console.log(`\nDone! Run 'npm run build' to verify.\n`);
}

main().catch(err => { console.error(err.message); process.exit(1); });
