import type { PaginatedSearchAdapter } from '../../core/collect.js';
import { parseLocaBarcelonaSearch } from './search.js';
import type { LocaSearchListing, LocaSearchResult } from './search-types.js';

export function getLocaListingIdentity(listing: LocaSearchListing): string {
  return listing.listingId;
}

export const locaSearchCollectionAdapter: PaginatedSearchAdapter<LocaSearchResult, LocaSearchListing> = {
  parseSearch(document, url) {
    const parsed = parseLocaBarcelonaSearch({ html: document, url });
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
  getItemIdentity: getLocaListingIdentity,
  setItemPosition(item, position) {
    return { ...item, position };
  },
};
