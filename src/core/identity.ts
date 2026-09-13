import { createHash } from 'node:crypto';

/** Canonicalizes URL formatting without interpreting site-specific query semantics. */
export function normalizeUrl(value: string | URL): string {
  const url = typeof value === 'string' ? new URL(value) : new URL(value.toString());
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) {
    url.port = '';
  }
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '/');
  const params = [...url.searchParams.entries()].sort(([leftKey, leftValue], [rightKey, rightValue]) =>
    leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue));
  url.search = '';
  for (const [key, value] of params) url.searchParams.append(key, value);
  return url.toString();
}

export function createSearchKey(source: string, normalizedInitialUrl: string): string {
  return createHash('sha256').update(`${source}\n${normalizedInitialUrl}`, 'utf8').digest('hex');
}
