import path from 'path';
import { compose } from '../composer';
import { Config } from '../config';
import { DEFAULT_DEVICE } from '../frames';

interface FrameOptions {
  output?: string;
  png?: boolean;
  jpeg?: boolean;
  color?: string;
  device?: string;
}

export async function frameAction(file: string, options: FrameOptions): Promise<void> {
  const config = new Config();
  const device = options.device ?? config.device ?? DEFAULT_DEVICE;
  const color  = options.color  ?? config.color  ?? 'silver';

  const inputPath = path.resolve(file);
  const base = path.basename(inputPath, path.extname(inputPath));
  const dir = path.dirname(inputPath);

  const format = options.jpeg ? 'jpeg' : options.png ? 'png' : 'svg';
  const outExt = format === 'png' ? '.png' : format === 'jpeg' ? '.jpeg' : '.svg';

  const outputPath = options.output
    ? path.resolve(options.output)
    : path.join(dir, `${base}_${device}_${color}${outExt}`);

  process.stdout.write(`Framing ${path.basename(inputPath)} → ${path.basename(outputPath)} ... `);
  await compose(inputPath, device, outputPath, format, color);
  console.log('done');
}
