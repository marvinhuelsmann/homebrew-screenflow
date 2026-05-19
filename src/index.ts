#!/usr/bin/env node
import { Command } from 'commander';
import path from 'path';
import { compose, COLORS, DEVICES } from './composer';
import { DEFAULT_DEVICE } from './frames/index';
import { version } from '../package.json';

const program = new Command();

program
  .name('screenflow')
  .description('Wrap simulator screenshots in a device frame — pixel-perfect, no clock, no Dynamic Island')
  .version(version, '-v, --version');

program
  .argument('<file>', 'Screenshot image file (PNG, JPG)')
  .option('-o, --output <path>', 'Output file path')
  .option('--png', 'Output as PNG instead of SVG')
  .option('--jpeg', 'Output as JPEG instead of SVG')
  .option('--color <color>', `Frame color: ${COLORS.join(', ')}`, 'silver')
  .option('--device <device>', `Device frame: ${DEVICES.join(', ')}`, DEFAULT_DEVICE)
  .option('--author', 'About the author')
  .action(async (file: string, options: { output?: string; png?: boolean; jpeg?: boolean; color: string; device: string; author?: boolean }) => {
    if (options.author) {
      console.log('');
      console.log('  Screenflow is made by Marvin Hülsmann');
      console.log('  Website  →  https://marvhuelsmann.com');
      console.log('  X        →  https://x.com/marvhuelsmann');
      console.log('');
      console.log('  in berlin, germany');
      process.exit(0);
    }

    const inputPath = path.resolve(file);
    const base = path.basename(inputPath, path.extname(inputPath));
    const dir = path.dirname(inputPath);

    let outExt = '.svg';
    const format = options.jpeg ? 'jpeg' : options.png ? 'png' : 'svg';
    if (format === 'png') outExt = '.png';
    else if (format === 'jpeg') outExt = '.jpeg';

    const outputPath = options.output
      ? path.resolve(options.output)
      : path.join(dir, `${base}_${options.device}${outExt}`);

    try {
      process.stdout.write(`Framing ${path.basename(inputPath)} → ${path.basename(outputPath)} ... `);
      await compose(inputPath, options.device, outputPath, format, options.color);
      console.log('done');
    } catch (err) {
      console.error('');
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

if (process.argv.length <= 2) program.help();
if (process.argv.includes('--author')) {
  console.log('');
  console.log('  Screenflow is made by Marvin Hülsmann');
  console.log('  Website  →  https://marvhuelsmann.com');
  console.log('  X        →  https://x.com/marvhuelsmann');
  console.log('');
  console.log('  in berlin, germany');
  process.exit(0);
}
program.parse();
