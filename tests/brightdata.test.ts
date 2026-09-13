import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { main } from '../src/cli.js';
import { selectAdapter } from '../src/core/adapters.js';
import { IdealistaAdapter } from '../src/adapters/idealista/index.js';
import {
  DEFAULT_BRIGHTDATA_ENDPOINT,
  type BrightDataConfig,
} from '../src/providers/brightdata/config.js';
import {
  BrightDataUnlockerProvider,
  DEFAULT_MAX_RESPONSE_BYTES,
  DEFAULT_TIMEOUT_MS,
} from '../src/providers/brightdata/unlocker.js';

const token = 'test-token-must-not-be-persisted';
const zone = 'test-zone';
const config: BrightDataConfig = {
  apiToken: token,
  unlockerZone: zone,
  endpoint: DEFAULT_BRIGHTDATA_ENDPOINT,
};

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'web-acquire-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  vi.restoreAllMocks();
  process.exitCode = 0;
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('Bright Data Web Unlocker provider', () => {
  it('sends one correctly formed request and persists the raw response', async () => {
    const outputDir = await temporaryDirectory();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('<html>exact body</html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
    );

    const result = await new BrightDataUnlockerProvider({ config, outputDir, fetchImpl }).acquire({
      url: 'https://example.com/page',
    });

    expect(result.success).toBe(true);
    expect(result.httpStatus).toBe(200);
    expect(result.responseSizeBytes).toBe(23);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [endpoint, request] = fetchImpl.mock.calls[0];
    expect(endpoint).toBe(DEFAULT_BRIGHTDATA_ENDPOINT);
    expect(request?.method).toBe('POST');
    expect(request?.headers).toEqual({
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(String(request?.body))).toEqual({
      zone,
      url: 'https://example.com/page',
      format: 'raw',
      method: 'GET',
    });

    expect(await readFile(path.join(outputDir, 'response.html'), 'utf8')).toBe('<html>exact body</html>');
    const metadata = await readFile(path.join(outputDir, 'metadata.json'), 'utf8');
    expect(metadata).not.toContain(token);
    expect(JSON.stringify(result)).not.toContain(token);
  });

  it('uses a text filename for plain-text responses', async () => {
    const outputDir = await temporaryDirectory();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('plain text', {
        status: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      }),
    );

    const result = await new BrightDataUnlockerProvider({ config, outputDir, fetchImpl }).acquire({
      url: 'https://geo.brdtest.com/welcome.txt',
    });

    expect(result.retainedContentPath).toBe('response.txt');
    expect(await readFile(path.join(outputDir, 'response.txt'), 'utf8')).toBe('plain text');
  });

  it('validates missing token and zone without making a request', async () => {
    const outputDir = await temporaryDirectory();
    const fetchImpl = vi.fn<typeof fetch>();
    const result = await new BrightDataUnlockerProvider({
      config: { ...config, apiToken: '', unlockerZone: '' },
      outputDir,
      fetchImpl,
    }).acquire({ url: 'https://example.com' });

    expect(result.success).toBe(false);
    expect(result.errors).toEqual([
      'Missing Bright Data configuration: BRIGHTDATA_API_TOKEN',
      'Missing Bright Data configuration: BRIGHTDATA_UNLOCKER_ZONE',
    ]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('uses a configurable endpoint', async () => {
    const outputDir = await temporaryDirectory();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('ok', { status: 200 }));
    const endpoint = 'https://unlocker.example.test/request';
    await new BrightDataUnlockerProvider({
      outputDir,
      config: { ...config, endpoint },
      fetchImpl,
    }).acquire({ url: 'https://example.com' });

    expect(fetchImpl.mock.calls[0]?.[0]).toBe(endpoint);
  });

  it('times out without retrying', async () => {
    const outputDir = await temporaryDirectory();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(
      (_input, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      }),
    );

    const result = await new BrightDataUnlockerProvider({
      config,
      outputDir,
      timeoutMs: 10,
      fetchImpl,
    }).acquire({ url: 'https://example.com' });

    expect(result.success).toBe(false);
    expect(result.errors).toEqual(['Bright Data acquisition timed out after 0.01 seconds']);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([400, 401, 500])('returns a sanitized failure for HTTP %s without retrying', async (status) => {
    const outputDir = await temporaryDirectory();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: 'not authorized' }), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const result = await new BrightDataUnlockerProvider({ config, outputDir, fetchImpl }).acquire({
      url: 'https://example.com',
    });

    expect(result.success).toBe(false);
    expect(result.httpStatus).toBe(status);
    expect(result.errors).toEqual([`Bright Data returned HTTP ${status}`]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect((await readFile(path.join(outputDir, 'metadata.json'), 'utf8')).toLowerCase()).not.toContain('authorization');
  });

  it('redacts the credential from a retained API diagnostic', async () => {
    const outputDir = await temporaryDirectory();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ token }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await new BrightDataUnlockerProvider({ config, outputDir, fetchImpl }).acquire({
      url: 'https://example.com',
    });

    const diagnostic = await readFile(path.join(outputDir, 'error-response.txt'), 'utf8');
    expect(diagnostic).not.toContain(token);
    expect(diagnostic).toContain('[REDACTED]');
  });

  it('rejects a response larger than the limit from Content-Length', async () => {
    const outputDir = await temporaryDirectory();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('12345', { status: 200, headers: { 'content-length': '5' } }),
    );
    const result = await new BrightDataUnlockerProvider({
      config,
      outputDir,
      maxResponseBytes: 4,
      fetchImpl,
    }).acquire({ url: 'https://example.com' });

    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain('exceeds maximum retained size');
    await expect(readFile(path.join(outputDir, 'response.html'))).rejects.toThrow();
  });

  it('enforces the response limit while consuming a response without Content-Length', async () => {
    const outputDir = await temporaryDirectory();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('12345', { status: 200 }));
    const result = await new BrightDataUnlockerProvider({
      config,
      outputDir,
      maxResponseBytes: 4,
      fetchImpl,
    }).acquire({ url: 'https://example.com' });

    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain('exceeds maximum retained size');
  });

  it('supports generic URLs independently of site adapters', async () => {
    const outputDir = await temporaryDirectory();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('generic page', { status: 200 }));
    const result = await new BrightDataUnlockerProvider({ config, outputDir, fetchImpl }).acquire({
      url: 'https://example.com',
    });

    expect(selectAdapter('https://example.com', [new IdealistaAdapter()])).toBeUndefined();
    expect(result.success).toBe(true);
  });

  it('keeps JSON CLI errors machine-readable', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await main(['fetch', 'not-a-url', '--json']);

    const output = log.mock.calls.map(([line]) => line).join('\n');
    expect(() => JSON.parse(output)).not.toThrow();
    expect(JSON.parse(output).ok).toBe(false);
  });
});

describe('provider defaults', () => {
  it('uses the requested timeout and response-size defaults', () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(45_000);
    expect(DEFAULT_MAX_RESPONSE_BYTES).toBe(20 * 1024 * 1024);
  });
});
