import { randomUUID } from 'node:crypto';
import { createSearchKey, normalizeUrl } from './identity.js';

export const MAX_COLLECTION_PAGES = 500;

export type CollectionStatus = 'complete' | 'max_pages_reached' | 'partial' | 'failed';

export interface ParsedSearchPage<TPage, TItem> {
  page: TPage | null;
  items: TItem[];
  accepted: boolean;
  nextUrl: string | null;
  reportedResultCount: number | null;
  warnings: string[];
  errors: string[];
}

/** The small contract a site adapter needs to participate in collection. */
export interface PaginatedSearchAdapter<TPage, TItem> {
  parseSearch(document: string, url: URL): ParsedSearchPage<TPage, TItem> | Promise<ParsedSearchPage<TPage, TItem>>;
  getItemIdentity(item: TItem): string;
  setItemPosition?: (item: TItem, position: number) => TItem;
}

/** Acquisition is injected so collection can be tested without a network provider. */
export interface AcquiredSearchPage {
  success: boolean;
  document?: string;
  outputDir: string;
  status?: string;
  warnings?: string[];
  errors?: string[];
}

export interface SearchInventoryPage {
  index: number;
  url: string;
  status: string;
  listingsFound: number;
  uniqueListingsAdded: number;
  nextUrl: string | null;
  outputDir: string;
}

export interface SearchInventory<TItem> {
  schema: 2;
  source: string;
  snapshotId: string;
  initialUrl: string;
  normalizedInitialUrl: string;
  searchKey: string;
  status: CollectionStatus;
  collectedAt: string;
  summary: {
    pagesFetched: number;
    listingsSeen: number;
    uniqueListings: number;
    duplicatesSkipped: number;
    reportedResultCount: number | null;
  };
  listings: TItem[];
  pages: SearchInventoryPage[];
  warnings: string[];
  nextUrl: string | null;
}

export interface CollectPaginatedSearchOptions<TPage, TItem> {
  initialUrl: string | URL;
  source: string;
  maxPages: number;
  adapter: PaginatedSearchAdapter<TPage, TItem>;
  acquirePage: (url: string, index: number) => Promise<AcquiredSearchPage>;
  onPageParsed?: (event: {
    index: number;
    url: string;
    outputDir: string;
    page: TPage;
  }) => Promise<void>;
  collectedAt?: string;
}

function errorText(errors: string[] | undefined, fallback: string): string {
  return errors?.filter(Boolean).join('; ') || fallback;
}

export async function collectPaginatedSearch<TPage, TItem>(
  options: CollectPaginatedSearchOptions<TPage, TItem>,
): Promise<SearchInventory<TItem>> {
  if (!Number.isInteger(options.maxPages) || options.maxPages < 1 || options.maxPages > MAX_COLLECTION_PAGES) {
    throw new Error(`maxPages must be an integer between 1 and ${MAX_COLLECTION_PAGES}`);
  }

  const normalizedInitialUrl = normalizeUrl(options.initialUrl);
  const snapshotId = randomUUID();
  const collectedAt = options.collectedAt ?? new Date().toISOString();
  const visitedUrls = new Set<string>();
  const seenItemIds = new Set<string>();
  const listings: TItem[] = [];
  const pages: SearchInventoryPage[] = [];
  const warnings: string[] = [];
  let currentUrl: string | null = normalizedInitialUrl;
  let status: CollectionStatus = 'complete';
  let continuationUrl: string | null = null;
  let reportedResultCount: number | null = null;
  let listingsSeen = 0;
  let duplicatesSkipped = 0;

  while (currentUrl) {
    if (visitedUrls.has(currentUrl)) {
      warnings.push(`pagination_loop: URL already visited: ${currentUrl}`);
      status = 'partial';
      continuationUrl = currentUrl;
      break;
    }
    if (pages.length >= options.maxPages) {
      status = 'max_pages_reached';
      continuationUrl = currentUrl;
      break;
    }

    const pageIndex = pages.length + 1;
    visitedUrls.add(currentUrl);
    let acquired: AcquiredSearchPage;
    try {
      acquired = await options.acquirePage(currentUrl, pageIndex);
    } catch (error: unknown) {
      acquired = {
        success: false,
        outputDir: '',
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }

    if (!acquired.success || !acquired.document) {
      const message = `page ${pageIndex} acquisition failed: ${errorText(acquired.errors, 'no document retained')}`;
      warnings.push(message);
      pages.push({
        index: pageIndex,
        url: currentUrl,
        status: acquired.status ?? 'acquisition_failed',
        listingsFound: 0,
        uniqueListingsAdded: 0,
        nextUrl: null,
        outputDir: acquired.outputDir,
      });
      status = pageIndex === 1 ? 'failed' : 'partial';
      break;
    }

    let parsed: ParsedSearchPage<TPage, TItem>;
    try {
      parsed = await options.adapter.parseSearch(acquired.document, new URL(currentUrl));
    } catch (error: unknown) {
      parsed = {
        page: null,
        items: [],
        accepted: false,
        nextUrl: null,
        reportedResultCount: null,
        warnings: [],
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }

    let normalizedNextUrl: string | null = null;
    let invalidNextUrl = false;
    if (parsed.nextUrl) {
      try {
        normalizedNextUrl = normalizeUrl(parsed.nextUrl);
      } catch {
        invalidNextUrl = true;
        warnings.push(`page ${pageIndex}: invalid next URL returned by search parser`);
      }
    }
    pages.push({
      index: pageIndex,
      url: currentUrl,
      status: parsed.accepted ? 'complete' : 'search_rejected',
      listingsFound: parsed.items.length,
      uniqueListingsAdded: 0,
      nextUrl: normalizedNextUrl,
      outputDir: acquired.outputDir,
    });

    warnings.push(...(acquired.warnings ?? []).map((warning) => `page ${pageIndex}: ${warning}`));
    warnings.push(...parsed.warnings.map((warning) => `page ${pageIndex}: ${warning}`));

    if (parsed.reportedResultCount !== null) {
      if (reportedResultCount === null) {
        reportedResultCount = parsed.reportedResultCount;
      } else if (reportedResultCount !== parsed.reportedResultCount) {
        warnings.push(`reported_result_count_changed: ${reportedResultCount} -> ${parsed.reportedResultCount} on page ${pageIndex}`);
      }
    }

    if (parsed.page !== null && options.onPageParsed) {
      try {
        await options.onPageParsed({ index: pageIndex, url: currentUrl, outputDir: acquired.outputDir, page: parsed.page });
      } catch (error: unknown) {
        const message = `page ${pageIndex} output failed: ${error instanceof Error ? error.message : String(error)}`;
        warnings.push(message);
        pages[pages.length - 1]!.status = 'output_failed';
        status = pageIndex === 1 ? 'failed' : 'partial';
        break;
      }
    }

    if (!parsed.accepted) {
      const reasons = parsed.errors.length > 0 ? parsed.errors : parsed.warnings;
      warnings.push(`page ${pageIndex} search completeness failed: ${errorText(reasons, 'search page rejected')}`);
      status = pageIndex === 1 ? 'failed' : 'partial';
      break;
    }

    let uniqueListingsAdded = 0;
    listingsSeen += parsed.items.length;
    for (const item of parsed.items) {
      const identity = options.adapter.getItemIdentity(item).trim();
      if (!identity) {
        warnings.push(`page ${pageIndex}: listing without an identity skipped`);
        continue;
      }
      if (seenItemIds.has(identity)) {
        duplicatesSkipped += 1;
        continue;
      }
      seenItemIds.add(identity);
      uniqueListingsAdded += 1;
      listings.push(options.adapter.setItemPosition
        ? options.adapter.setItemPosition(item, listings.length + 1)
        : item);
    }
    pages[pages.length - 1]!.uniqueListingsAdded = uniqueListingsAdded;

    currentUrl = normalizedNextUrl;
    if (invalidNextUrl) {
      status = pageIndex === 1 ? 'failed' : 'partial';
      break;
    }
    if (!currentUrl) {
      status = 'complete';
      break;
    }
    if (visitedUrls.has(currentUrl)) {
      warnings.push(`pagination_loop: next URL already visited: ${currentUrl}`);
      status = 'partial';
      continuationUrl = currentUrl;
      break;
    }
    if (pages.length >= options.maxPages) {
      status = 'max_pages_reached';
      continuationUrl = currentUrl;
      break;
    }
  }

  return {
    schema: 2,
    source: options.source,
    status,
    snapshotId,
    initialUrl: normalizedInitialUrl,
    normalizedInitialUrl,
    searchKey: createSearchKey(options.source, normalizedInitialUrl),
    collectedAt,
    summary: {
      pagesFetched: pages.length,
      listingsSeen,
      uniqueListings: listings.length,
      duplicatesSkipped,
      reportedResultCount,
    },
    listings,
    pages,
    warnings,
    nextUrl: continuationUrl,
  };
}
