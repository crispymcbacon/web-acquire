import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dotenv from 'dotenv';

export const DEFAULT_BRIGHTDATA_ENDPOINT = 'https://api.brightdata.com/request';

export interface BrightDataConfig {
  apiToken: string;
  unlockerZone: string;
  endpoint: string;
}

export interface ConfigValidation {
  valid: boolean;
  errors: string[];
}

export interface BrightDataConfigPaths {
  user: string;
  project: string;
}

export function getBrightDataConfigPaths(
  homeDirectory = os.homedir(),
  projectDirectory = process.cwd(),
): BrightDataConfigPaths {
  return {
    user: path.join(homeDirectory, '.config', 'web-acquire', '.env'),
    project: path.join(projectDirectory, '.env'),
  };
}

function readDotenvFile(filePath: string): NodeJS.ProcessEnv {
  try {
    return dotenv.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Loads process values first, then the user config, then a project-local .env.
 * Files are parsed without mutating process.env, so repeated calls stay predictable.
 */
export function loadBrightDataConfig(
  env: NodeJS.ProcessEnv = process.env,
  paths = getBrightDataConfigPaths(),
): BrightDataConfig {
  const projectValues = readDotenvFile(paths.project);
  const userValues = readDotenvFile(paths.user);
  const merged = { ...projectValues, ...userValues, ...env };

  return {
    apiToken: merged.BRIGHTDATA_API_TOKEN?.trim() ?? '',
    unlockerZone: merged.BRIGHTDATA_UNLOCKER_ZONE?.trim() ?? '',
    endpoint: merged.BRIGHTDATA_UNLOCKER_ENDPOINT?.trim() || DEFAULT_BRIGHTDATA_ENDPOINT,
  };
}

export function validateBrightDataConfig(config: BrightDataConfig): ConfigValidation {
  const errors: string[] = [];
  if (!config.apiToken) errors.push('BRIGHTDATA_API_TOKEN is required');
  if (!config.unlockerZone) errors.push('BRIGHTDATA_UNLOCKER_ZONE is required');

  try {
    const endpoint = new URL(config.endpoint);
    if (endpoint.protocol !== 'https:') errors.push('Bright Data endpoint must use HTTPS');
  } catch {
    errors.push('Bright Data endpoint must be a valid URL');
  }

  return { valid: errors.length === 0, errors };
}
