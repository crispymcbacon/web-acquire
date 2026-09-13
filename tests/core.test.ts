import { describe, expect, it } from 'vitest';
import { selectAdapter } from '../src/core/adapters.js';
import { parseHttpUrl } from '../src/core/urls.js';
import { IdealistaAdapter } from '../src/adapters/idealista/index.js';
import {
  DEFAULT_BRIGHTDATA_ENDPOINT,
  loadBrightDataConfig,
  validateBrightDataConfig,
} from '../src/providers/brightdata/config.js';

const idealista = new IdealistaAdapter();

describe('URL validation', () => {
  it('accepts HTTP and HTTPS URLs', () => {
    expect(parseHttpUrl('https://example.com/path').hostname).toBe('example.com');
    expect(parseHttpUrl('http://example.com')).toBeInstanceOf(URL);
  });

  it('rejects malformed and non-HTTP URLs', () => {
    expect(() => parseHttpUrl('not a URL')).toThrow('Invalid URL');
    expect(() => parseHttpUrl('ftp://example.com')).toThrow('http:// or https://');
  });
});

describe('adapter detection', () => {
  it.each(['https://idealista.com/inmueble/123/', 'https://www.idealista.com/inmueble/123/'])(
    'selects Idealista for %s',
    (url) => {
      expect(selectAdapter(url, [idealista])?.name).toBe('idealista');
    },
  );

  it('returns no adapter for unknown domains', () => {
    expect(selectAdapter('https://example.com/listing', [idealista])).toBeUndefined();
    expect(selectAdapter('https://notidealista.com', [idealista])).toBeUndefined();
  });
});

describe('Bright Data configuration', () => {
  it('uses the documented default endpoint', () => {
    const config = loadBrightDataConfig({});
    expect(config.endpoint).toBe(DEFAULT_BRIGHTDATA_ENDPOINT);
  });

  it('validates required fields without exposing secret values', () => {
    const secret = 'super-secret-token';
    const result = validateBrightDataConfig({
      apiToken: secret,
      unlockerZone: '',
      endpoint: 'not-a-url',
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      'BRIGHTDATA_UNLOCKER_ZONE is required',
      'Bright Data endpoint must be a valid URL',
    ]);
    expect(result.errors.join(' ')).not.toContain(secret);
  });
});
