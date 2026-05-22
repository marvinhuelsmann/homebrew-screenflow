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

// ── Output helpers ────────────────────────────────────────────────────────────
const tty = Boolean(process.stdout.isTTY);
const cyan  = (s: string) => tty ? `\x1b[36m${s}\x1b[0m` : s;
const green = (s: string) => tty ? `\x1b[32m${s}\x1b[0m` : s;
const bold  = (s: string) => tty ? `\x1b[1m${s}\x1b[0m`  : s;
const dim   = (s: string) => tty ? `\x1b[2m${s}\x1b[0m`  : s;
const dot   = () => ` ${dim('·')} `;

function fmtName(s: string): string {
  return s.split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
    .replace(/^Iphone\b/, 'iPhone')
    .replace(/^Ipad\b/,   'iPad');
}

const SPINNER_FRAMES = [
  '▁▁▁', '▂▁▁', '▃▂▁', '▄▃▂', '▅▄▃', '▆▅▄', '▇▆▅',
  '█▇▆', '▇█▇', '▆▇█', '▅▆▇', '▄▅▆', '▃▄▅', '▂▃▄', '▁▂▃', '▁▁▂',
];

class Spinner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private frame = 0;

  constructor(private msg: string) {}

  start(): void {
    if (!tty) { process.stdout.write(`  ${this.msg}\n`); return; }
    this.render();
    this.timer = setInterval(() => this.render(), 80);
  }

  private render(): void {
    const wave = cyan(SPINNER_FRAMES[this.frame % SPINNER_FRAMES.length]);
    process.stdout.write(`\r${wave} ${this.msg}  `);
    this.frame++;
  }

  stop(finalLine: string): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (tty) process.stdout.write('\r\x1b[K');
    console.log(finalLine);
  }
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

  const composeLabel = `Compositing ${bold(fmtName(device))}${dot()}${bold(fmtName(color))}${dot()}${dim(format.toUpperCase())}`;
  const s = new Spinner(`${composeLabel}...`);
  s.start();
  await compose(inputPath, device, outputPath, format, color);
  s.stop(`${cyan('✦')} ${composeLabel}`);

  console.log(`${green('✓')} Saved ${dim('→')} ${bold(path.basename(outputPath))}`);
}
