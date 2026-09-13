import type { SiteAdapter } from './types.js';

export function selectAdapter(url: string, adapters: readonly SiteAdapter[]): SiteAdapter | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }

  return adapters.find((adapter) => adapter.canHandle(parsed));
}
