#!/usr/bin/env node

import { selectAdapter } from './core/adapters.js';
import { parseHttpUrl } from './core/urls.js';
import { IdealistaAdapter } from './adapters/idealista/index.js';
import { BrightDataUnlockerProvider } from './providers/brightdata/unlocker.js';

const adapters = [new IdealistaAdapter()];

interface FetchOptions {
  json: boolean;
  timeoutMs?: number;
  outputDir?: string;
}

function printHelp(): void {
  console.log(`web-acquire - reusable web acquisition CLI

Usage:
  web-acquire fetch <url> [--json] [--timeout <seconds>] [--output-dir <dir>]
  web-acquire adapter <url>
`);
}

function printAdapter(value: string): void {
  const url = parseHttpUrl(value);
  const adapter = selectAdapter(url.toString(), adapters);
  console.log(adapter ? `adapter: ${adapter.name}` : 'adapter: none (generic)');
}

function parsePositiveSeconds(value: string): number {
  const seconds = Number(value);
  const milliseconds = Math.round(seconds * 1000);
  if (!Number.isFinite(seconds) || seconds <= 0 || milliseconds < 1) {
    throw new Error('Timeout must be a positive number of seconds');
  }
  return milliseconds;
}

function parseFetchOptions(options: string[]): FetchOptions {
  const result: FetchOptions = { json: false };
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    if (option === '--json') {
      result.json = true;
    } else if (option === '--timeout') {
      const value = options[++index];
      if (!value || value.startsWith('--')) throw new Error('--timeout requires seconds');
      result.timeoutMs = parsePositiveSeconds(value);
    } else if (option === '--output-dir') {
      const value = options[++index];
      if (!value || value.startsWith('--')) throw new Error('--output-dir requires a directory');
      result.outputDir = value;
    } else {
      throw new Error(`Unknown fetch option: ${option}`);
    }
  }
  return result;
}

async function fetchUrl(value: string, options: FetchOptions): Promise<void> {
  const url = parseHttpUrl(value);
  const provider = new BrightDataUnlockerProvider({
    timeoutMs: options.timeoutMs,
    outputDir: options.outputDir,
  });
  const result = await provider.acquire({ url: url.toString() });

  if (options.json) {
    console.log(JSON.stringify({
      ok: result.success,
      provider: result.provider,
      method: result.method,
      ...(result.httpStatus === undefined ? {} : { status: result.httpStatus }),
      ...(result.responseSizeBytes === undefined ? {} : { responseBytes: result.responseSizeBytes }),
      ...(result.outputDir ? { outputDir: result.outputDir } : {}),
      ...(result.errors.length ? { errors: result.errors } : {}),
      ...(result.warnings.length ? { warnings: result.warnings } : {}),
    }, null, 2));
  } else if (result.success) {
    const size = result.responseSizeBytes ?? 0;
    const formattedSize = size >= 1024 * 1024
      ? `${(size / (1024 * 1024)).toFixed(1)} MB`
      : `${(size / 1024).toFixed(1)} KB`;
    console.log(`✓ acquired ${result.requestedUrl}`);
    console.log(`provider: ${result.provider}/web_unlocker`);
    console.log(`status: ${result.httpStatus ?? 'unknown'}`);
    console.log(`size: ${formattedSize}`);
    console.log(`output: ${result.outputDir ?? 'unknown'}`);
  } else {
    for (const error of result.errors) console.error(error);
    if (result.outputDir) console.error(`output: ${result.outputDir}`);
  }

  if (!result.success) process.exitCode = 1;
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
    const jsonRequested = options.includes('--json');
    try {
      if (!value) throw new Error('Usage: web-acquire fetch <url> [options]');
      await fetchUrl(value, parseFetchOptions(options));
    } catch (error: unknown) {
      if (!jsonRequested) throw error;
      console.log(JSON.stringify({
        ok: false,
        errors: [error instanceof Error ? error.message : String(error)],
      }, null, 2));
      process.exitCode = 1;
    }
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
