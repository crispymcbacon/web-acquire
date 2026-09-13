import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { main } from '../src/cli.js';
import {
  DEFAULT_BRIGHTDATA_ENDPOINT,
  getBrightDataConfigPaths,
  loadBrightDataConfig,
} from '../src/providers/brightdata/config.js';
import { packageVersion } from '../src/version.js';

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'web-acquire-config-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('Bright Data configuration discovery', () => {
  it('uses process environment over user config over project config', async () => {
    const root = await temporaryDirectory();
    const home = path.join(root, 'home');
    const project = path.join(root, 'project');
    const paths = getBrightDataConfigPaths(home, project);
    await mkdir(path.dirname(paths.project), { recursive: true });
    await writeFile(paths.project, [
      'BRIGHTDATA_API_TOKEN=project-token',
      'BRIGHTDATA_UNLOCKER_ZONE=project-zone',
      'BRIGHTDATA_UNLOCKER_ENDPOINT=https://project.example/request',
    ].join('\n'));
    await mkdir(path.dirname(paths.user), { recursive: true });
    await writeFile(paths.user, [
      'BRIGHTDATA_API_TOKEN=user-token',
      'BRIGHTDATA_UNLOCKER_ZONE=user-zone',
      'BRIGHTDATA_UNLOCKER_ENDPOINT=https://user.example/request',
    ].join('\n'));

    expect(loadBrightDataConfig({
      BRIGHTDATA_API_TOKEN: 'process-token',
      BRIGHTDATA_UNLOCKER_ENDPOINT: 'https://process.example/request',
    }, paths)).toEqual({
      apiToken: 'process-token',
      unlockerZone: 'user-zone',
      endpoint: 'https://process.example/request',
    });
  });

  it('falls back to a project-local .env and the default endpoint', async () => {
    const root = await temporaryDirectory();
    const paths = getBrightDataConfigPaths(path.join(root, 'home'), path.join(root, 'project'));
    await mkdir(path.dirname(paths.project), { recursive: true });
    await writeFile(paths.project, 'BRIGHTDATA_API_TOKEN=project-token\nBRIGHTDATA_UNLOCKER_ZONE=project-zone\n');
    expect(loadBrightDataConfig({}, paths)).toEqual({
      apiToken: 'project-token',
      unlockerZone: 'project-zone',
      endpoint: DEFAULT_BRIGHTDATA_ENDPOINT,
    });
  });
});

describe('doctor and version commands', () => {
  it('reports configuration state without exposing the token', async () => {
    const token = 'doctor-token-must-not-appear';
    const originalToken = process.env.BRIGHTDATA_API_TOKEN;
    const originalZone = process.env.BRIGHTDATA_UNLOCKER_ZONE;
    process.env.BRIGHTDATA_API_TOKEN = token;
    process.env.BRIGHTDATA_UNLOCKER_ZONE = 'doctor-zone';
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await main(['doctor', '--json']);
      const output = log.mock.calls.map(([line]) => line).join('\n');
      const result = JSON.parse(output) as { brightData: { apiTokenConfigured: boolean; unlockerZoneConfigured: boolean }; networkCheck: string };
      expect(result.brightData.apiTokenConfigured).toBe(true);
      expect(result.brightData.unlockerZoneConfigured).toBe(true);
      expect(result.networkCheck).toBe('not run');
      expect(output).not.toContain(token);
    } finally {
      if (originalToken === undefined) delete process.env.BRIGHTDATA_API_TOKEN;
      else process.env.BRIGHTDATA_API_TOKEN = originalToken;
      if (originalZone === undefined) delete process.env.BRIGHTDATA_UNLOCKER_ZONE;
      else process.env.BRIGHTDATA_UNLOCKER_ZONE = originalZone;
    }
  });

  it('reports the package version from the package metadata', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await main(['--version']);
    expect(log).toHaveBeenCalledWith(`web-acquire ${packageVersion()}`);
  });
});
