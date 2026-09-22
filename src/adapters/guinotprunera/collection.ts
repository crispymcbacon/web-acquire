import type { PaginatedSearchAdapter } from '../../core/collect.js';
import { parseGuinotPruneraSearch } from './search.js';
import type { GuinotSearchListing, GuinotSearchResult } from './search-types.js';

export function getGuinotListingIdentity(listing: GuinotSearchListing): string {
  return listing.listingId;
}

export const guinotSearchCollectionAdapter: PaginatedSearchAdapter<GuinotSearchResult, GuinotSearchListing> = {
  parseSearch(document, url) {
    const parsed = parseGuinotPruneraSearch({ html: document, url });
    return {
      page: parsed.search,
      items: parsed.search?.listings ?? [],
      accepted: parsed.completeness?.accepted ?? false,
      nextUrl: parsed.search?.pagination.nextUrl ?? null,
      reportedResultCount: parsed.search?.summary.resultCount ?? null,
      warnings: parsed.search?.warnings ?? [],
      errors: parsed.errors,
    };
  },
  getItemIdentity: getGuinotListingIdentity,
  setItemPosition(item, position) {
    return { ...item, position };
  },
};
