import type { SiteAdapter } from '../../core/types.js';
import { isGuinotPruneraSearchUrl, parseGuinotPruneraSearch } from './search.js';
import type { GuinotSearchParseResult } from './search-types.js';

export type GuinotPageType = 'search' | 'unsupported';

export class GuinotPruneraAdapter implements SiteAdapter {
  readonly name = 'guinotprunera';
  readonly domains = ['guinotprunera.com', 'www.guinotprunera.com'] as const;

  canHandle(url: URL): boolean {
    return this.domains.includes(url.hostname.toLowerCase() as (typeof this.domains)[number]);
  }

  pageType(url: string | URL): GuinotPageType {
    return isGuinotPruneraSearchUrl(url) ? 'search' : 'unsupported';
  }

  async parse(document: string, url: URL): Promise<GuinotSearchParseResult> {
    return parseGuinotPruneraSearch({ html: document, url });
  }
}

export { isGuinotPruneraSearchUrl, parseGuinotPruneraSearch } from './search.js';
export { getGuinotListingIdentity, guinotSearchCollectionAdapter } from './collection.js';
export type {
  GuinotSearchCompleteness,
  GuinotSearchListing,
  GuinotSearchParseResult,
  GuinotSearchResult,
  ParseGuinotSearchInput,
} from './search-types.js';
