import type { PaginatedSearchAdapter } from '../../core/collect.js';
import { parseShBarcelonaSearch } from './search.js';
import type { ShSearchListing, ShSearchResult } from './search-types.js';

export function getShListingIdentity(listing: ShSearchListing): string {
  return listing.listingId;
}

export const shSearchCollectionAdapter: PaginatedSearchAdapter<ShSearchResult, ShSearchListing> = {
  parseSearch(document, url) {
    const parsed = parseShBarcelonaSearch({ html: document, url });
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
  getItemIdentity: getShListingIdentity,
  setItemPosition(item, position) {
    return { ...item, position };
  },
};
