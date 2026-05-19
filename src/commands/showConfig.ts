import { Config } from '../config';

export function showConfigAction(): void {
  new Config().print();
}
