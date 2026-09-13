import type { SiteAdapter } from '../../core/types.js';
import { isIdealistaDetailUrl, parseIdealistaDetail } from './parser.js';
import { isIdealistaSearchUrl, parseIdealistaSearch } from './search.js';
import type { IdealistaParseResult } from './types.js';
import type { IdealistaSearchParseResult } from './search-types.js';

export type IdealistaPageType = 'detail' | 'search' | 'unsupported';
export type IdealistaAdapterParseResult = IdealistaParseResult | IdealistaSearchParseResult;

export class IdealistaAdapter implements SiteAdapter {
  readonly name = 'idealista';
  readonly domains = ['idealista.com', 'www.idealista.com'] as const;

  canHandle(url: URL): boolean {
    return this.domains.includes(url.hostname.toLowerCase() as (typeof this.domains)[number]);
  }

  pageType(url: string | URL): IdealistaPageType {
    if (isIdealistaDetailUrl(url)) return 'detail';
    if (isIdealistaSearchUrl(url)) return 'search';
    return 'unsupported';
  }

  isDetailUrl(url: string | URL): boolean {
    return this.pageType(url) === 'detail';
  }

  isSearchUrl(url: string | URL): boolean {
    return this.pageType(url) === 'search';
  }

  async parse(document: string, url: URL): Promise<IdealistaAdapterParseResult> {
    if (this.isDetailUrl(url)) return parseIdealistaDetail({ html: document, url });
    if (this.isSearchUrl(url)) return parseIdealistaSearch({ html: document, url });
    return {
      pageType: 'unsupported',
      search: null,
      completeness: null,
      errors: ['Unsupported Idealista URL'],
    };
  }
}

export { isIdealistaDetailUrl, parseIdealistaDetail } from './parser.js';
export { isIdealistaSearchUrl, parseIdealistaSearch } from './search.js';
export { getIdealistaListingIdentity, idealistaSearchCollectionAdapter } from './collection.js';
export type {
  IdealistaAdvertiser,
  IdealistaCompleteness,
  IdealistaFacts,
  IdealistaListing,
  IdealistaListingState,
  IdealistaParseResult,
  IdealistaTextEvidence,
  ParseIdealistaDetailInput,
} from './types.js';
export type {
  IdealistaSearchCompleteness,
  IdealistaSearchListing,
  IdealistaSearchParseResult,
  IdealistaSearchResult,
  ParseIdealistaSearchInput,
} from './search-types.js';
