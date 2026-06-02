import path from 'path';
import { compose } from '../composer';
import { Config } from '../config';
import { DEFAULT_DEVICE, getDefaultColor, hasFrameColor } from '../frames';
import { bold, cyan, dim, dot, fmtName, green, Spinner } from '../ui';
import { detectInputKind, ensureFfmpeg, probeVideo } from '../ffmpeg';
import { composeStaticVideo } from '../video-compose';

interface FrameOptions {
  output?: string;
  png?: boolean;
  jpeg?: boolean;
  color?: string;
  device?: string;
  mute?: boolean;
}

export async function frameAction(file: string, options: FrameOptions): Promise<void> {
  const config = new Config();
  const device = options.device ?? config.device ?? DEFAULT_DEVICE;
  const color = options.color
    ?? (!options.device && config.color && hasFrameColor(device, config.color)
      ? config.color
      : getDefaultColor(device));

  const inputPath = path.resolve(file);
  const base = path.basename(inputPath, path.extname(inputPath));
  const dir = path.dirname(inputPath);

  if (detectInputKind(inputPath) === 'video') {
    await frameVideo({ inputPath, base, dir, device, color, options });
    return;
  }

  const format = options.jpeg ? 'jpeg' : options.png ? 'png' : 'svg';
  const outExt = format === 'png' ? '.png' : format === 'jpeg' ? '.jpeg' : '.svg';

  const outputPath = options.output
    ? path.resolve(options.output)
    : path.join(dir, `${base}_${device}_${color}${outExt}`);

  const composeLabel = `Compositing ${bold(fmtName(device))}${dot()}${bold(fmtName(color))}${dot()}${dim(format.toUpperCase())}`;
  const s = new Spinner(`${composeLabel}...`);
  s.start();
  await compose(inputPath, device, outputPath, format, color);
  s.stop(`${cyan('✦')} ${composeLabel}`);

  console.log(`${green('✓')} Saved ${dim('→')} ${bold(path.basename(outputPath))}`);
}

// Wrap a screen recording in a static device frame: the device stays still, the
// screen plays the recording, output length = recording length. Defaults to a
// transparent .mov (ProRes 4444); pass -o foo.mp4 for an H.264 clip on black.
async function frameVideo(args: {
  inputPath: string;
  base: string;
  dir: string;
  device: string;
  color: string;
  options: FrameOptions;
}): Promise<void> {
  const { inputPath, base, dir, device, color, options } = args;

  if (options.png || options.jpeg) {
    console.log(`${dim('·')} Image formats don't apply to screen recordings — writing a video instead.`);
  }

  await ensureFfmpeg();
  const info = probeVideo(inputPath);

  const outputPath = options.output
    ? path.resolve(options.output)
    : path.join(dir, `${base}_${device}_${color}.mov`);
  const ext = path.extname(outputPath).toLowerCase();
  const fmtLabel = ext === '.mov' ? 'MOV · ProRes 4444' : ext.slice(1).toUpperCase();

  const composeLabel = `Framing ${bold(fmtName(device))}${dot()}${bold(fmtName(color))}${dot()}${dim(fmtLabel)}`;
  const s = new Spinner(`${composeLabel}...`);
  s.start();
  const { exitCode, stderr } = await composeStaticVideo({
    inputPath, device, color, outputPath, info, mute: Boolean(options.mute),
  });
  s.stop(`${cyan('✦')} ${composeLabel}`);

  if (exitCode !== 0) throw new Error(`ffmpeg failed:\n${stderr}`);

  console.log(`${green('✓')} Saved ${dim('→')} ${bold(path.basename(outputPath))}`);
}
