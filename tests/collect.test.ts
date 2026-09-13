import { describe, expect, it, vi } from 'vitest';
import {
  collectPaginatedSearch,
  MAX_COLLECTION_PAGES,
  type AcquiredSearchPage,
  type PaginatedSearchAdapter,
  type ParsedSearchPage,
} from '../src/core/collect.js';

type Item = { id: string; label: string; position?: number };
type Page = { items: Item[]; nextUrl: string | null; resultCount: number | null; accepted?: boolean };

const urls = {
  first: 'https://example.test/search?page=1',
  second: 'https://example.test/search?page=2',
  third: 'https://example.test/search?page=3',
  fourth: 'https://example.test/search?page=4',
};

function adapterFor(pages: Record<string, Page>): PaginatedSearchAdapter<Page, Item> {
  return {
    parseSearch(_document, url): ParsedSearchPage<Page, Item> {
      const page = pages[url.toString()];
      if (!page) throw new Error(`missing fake page: ${url}`);
      return {
        page,
        items: page.items,
        accepted: page.accepted ?? true,
        nextUrl: page.nextUrl,
        reportedResultCount: page.resultCount,
        warnings: [],
        errors: page.accepted === false ? ['fake_page_rejected'] : [],
      };
    },
    getItemIdentity: (item) => item.id,
    setItemPosition: (item, position) => ({ ...item, position }),
  };
}

function acquirerFor(pages: Record<string, Page>, failures = new Set<string>()) {
  return vi.fn(async (url: string, index: number): Promise<AcquiredSearchPage> => {
    if (failures.has(url)) {
      return { success: false, outputDir: `pages/${String(index).padStart(3, '0')}`, errors: ['fake acquisition failed'] };
    }
    if (!pages[url]) throw new Error(`unexpected acquisition: ${url}`);
    return { success: true, document: url, outputDir: `pages/${String(index).padStart(3, '0')}` };
  });
}

const items = (...ids: string[]): Item[] => ids.map((id) => ({ id, label: id }));

describe('generic paginated search collection', () => {
  it('acquires sequential pages, preserves first-seen order, and deduplicates', async () => {
    const pages = {
      [urls.first]: { items: items('A', 'B', 'C'), nextUrl: urls.second, resultCount: 5 },
      [urls.second]: { items: items('C', 'D', 'E'), nextUrl: urls.third, resultCount: 5 },
      [urls.third]: { items: items('F'), nextUrl: null, resultCount: 5 },
    };
    const acquirePage = acquirerFor(pages);
    const inventory = await collectPaginatedSearch({
      initialUrl: urls.first,
      source: 'fake-site',
      maxPages: 10,
      adapter: adapterFor(pages),
      acquirePage,
      collectedAt: '2026-01-01T00:00:00.000Z',
    });

    expect(acquirePage).toHaveBeenCalledTimes(3);
    expect(acquirePage.mock.calls.map(([url]) => url)).toEqual([urls.first, urls.second, urls.third]);
    expect(inventory.status).toBe('complete');
    expect(inventory.listings.map((item) => `${item.id}:${item.position}`)).toEqual(['A:1', 'B:2', 'C:3', 'D:4', 'E:5', 'F:6']);
    expect(inventory.summary).toEqual({
      pagesFetched: 3,
      listingsSeen: 7,
      uniqueListings: 6,
      duplicatesSkipped: 1,
      reportedResultCount: 5,
    });
    expect(inventory.pages.map((page) => page.uniqueListingsAdded)).toEqual([3, 2, 1]);
  });

  it('stops at the safety limit with a continuation URL', async () => {
    const pages = {
      [urls.first]: { items: items('A'), nextUrl: urls.second, resultCount: 3 },
      [urls.second]: { items: items('B'), nextUrl: urls.third, resultCount: 3 },
      [urls.third]: { items: items('C'), nextUrl: null, resultCount: 3 },
    };
    const acquirePage = acquirerFor(pages);
    const inventory = await collectPaginatedSearch({ initialUrl: urls.first, source: 'fake-site', maxPages: 2, adapter: adapterFor(pages), acquirePage });
    expect(acquirePage).toHaveBeenCalledTimes(2);
    expect(inventory.status).toBe('max_pages_reached');
    expect(inventory.nextUrl).toBe(urls.third);
    expect(inventory.summary.pagesFetched).toBe(2);
  });

  it('accepts a valid zero-result first page', async () => {
    const pages = { [urls.first]: { items: [], nextUrl: null, resultCount: 0 } };
    const inventory = await collectPaginatedSearch({ initialUrl: urls.first, source: 'fake-site', maxPages: 10, adapter: adapterFor(pages), acquirePage: acquirerFor(pages) });
    expect(inventory.status).toBe('complete');
    expect(inventory.summary).toMatchObject({ pagesFetched: 1, listingsSeen: 0, uniqueListings: 0 });
  });

  it('retains earlier pages when a later acquisition fails', async () => {
    const pages = {
      [urls.first]: { items: items('A'), nextUrl: urls.second, resultCount: 3 },
      [urls.second]: { items: items('B'), nextUrl: urls.third, resultCount: 3 },
      [urls.third]: { items: items('C'), nextUrl: urls.fourth, resultCount: 3 },
      [urls.fourth]: { items: items('D'), nextUrl: null, resultCount: 3 },
    };
    const acquirePage = acquirerFor(pages, new Set([urls.third]));
    const inventory = await collectPaginatedSearch({ initialUrl: urls.first, source: 'fake-site', maxPages: 10, adapter: adapterFor(pages), acquirePage });
    expect(acquirePage).toHaveBeenCalledTimes(3);
    expect(inventory.status).toBe('partial');
    expect(inventory.listings.map((item) => item.id)).toEqual(['A', 'B']);
    expect(inventory.pages).toHaveLength(3);
    expect(inventory.warnings).toContain('page 3 acquisition failed: fake acquisition failed');
  });

  it('retains earlier pages when a later page fails completeness', async () => {
    const pages = {
      [urls.first]: { items: items('A'), nextUrl: urls.second, resultCount: 2 },
      [urls.second]: { items: [], nextUrl: urls.third, resultCount: null, accepted: false },
      [urls.third]: { items: items('C'), nextUrl: null, resultCount: 2 },
    };
    const acquirePage = acquirerFor(pages);
    const inventory = await collectPaginatedSearch({ initialUrl: urls.first, source: 'fake-site', maxPages: 10, adapter: adapterFor(pages), acquirePage });
    expect(acquirePage).toHaveBeenCalledTimes(2);
    expect(inventory.status).toBe('partial');
    expect(inventory.listings.map((item) => item.id)).toEqual(['A']);
    expect(inventory.warnings).toContain('page 2 search completeness failed: fake_page_rejected');
  });

  it('terminates pagination loops without a repeated acquisition', async () => {
    const pages = {
      [urls.first]: { items: items('A'), nextUrl: urls.second, resultCount: 2 },
      [urls.second]: { items: items('B'), nextUrl: urls.first, resultCount: 2 },
    };
    const acquirePage = acquirerFor(pages);
    const inventory = await collectPaginatedSearch({ initialUrl: urls.first, source: 'fake-site', maxPages: 10, adapter: adapterFor(pages), acquirePage });
    expect(acquirePage).toHaveBeenCalledTimes(2);
    expect(inventory.status).toBe('partial');
    expect(inventory.nextUrl).toBe(urls.first);
    expect(inventory.warnings).toContain(`pagination_loop: next URL already visited: ${urls.first}`);
  });

  it('also prevents a same-page loop before a second request', async () => {
    const pages = { [urls.first]: { items: items('A'), nextUrl: `${urls.first}#fragment`, resultCount: 1 } };
    const acquirePage = acquirerFor({ [urls.first]: pages[urls.first] });
    const inventory = await collectPaginatedSearch({ initialUrl: `${urls.first}#start`, source: 'fake-site', maxPages: 10, adapter: adapterFor(pages), acquirePage });
    expect(acquirePage).toHaveBeenCalledTimes(1);
    expect(inventory.status).toBe('partial');
    expect(inventory.nextUrl).toBe(urls.first);
  });

  it('keeps the first reported count and warns when later pages disagree', async () => {
    const pages = {
      [urls.first]: { items: items('A'), nextUrl: urls.second, resultCount: 10 },
      [urls.second]: { items: items('B'), nextUrl: null, resultCount: 11 },
    };
    const inventory = await collectPaginatedSearch({ initialUrl: urls.first, source: 'fake-site', maxPages: 10, adapter: adapterFor(pages), acquirePage: acquirerFor(pages) });
    expect(inventory.summary.reportedResultCount).toBe(10);
    expect(inventory.warnings).toContain('reported_result_count_changed: 10 -> 11 on page 2');
  });

  it('validates the hard max-pages bound', async () => {
    const pages = { [urls.first]: { items: [], nextUrl: null, resultCount: 0 } };
    await expect(collectPaginatedSearch({ initialUrl: urls.first, source: 'fake-site', maxPages: MAX_COLLECTION_PAGES + 1, adapter: adapterFor(pages), acquirePage: acquirerFor(pages) })).rejects.toThrow('maxPages must be an integer');
  });
});
