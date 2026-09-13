#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { selectAdapter } from './core/adapters.js';
import { collectPaginatedSearch, MAX_COLLECTION_PAGES, type AcquiredSearchPage, type SearchInventory } from './core/collect.js';
import { diffInventories } from './core/diff.js';
import { parseHttpUrl } from './core/urls.js';
import {
  IdealistaAdapter,
  getIdealistaListingIdentity,
  idealistaSearchCollectionAdapter,
  parseIdealistaDetail,
  parseIdealistaSearch,
  type IdealistaSearchListing,
} from './adapters/idealista/index.js';
import { BrightDataUnlockerProvider } from './providers/brightdata/unlocker.js';

const adapters = [new IdealistaAdapter()];

interface FetchOptions {
  json: boolean;
  timeoutMs?: number;
  outputDir?: string;
}

interface CollectionOptions extends FetchOptions {
  maxPages: number;
}

interface DiffOptions {
  json: boolean;
  output?: string;
}

function printHelp(): void {
  console.log(`web-acquire - reusable web acquisition CLI

Usage:
  web-acquire fetch <url> [--json] [--timeout <seconds>] [--output-dir <dir>]
  web-acquire extract <url> [--json] [--timeout <seconds>] [--output-dir <dir>]
  web-acquire collect <search-url> [--json] [--timeout <seconds>] [--output-dir <dir>] [--max-pages <number>]
  web-acquire diff <previous-inventory> <current-inventory> [--json] [--output <file>]
  web-acquire adapter <url>
`);
}

function printAdapter(value: string): void {
  const url = parseHttpUrl(value);
  const adapter = selectAdapter(url.toString(), adapters);
  if (!adapter) {
    console.log('adapter: none (generic)');
    return;
  }
  const page = adapter instanceof IdealistaAdapter ? adapter.pageType(url) : 'unknown';
  console.log(`adapter: ${adapter.name}`);
  console.log(`page: ${page}`);
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

function parseMaxPages(value: string): number {
  const pages = Number(value);
  if (!Number.isInteger(pages) || pages < 1 || pages > MAX_COLLECTION_PAGES) {
    throw new Error(`--max-pages must be an integer between 1 and ${MAX_COLLECTION_PAGES}`);
  }
  return pages;
}

function parseCollectionOptions(options: string[]): CollectionOptions {
  const result: CollectionOptions = { json: false, maxPages: 10 };
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
    } else if (option === '--max-pages') {
      const value = options[++index];
      if (!value || value.startsWith('--')) throw new Error('--max-pages requires a number');
      result.maxPages = parseMaxPages(value);
    } else {
      throw new Error(`Unknown collect option: ${option}`);
    }
  }
  return result;
}

function parseDiffOptions(options: string[]): DiffOptions {
  const result: DiffOptions = { json: false };
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    if (option === '--json') {
      result.json = true;
    } else if (option === '--output') {
      const value = options[++index];
      if (!value || value.startsWith('--')) throw new Error('--output requires a file path');
      result.output = value;
    } else {
      throw new Error(`Unknown diff option: ${option}`);
    }
  }
  return result;
}

async function diffFiles(previousPath: string, currentPath: string, options: DiffOptions): Promise<void> {
  async function readInventory(filePath: string, label: string): Promise<unknown> {
    let contents: string;
    try {
      contents = await readFile(filePath, 'utf8');
    } catch (error: unknown) {
      throw new Error(`Unable to read ${label} inventory: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      return JSON.parse(contents) as unknown;
    } catch (error: unknown) {
      throw new Error(`Unable to parse ${label} inventory JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const previous = await readInventory(previousPath, 'previous');
  const current = await readInventory(currentPath, 'current');
  const diff = diffInventories<IdealistaSearchListing>({
    previous: previous as SearchInventory<IdealistaSearchListing>,
    current: current as SearchInventory<IdealistaSearchListing>,
    getItemIdentity: getIdealistaListingIdentity,
  });

  if (options.output) {
    const outputPath = path.resolve(options.output);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(diff, null, 2)}\n`, 'utf8');
  }

  if (options.json) {
    console.log(JSON.stringify({ ok: true, ...diff, ...(options.output ? { output: options.output } : {}) }, null, 2));
  } else {
    console.log(`Inventory diff\n\nPrevious: ${diff.summary.previousCount} listings\nCurrent:  ${diff.summary.currentCount} listings\n\nAdded:     ${diff.summary.added}\nRetained: ${diff.summary.retained}\nRemoved:   ${diff.summary.removed}`);
    if (options.output) console.log(`\noutput: ${options.output}`);
  }
}

async function collectUrl(value: string, options: CollectionOptions): Promise<void> {
  const url = parseHttpUrl(value);
  const adapter = selectAdapter(url.toString(), adapters);
  if (!(adapter instanceof IdealistaAdapter) || adapter.pageType(url) !== 'search') {
    throw new Error('No paginated search adapter available for this URL');
  }

  const collectedAt = new Date().toISOString();
  const collectionRoot = path.resolve(options.outputDir ?? path.join('runs', `${collectedAt.replace(/[.:]/g, '-')}-idealista-collection`));
  await mkdir(collectionRoot, { recursive: true });

  const acquirePage = async (pageUrl: string, index: number): Promise<AcquiredSearchPage> => {
    const pageDir = path.join(collectionRoot, 'pages', String(index).padStart(3, '0'));
    await mkdir(pageDir, { recursive: true });
    const outputDir = path.relative(collectionRoot, pageDir) || '.';
    const provider = new BrightDataUnlockerProvider({ timeoutMs: options.timeoutMs, outputDir: pageDir });
    let acquisition;
    try {
      acquisition = await provider.acquire({ url: pageUrl });
    } catch (error: unknown) {
      return {
        success: false,
        outputDir,
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
    if (!acquisition.success) {
      return {
        success: false,
        outputDir,
        status: acquisition.httpStatus ? `http_${acquisition.httpStatus}` : 'acquisition_failed',
        warnings: acquisition.warnings,
        errors: acquisition.errors,
      };
    }
    if (!acquisition.retainedContentPath) {
      return { success: false, outputDir, errors: ['Acquisition did not retain a response document'] };
    }
    try {
      const retainedPath = path.resolve(acquisition.outputDir ?? pageDir, acquisition.retainedContentPath);
      return {
        success: true,
        document: await readFile(retainedPath, 'utf8'),
        outputDir,
        status: acquisition.httpStatus ? `http_${acquisition.httpStatus}` : 'acquired',
        warnings: acquisition.warnings,
        errors: acquisition.errors,
      };
    } catch (error: unknown) {
      return {
        success: false,
        outputDir,
        errors: [`Unable to read retained response: ${error instanceof Error ? error.message : String(error)}`],
      };
    }
  };

  const inventory = await collectPaginatedSearch({
    initialUrl: url,
    source: adapter.name,
    maxPages: options.maxPages,
    adapter: idealistaSearchCollectionAdapter,
    acquirePage,
    collectedAt,
    onPageParsed: async (event) => {
      await writeFile(
        path.join(collectionRoot, event.outputDir, 'search.json'),
        `${JSON.stringify(event.page, null, 2)}\n`,
        'utf8',
      );
    },
  });
  const inventoryPath = path.join(collectionRoot, 'inventory.json');
  await writeFile(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`, 'utf8');

  const outputDir = options.outputDir ?? (path.relative(process.cwd(), collectionRoot) || '.');
  const result = {
    ok: inventory.status === 'complete' || inventory.status === 'max_pages_reached',
    outputDir,
    inventoryFile: path.relative(process.cwd(), inventoryPath) || 'inventory.json',
    status: inventory.status,
    summary: inventory.summary,
    ...(options.json ? { inventory } : {}),
  };
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`${result.ok ? '✓' : '!'} collected ${inventory.summary.uniqueListings} unique listings`);
    console.log(`status: ${inventory.status}`);
    console.log(`pages: ${inventory.summary.pagesFetched}`);
    console.log(`output: ${outputDir}`);
    for (const warning of inventory.warnings) console.error(`warning: ${warning}`);
  }
  if (!result.ok) process.exitCode = 1;
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

async function extractUrl(value: string, options: FetchOptions): Promise<void> {
  const url = parseHttpUrl(value);
  const adapter = selectAdapter(url.toString(), adapters);
  if (!(adapter instanceof IdealistaAdapter)) {
    throw new Error('No extraction adapter available for this URL');
  }
  const pageType = adapter.pageType(url);
  if (pageType === 'unsupported') {
    throw new Error('No extraction adapter available for this URL');
  }

  const provider = new BrightDataUnlockerProvider({
    timeoutMs: options.timeoutMs,
    outputDir: options.outputDir,
  });
  const acquisition = await provider.acquire({ url: url.toString() });
  if (!acquisition.success) {
    throw new Error(acquisition.errors.join('; ') || 'Acquisition failed');
  }
  if (!acquisition.outputDir || !acquisition.retainedContentPath) {
    throw new Error('Acquisition did not retain a response document');
  }

  const responsePath = path.resolve(acquisition.outputDir, acquisition.retainedContentPath);
  const html = await readFile(responsePath, 'utf8');
  const outputDir = acquisition.outputDir;

  if (pageType === 'detail') {
    const parsed = parseIdealistaDetail({ html, url });
    if (!parsed.listing || !parsed.completeness) {
      throw new Error(parsed.errors.join('; ') || 'Detail extraction failed');
    }
    const listingPath = path.join(path.dirname(responsePath), 'listing.json');
    await writeFile(listingPath, `${JSON.stringify(parsed.listing, null, 2)}\n`, 'utf8');
    const result = {
      ok: parsed.completeness.accepted,
      outputDir,
      listingFile: path.relative(process.cwd(), listingPath) || 'listing.json',
      completeness: parsed.completeness,
      ...(options.json ? { listing: parsed.listing } : {}),
    };
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`${parsed.completeness.accepted ? '✓' : '!'} extracted ${parsed.listing.url}`);
      console.log(`state: ${parsed.listing.listing_state}`);
      console.log(`output: ${outputDir}`);
      if (!parsed.completeness.accepted) {
        console.error(`incomplete: ${parsed.completeness.rejection_reasons.join(', ')}`);
      }
    }
    if (!parsed.completeness.accepted) process.exitCode = 1;
    return;
  }

  const parsed = parseIdealistaSearch({ html, url });
  if (!parsed.search || !parsed.completeness) {
    throw new Error(parsed.errors.join('; ') || 'Search extraction failed');
  }
  const searchPath = path.join(path.dirname(responsePath), 'search.json');
  await writeFile(searchPath, `${JSON.stringify(parsed.search, null, 2)}\n`, 'utf8');
  const result = {
    ok: parsed.completeness.accepted,
    outputDir,
    searchFile: path.relative(process.cwd(), searchPath) || 'search.json',
    completeness: parsed.completeness,
    ...(options.json ? { search: parsed.search } : {}),
  };
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`${parsed.completeness.accepted ? '✓' : '!'} extracted search ${parsed.search.url}`);
    console.log(`listings: ${parsed.search.listings.length}`);
    console.log(`output: ${outputDir}`);
    if (!parsed.completeness.accepted) {
      console.error(`incomplete: ${parsed.completeness.rejectionReasons.join(', ')}`);
    }
  }
  if (!parsed.completeness.accepted) process.exitCode = 1;
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

  if (command === 'diff') {
    const jsonRequested = options.includes('--json');
    try {
      const currentPath = options[0];
      if (!value || !currentPath || currentPath.startsWith('--')) {
        throw new Error('Usage: web-acquire diff <previous-inventory> <current-inventory> [--json] [--output <file>]');
      }
      await diffFiles(value, currentPath, parseDiffOptions(options.slice(1)));
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

  if (command === 'fetch' || command === 'extract' || command === 'collect') {
    const jsonRequested = options.includes('--json');
    try {
      if (!value) throw new Error(`Usage: web-acquire ${command} <url> [options]`);
      if (command === 'collect') {
        await collectUrl(value, parseCollectionOptions(options));
      } else {
        const parsedOptions = parseFetchOptions(options);
        if (command === 'fetch') await fetchUrl(value, parsedOptions);
        else await extractUrl(value, parsedOptions);
      }
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
