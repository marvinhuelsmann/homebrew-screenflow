#!/usr/bin/env node
/**
 * Usage: node scripts/add-color.js <device-id>
 *
 * Scans src/frames/<device-id>/ for SVG files, compares against colors already
 * registered in src/frames/index.ts, and adds every missing color to:
 *   1. src/frames/index.ts
 *   2. completions/_screenflow
 *   3. completions/screenflow.fish
 *   4. README.md
 */

const fs   = require('fs');
const path = require('path');

const ROOT     = path.join(__dirname, '..');
const deviceId = process.argv[2];

if (!deviceId) {
  console.error('Usage: node scripts/add-color.js <device-id>');
  process.exit(1);
}

const framesDir = path.join(ROOT, 'src', 'frames', deviceId);
if (!fs.existsSync(framesDir)) {
  console.error(`Directory not found: src/frames/${deviceId}`);
  process.exit(1);
}

function toDisplayName(id) {
  return id.split('-').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
}

// ── Read what is already registered in index.ts ───────────────────────────────

function getRegisteredColors() {
  const filePath = path.join(ROOT, 'src', 'frames', 'index.ts');
  const content  = fs.readFileSync(filePath, 'utf8');

  if (!content.includes(`'${deviceId}':`)) {
    throw new Error(`Device '${deviceId}' not found in frames/index.ts — run add-device first`);
  }

  const deviceIdx  = content.indexOf(`'${deviceId}':`);
  const colorsIdx  = content.indexOf('colors: {', deviceIdx);
  const closingIdx = content.indexOf('\n    },', colorsIdx);
  const colorsBlock = content.slice(colorsIdx, closingIdx);

  const registered = new Set();
  const re = /'([^']+)':\s*'[^']+\.svg'/g;
  let m;
  while ((m = re.exec(colorsBlock)) !== null) registered.add(m[1]);
  return registered;
}

// ── Updaters (each re-reads the file so multiple calls are safe) ──────────────

function updateFramesIndex(colorId) {
  const filePath = path.join(ROOT, 'src', 'frames', 'index.ts');
  let content = fs.readFileSync(filePath, 'utf8');

  const deviceIdx  = content.indexOf(`'${deviceId}':`);
  const colorsIdx  = content.indexOf('colors: {', deviceIdx);
  const closingIdx = content.indexOf('\n    },', colorsIdx);
  if (closingIdx === -1) throw new Error(`colors closing brace not found for '${deviceId}'`);

  content = content.slice(0, closingIdx)
    + `\n      '${colorId}': '${colorId}.svg',`
    + content.slice(closingIdx);

  fs.writeFileSync(filePath, content, 'utf8');
}

function updateZshCompletion(colorId, displayName) {
  const filePath = path.join(ROOT, 'completions', '_screenflow');
  let content = fs.readFileSync(filePath, 'utf8');

  const re = new RegExp(`(    ${deviceId}\\)\\n      colors=\\([^)]*)(\\)\\n      ;;)`);
  if (!re.test(content)) throw new Error(`Case block for '${deviceId}' not found in _screenflow`);

  content = content.replace(re, `$1 '${colorId}:${displayName}'$2`);
  fs.writeFileSync(filePath, content, 'utf8');
}

function updateFishCompletion(colorId, displayName) {
  const filePath = path.join(ROOT, 'completions', 'screenflow.fish');
  let content = fs.readFileSync(filePath, 'utf8');

  const marker   = `--device ${deviceId}'`;
  const blockIdx = content.lastIndexOf(marker);
  if (blockIdx === -1) throw new Error(`Fish completion block for '${deviceId}' not found — run add-device first`);

  const aIdx = content.indexOf(`-a '`, blockIdx);
  if (aIdx === -1) throw new Error(`-a argument not found for '${deviceId}'`);

  const closeIdx = content.indexOf(`'`, aIdx + 4);
  if (closeIdx === -1) throw new Error(`Closing quote for -a not found for '${deviceId}'`);

  content = content.slice(0, closeIdx)
    + ` ${colorId}\\t"${displayName}"`
    + content.slice(closeIdx);

  fs.writeFileSync(filePath, content, 'utf8');
}

function updateReadme(colorId) {
  const filePath = path.join(ROOT, 'README.md');
  let content = fs.readFileSync(filePath, 'utf8');

  const re = new RegExp(`(\\|[^|]+\\| \`${deviceId}\` \\| )([^|\\n]+?)(\\s*\\|)`);
  if (!re.test(content)) throw new Error(`Device row for '${deviceId}' not found in README.md`);

  content = content.replace(re, `$1$2, \`${colorId}\`$3`);
  fs.writeFileSync(filePath, content, 'utf8');
}

// ── Main ──────────────────────────────────────────────────────────────────────

const allColors = fs.readdirSync(framesDir)
  .filter(f => f.endsWith('.svg'))
  .map(f => path.basename(f, '.svg'))
  .sort();

if (allColors.length === 0) {
  console.error(`No SVG files found in src/frames/${deviceId}/`);
  process.exit(1);
}

let registered;
try {
  registered = getRegisteredColors();
} catch (err) {
  console.error('\nError:', err.message);
  process.exit(1);
}

const newColors = allColors.filter(c => !registered.has(c));

console.log(`\nDevice:     ${deviceId}`);
console.log(`Registered: ${[...registered].join(', ') || '(none)'}`);
console.log(`In folder:  ${allColors.join(', ')}`);

if (newColors.length === 0) {
  console.log('\nAll colors already registered — nothing to do.\n');
  process.exit(0);
}

console.log(`New:        ${newColors.join(', ')}\n`);

for (const colorId of newColors) {
  const displayName = toDisplayName(colorId);
  console.log(`Adding "${colorId}" (${displayName}):`);

  try {
    process.stdout.write('  src/frames/index.ts ... ');
    updateFramesIndex(colorId);
    console.log('done');

    process.stdout.write('  completions/_screenflow ... ');
    updateZshCompletion(colorId, displayName);
    console.log('done');

    process.stdout.write('  completions/screenflow.fish ... ');
    updateFishCompletion(colorId, displayName);
    console.log('done');

    process.stdout.write('  README.md ... ');
    updateReadme(colorId);
    console.log('done\n');
  } catch (err) {
    console.error('\nError:', err.message);
    process.exit(1);
  }
}

console.log(`Done! Run 'npm run build' to verify.\n`);
