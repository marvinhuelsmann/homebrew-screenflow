#!/usr/bin/env node
import { Command } from 'commander';
import path from 'path';
import { compose, COLORS } from './composer';

const program = new Command();

program
  .name('screenflow')
  .description('Wrap simulator screenshots in a device frame — pixel-perfect, no clock, no Dynamic Island')
  .version('0.1.0');

program
  .argument('<file>', 'Screenshot image file (PNG, JPG)')
  .argument('[device]', 'Device frame to use (default: iphone17)')
  .option('-o, --output <path>', 'Output file path')
  .option('--png', 'Output as PNG instead of SVG')
  .option('--jpeg', 'Output as JPEG instead of SVG')
  .option('--color <color>', `Frame color: ${COLORS.join(', ')} (default: silver)`, 'silver')
  .action(async (file: string, device = 'iphone17', options: { output?: string; png?: boolean; jpeg?: boolean; color: string }) => {
    const inputPath = path.resolve(file);
    const base = path.basename(inputPath, path.extname(inputPath));
    const dir = path.dirname(inputPath);

    let outExt = '.svg';
    const format = options.jpeg ? 'jpeg' : options.png ? 'png' : 'svg';
    if (format === 'png') outExt = '.png';
    else if (format === 'jpeg') outExt = '.jpeg';

    const outputPath = options.output
      ? path.resolve(options.output)
      : path.join(dir, `${base}_${device}${outExt}`);

    try {
      process.stdout.write(`Framing ${path.basename(inputPath)} → ${path.basename(outputPath)} ... `);
      await compose(inputPath, device, outputPath, format, options.color);
      console.log('done');
    } catch (err) {
      console.error('');
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

program.parse();
