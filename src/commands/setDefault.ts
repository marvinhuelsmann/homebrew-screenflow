import { select } from '@inquirer/prompts';
import { Config } from '../config';
import { FRAMES, DEFAULT_DEVICE, getDefaultColor, getFrameColors, hasFrameColor } from '../frames';

export async function setDefaultAction(): Promise<void> {
  const config = new Config();

  const device = await select({
    message: 'Default device:',
    choices: Object.keys(FRAMES).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map(id => ({
      value: id,
      description: Object.keys(FRAMES[id].colors).join(', '),
    })),
    default: config.device ?? DEFAULT_DEVICE,
  });

  const color = await select({
    message: 'Default color:',
    choices: getFrameColors(device).map(c => ({ value: c })),
    default: config.device === device && config.color && hasFrameColor(device, config.color)
      ? config.color
      : getDefaultColor(device),
  });

  config.save({ device, color });
  console.log('');
  console.log(`  Saved — device: ${device}, color: ${color}`);
  console.log('');
}
