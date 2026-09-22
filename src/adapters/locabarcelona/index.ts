import type { SiteAdapter } from '../../core/types.js';
import { isLocaBarcelonaSearchUrl, parseLocaBarcelonaSearch } from './search.js';
import type { LocaSearchParseResult } from './search-types.js';

export type LocaPageType = 'search' | 'unsupported';

export class LocaBarcelonaAdapter implements SiteAdapter {
  readonly name = 'locabarcelona';
  readonly domains = ['locabarcelona.com', 'www.locabarcelona.com'] as const;

  canHandle(url: URL): boolean {
    return this.domains.includes(url.hostname.toLowerCase() as (typeof this.domains)[number]);
  }

  pageType(url: string | URL): LocaPageType {
    return isLocaBarcelonaSearchUrl(url) ? 'search' : 'unsupported';
  }

  async parse(document: string, url: URL): Promise<LocaSearchParseResult> {
    return parseLocaBarcelonaSearch({ html: document, url });
  }
}

export { isLocaBarcelonaSearchUrl, parseLocaBarcelonaSearch } from './search.js';
export { getLocaListingIdentity, locaSearchCollectionAdapter } from './collection.js';
export type {
  LocaContractType,
  LocaSearchCompleteness,
  LocaSearchListing,
  LocaSearchParseResult,
  LocaSearchResult,
  ParseLocaSearchInput,
} from './search-types.js';
