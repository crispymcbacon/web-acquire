import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packagePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json');

export function packageVersion(): string {
  const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as { version?: unknown };
  if (typeof packageJson.version !== 'string' || !packageJson.version) {
    throw new Error('Package version is missing');
  }
  return packageJson.version;
}
