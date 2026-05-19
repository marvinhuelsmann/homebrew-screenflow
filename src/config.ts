import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

interface ConfigData {
  device?: string;
  color?: string;
}

export class Config {
  private static readonly PATH = path.join(os.homedir(), '.config', 'screenflow', 'config.json');
  private data: ConfigData;

  constructor() {
    this.data = Config.load();
  }

  get device(): string | undefined { return this.data.device; }
  get color(): string | undefined { return this.data.color; }

  print(): void {
    console.log('');
    console.log('  Saved defaults:');
    console.log(`    Device  →  ${this.data.device ?? 'not set'}`);
    console.log(`    Color   →  ${this.data.color ?? 'not set'}`);
    console.log('');
  }

  save(updates: ConfigData): void {
    this.data = { ...this.data, ...updates };
    fs.mkdirSync(path.dirname(Config.PATH), { recursive: true });
    fs.writeFileSync(Config.PATH, JSON.stringify(this.data, null, 2), 'utf8');
  }
  private static load(): ConfigData {
    try {
      return JSON.parse(fs.readFileSync(Config.PATH, 'utf8'));
    } catch {
      return {};
    }
  }
}
