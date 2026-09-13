#!/usr/bin/env node

import { selectAdapter } from './core/adapters.js';
import { parseHttpUrl } from './core/urls.js';
import { IdealistaAdapter } from './adapters/idealista/index.js';
import { BrightDataUnlockerProvider } from './providers/brightdata/unlocker.js';

const adapters = [new IdealistaAdapter()];
const provider = new BrightDataUnlockerProvider();

function printHelp(): void {
  console.log(`web-acquire - reusable web acquisition CLI

Usage:
  web-acquire fetch <url> [--json]
  web-acquire adapter <url>
`);
}

function printAdapter(value: string): void {
  const url = parseHttpUrl(value);
  const adapter = selectAdapter(url.toString(), adapters);
  if (adapter) {
    console.log(`adapter: ${adapter.name}`);
  } else {
    console.log('adapter: none (generic)');
  }
}

async function fetchUrl(value: string, json: boolean): Promise<void> {
  const url = parseHttpUrl(value);
  const result = await provider.acquire({ url: url.toString() });
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log('Network acquisition is not enabled in this milestone.');
  console.log('The Bright Data provider exists as a skeleton; no request was made.');
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const [command, value, ...options] = argv;

  if (!command || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  if (command === 'adapter') {
    if (!value || options.length > 0) throw new Error('Usage: web-acquire adapter <url>');
    printAdapter(value);
    return;
  }

  if (command === 'fetch') {
    if (!value || options.some((option) => option !== '--json')) {
      throw new Error('Usage: web-acquire fetch <url> [--json]');
    }
    await fetchUrl(value, options.includes('--json'));
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
