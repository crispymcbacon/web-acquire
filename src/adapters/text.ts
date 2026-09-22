export function cleanText(value: string): string {
  return value.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

/** European grouping: `1.354` is 1354, `1.354,50` is 1354.5. */
export function parseLocalizedNumber(value: string): number | null {
  const raw = value.match(/\d[\d.\s]*(?:,\d+)?/)?.[0];
  if (!raw) return null;
  const compact = raw.replace(/[\s.]/g, '');
  const parsed = Number(compact.includes(',') ? compact.replace(',', '.') : compact);
  return Number.isFinite(parsed) ? parsed : null;
}

export function firstNumber(text: string, patterns: RegExp[]): number | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const result = parseLocalizedNumber(match[1] ?? match[0]);
    if (result !== null) return result;
  }
  return null;
}

export function sameSite(url: URL, domain: string): boolean {
  const host = url.hostname.toLowerCase();
  return host === domain || host === `www.${domain}`;
}
