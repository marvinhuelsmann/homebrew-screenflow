import { select } from '@inquirer/prompts';
import { Config } from '../config';
import { FRAMES, DEFAULT_DEVICE } from '../frames';

export async function setDefaultAction(): Promise<void> {
  const config = new Config();

  const device = await select({
    message: 'Default device:',
    choices: Object.keys(FRAMES).map(id => ({
      value: id,
      description: Object.keys(FRAMES[id].colors).join(', '),
    })),
    default: config.device ?? DEFAULT_DEVICE,
  });

  const color = await select({
    message: 'Default color:',
    choices: Object.keys(FRAMES[device].colors).map(c => ({ value: c })),
    default: config.color ?? 'silver',
  });

  config.save({ device, color });
  console.log('');
  console.log(`  Saved — device: ${device}, color: ${color}`);
  console.log('');
}
