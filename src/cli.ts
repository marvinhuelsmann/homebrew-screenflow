import { Command } from 'commander';
import { DEVICES } from './composer';
import { version } from '../package.json';
import { frameAction } from './commands/frame';
import { videoAction } from './commands/video';
import { setDefaultAction } from './commands/setDefault';
import { devicesAction } from './commands/devices';
import { showConfigAction } from './commands/showConfig';
import { authorAction } from './commands/author';

export async function run(): Promise<void> {
  // Handle flags that don't require <file> before commander parses
  if (process.argv.includes('--set-default')) {
    await setDefaultAction();
    process.exit(0);
  }
  if (process.argv.includes('--devices')) {
    devicesAction();
    process.exit(0);
  }
  if (process.argv.includes('--show-config')) {
    showConfigAction();
    process.exit(0);
  }
  if (process.argv.includes('--author')) {
    authorAction();
    process.exit(0);
  }

  if (process.argv.length <= 2) {
    buildProgram().help();
    return;
  }

  await buildProgram().parseAsync(process.argv);
}

function buildProgram(): Command {
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
    .option('--color <color>', 'Frame color for the chosen device')
    .option('--device <device>', `Device frame: ${DEVICES.join(', ')}`)
    .option('--devices', 'List all devices and their available colors')
    .option('--set-default', 'Save --device and/or --color as your personal defaults')
    .option('--show-config', 'Show your saved defaults')
    .option('--video', 'Create a 4-second zoom-in video animation (requires ffmpeg)')
    .option('--author', 'About the author')
    .action(async (file: string, options) => {
      try {
        if (options.video) {
          await videoAction(file, options);
        } else {
          await frameAction(file, options);
        }
      } catch (err) {
        console.error('');
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });

  return program;
}
