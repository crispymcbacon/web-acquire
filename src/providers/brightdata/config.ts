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

export function loadBrightDataConfig(env: NodeJS.ProcessEnv = process.env): BrightDataConfig {
  return {
    apiToken: env.BRIGHTDATA_API_TOKEN?.trim() ?? '',
    unlockerZone: env.BRIGHTDATA_UNLOCKER_ZONE?.trim() ?? '',
    endpoint: env.BRIGHTDATA_UNLOCKER_ENDPOINT?.trim() || DEFAULT_BRIGHTDATA_ENDPOINT,
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
