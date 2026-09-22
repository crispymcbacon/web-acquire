import type { SiteAdapter } from '../../core/types.js';
import { isShBarcelonaSearchUrl, parseShBarcelonaSearch } from './search.js';
import type { ShSearchParseResult } from './search-types.js';

export type ShPageType = 'search' | 'unsupported';

export class ShBarcelonaAdapter implements SiteAdapter {
  readonly name = 'shbarcelona';
  readonly domains = ['shbarcelona.com', 'www.shbarcelona.com'] as const;

  canHandle(url: URL): boolean {
    return this.domains.includes(url.hostname.toLowerCase() as (typeof this.domains)[number]);
  }

  pageType(url: string | URL): ShPageType {
    return isShBarcelonaSearchUrl(url) ? 'search' : 'unsupported';
  }

  async parse(document: string, url: URL): Promise<ShSearchParseResult> {
    return parseShBarcelonaSearch({ html: document, url });
  }
}

export { isShBarcelonaSearchUrl, parseShBarcelonaSearch } from './search.js';
export { getShListingIdentity, shSearchCollectionAdapter } from './collection.js';
export type {
  ParseShSearchInput,
  ShContractType,
  ShSearchCompleteness,
  ShSearchListing,
  ShSearchParseResult,
  ShSearchResult,
} from './search-types.js';
