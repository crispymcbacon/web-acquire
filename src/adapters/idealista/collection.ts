import type { PaginatedSearchAdapter } from '../../core/collect.js';
import { parseIdealistaSearch } from './search.js';
import type { IdealistaSearchListing, IdealistaSearchResult } from './search-types.js';

/** Adapts Idealista's one-page parser to the generic sequential collector. */
export function getIdealistaListingIdentity(listing: IdealistaSearchListing): string {
  return listing.idealistaId;
}

export const idealistaSearchCollectionAdapter: PaginatedSearchAdapter<IdealistaSearchResult, IdealistaSearchListing> = {
  parseSearch(document, url) {
    const parsed = parseIdealistaSearch({ html: document, url });
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
  getItemIdentity: getIdealistaListingIdentity,
  setItemPosition(item, position) {
    return { ...item, position };
  },
};
