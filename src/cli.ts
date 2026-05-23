import { Command } from 'commander';
import { version } from '../package.json';
import { frameAction } from './commands/frame';
import { videoAction } from './commands/video';
import { setDefaultAction } from './commands/setDefault';
import { devicesAction } from './commands/devices';
import { showConfigAction } from './commands/showConfig';
import { authorAction } from './commands/author';

const VALID_STYLES = ['zoom-in', 'zoom-out', 'pan-down', 'pan-left', 'pan-right'];

export async function run(): Promise<void> {
  const program = buildProgram();

  if (process.argv.length <= 2) {
    program.help();
    return;
  }

  await program.parseAsync(normalizeArgv(process.argv));
}

function normalizeArgv(argv: string[]): string[] {
  const singleDashLongOptions = new Set([
    '-output',
    '-device',
    '-color',
    '-style',
    '-tilt',
    '-fps',
    '-duration',
  ]);

  return argv.map(arg => singleDashLongOptions.has(arg) ? `-${arg}` : arg);
}

function buildProgram(): Command {
  const program = new Command()
    .name('screenflow')
    .enablePositionalOptions()
    .description('Wrap simulator screenshots in a device frame — pixel-perfect, no clock, no Dynamic Island')
    .version(version, '-v, --version')
    .helpOption('-h, --help', 'Show help')
    .argument('[file]', 'Screenshot image file (PNG, JPG)')
    .option('-o, --output <path>', 'Output file path')
    .option('--png', 'Output as PNG instead of SVG')
    .option('--jpeg', 'Output as JPEG instead of SVG')
    .option('-d, --device <device>', 'Device frame (e.g. iphone-17-pro)')
    .option('-c, --color <color>', 'Frame color for the chosen device')
    .action(async (file: string | undefined, options) => {
      if (!file) {
        program.help();
        return;
      }
      try {
        await frameAction(file, options);
      } catch (err) {
        console.error('');
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });

  program
    .command('video <file>')
    .description('Create an animated marketing video (requires ffmpeg)')
    .option('-o, --output <path>', 'Output file path')
    .option('-d, --device <device>', 'Device frame (e.g. iphone-17-pro)')
    .option('-c, --color <color>', 'Frame color for the chosen device')
    .option('-s, --style <style>', `Animation style: ${VALID_STYLES.join(' | ')}`, 'zoom-in')
    .option('-t, --tilt <degrees>', 'Perspective tilt downward in degrees (0–45)', '0')
    .option('--fps <fps>', 'Frame rate: 24, 30, 60, or 120', '60')
    .option('--duration <seconds>', 'Animation length in seconds (1–60)', '9')
    .action(async (file: string, options) => {
      if (!VALID_STYLES.includes(options.style)) {
        console.error(`\nError: Unknown style "${options.style}". Choose from: ${VALID_STYLES.join(', ')}\n`);
        process.exit(1);
      }
      try {
        await videoAction(file, options);
      } catch (err) {
        console.error('');
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });

  program
    .command('devices')
    .description('List all available devices and their colors')
    .action(devicesAction);

  program
    .command('config')
    .description('Show your saved defaults')
    .action(showConfigAction);

  program
    .command('set-default')
    .description('Set a default device and color interactively')
    .action(async () => {
      await setDefaultAction();
    });

  program
    .command('author')
    .description('About the author')
    .action(authorAction);

  return program;
}
