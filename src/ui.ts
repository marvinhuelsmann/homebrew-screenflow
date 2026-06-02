// Shared terminal UI helpers used by the frame and video commands.

const tty = Boolean(process.stdout.isTTY);

export const cyan  = (s: string) => tty ? `\x1b[36m${s}\x1b[0m` : s;
export const green = (s: string) => tty ? `\x1b[32m${s}\x1b[0m` : s;
export const bold  = (s: string) => tty ? `\x1b[1m${s}\x1b[0m`  : s;
export const dim   = (s: string) => tty ? `\x1b[2m${s}\x1b[0m`  : s;
export const dot   = () => ` ${dim('·')} `;

// Pretty-print a device/color id like "iphone-17-pro" → "iPhone 17 Pro".
export function fmtName(s: string): string {
  return s.split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
    .replace(/^Iphone\b/, 'iPhone')
    .replace(/^Ipad\b/,   'iPad');
}

// Bouncing-dot spinner — animates while async work runs.
// Dots rise and fall in a 3-column wave pattern.
const SPINNER_FRAMES = [
  '▁▁▁', '▂▁▁', '▃▂▁', '▄▃▂', '▅▄▃', '▆▅▄', '▇▆▅',
  '█▇▆', '▇█▇', '▆▇█', '▅▆▇', '▄▅▆', '▃▄▅', '▂▃▄', '▁▂▃', '▁▁▂',
];

export class Spinner {
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
