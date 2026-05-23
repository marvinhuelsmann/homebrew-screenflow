import { Config } from '../config';
import { FRAMES, DEFAULT_DEVICE, getDefaultColor } from '../frames';

export function devicesAction(): void {
  const config = new Config();
  const defaultDevice = config.device ?? DEFAULT_DEVICE;

  console.log('');
  for (const [id, spec] of Object.entries(FRAMES).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))) {
    const defaultColor = getDefaultColor(id);
    const colors = Object.keys(spec.colors)
      .map(color => color === defaultColor ? `${color} (default)` : color)
      .join(', ');
    const isDefault = id === defaultDevice;
    console.log(`  ${id}${isDefault ? ' (default)' : ''}`);
    console.log(`    Colors: ${colors}`);
    console.log('');
  }
}
