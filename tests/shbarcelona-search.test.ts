import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectPaginatedSearch, type AcquiredSearchPage } from '../src/core/collect.js';
import { normalizeUrl } from '../src/core/identity.js';
import {
  ShBarcelonaAdapter,
  isShBarcelonaSearchUrl,
  parseShBarcelonaSearch,
  shSearchCollectionAdapter,
} from '../src/adapters/shbarcelona/index.js';

const fixture = (name: string) => readFile(path.join('tests', 'fixtures', 'shbarcelona', name), 'utf8');
const searchUrl = 'https://www.shbarcelona.com/apartments-for-rent/long-term?maxPrice=2400&type=9&bedrooms=3';
const nextUrl = 'https://www.shbarcelona.com/api/proxy/Property/properties?bedrooms=3&department=yearly&maxPrice=2400&pageNumber=2&pageSize=25&province=8&type=9';
const adapter = new ShBarcelonaAdapter();

describe('ShBarcelona URL handling', () => {
  it('recognizes search, API pagination, and rejects other pages', () => {
    expect(adapter.pageType(searchUrl)).toBe('search');
    expect(adapter.pageType(nextUrl)).toBe('search');
    expect(adapter.pageType('https://www.shbarcelona.com/l/arizala-travessera-de-les-corts--16723')).toBe('unsupported');
    expect(isShBarcelonaSearchUrl('https://www.locabarcelona.com/en/property-status/long-term-rental/')).toBe(false);
    expect(adapter.canHandle(new URL('https://example.com/apartments-for-rent/long-term'))).toBe(false);
  });
});

describe('ShBarcelona search parsing', () => {
  it('extracts payload listings and the properties API next URL', async () => {
    const result = parseShBarcelonaSearch({ html: await fixture('search-active.html'), url: searchUrl });
    expect(result.completeness?.accepted).toBe(true);
    expect(result.search?.summary).toEqual({ resultCount: 3, currentPage: 1, totalPages: 2 });
    expect(result.search?.pagination.nextUrl).toBe(nextUrl);
    expect(result.search?.listings).toEqual([
      {
        listingId: '16723',
        reference: '231P55IRA21',
        url: 'https://www.shbarcelona.com/l/arizala-travessera-de-les-corts--16723',
        title: 'Arizala - Travessera De Les Corts',
        priceEurMonth: 1167,
        bedrooms: 3,
        bathrooms: 1,
        sizeM2: 65,
        locationText: 'Les Corts, Barcelona',
        descriptionExcerpt: 'Apartment in Les Corts, completely renovated.',
        contractType: 'long-term',
        position: 1,
      },
      {
        listingId: '18800',
        reference: '230P911LAC15',
        url: 'https://www.shbarcelona.com/l/calabria-diputacio--18800',
        title: 'Calabria - Diputació',
        priceEurMonth: 2179,
        bedrooms: 4,
        bathrooms: 2,
        sizeM2: 79,
        locationText: 'Eixample, Barcelona',
        descriptionExcerpt: null,
        contractType: 'long-term',
        position: 2,
      },
    ]);
  });

  it('accepts zero results and rejects blocked, malformed, and id-less payloads', async () => {
    const empty = parseShBarcelonaSearch({ html: await fixture('search-empty.json'), url: searchUrl });
    expect(empty.completeness?.explicitZeroResults).toBe(true);
    expect(empty.completeness?.accepted).toBe(true);

    const blocked = parseShBarcelonaSearch({ html: await fixture('search-blocked.html'), url: searchUrl });
    expect(blocked.completeness?.blocked).toBe(true);
    expect(blocked.completeness?.accepted).toBe(false);

    const malformed = parseShBarcelonaSearch({ html: '<html><body><h1>Hello</h1></body></html>', url: searchUrl });
    expect(malformed.completeness?.accepted).toBe(false);
    expect(malformed.completeness?.rejectionReasons).toContain('search_page_not_recognized');

    const unresolved = parseShBarcelonaSearch({ html: await fixture('search-unresolved.html'), url: searchUrl });
    expect(unresolved.completeness?.accepted).toBe(false);
    expect(unresolved.completeness?.rejectionReasons).toContain('listing_ids_unresolved');
  });
});

describe('ShBarcelona collection', () => {
  it('follows the properties API, drops duplicates, and stops on the last page', async () => {
    const pages: Record<string, string> = {
      [normalizeUrl(searchUrl)]: await fixture('search-active.html'),
      [normalizeUrl(nextUrl)]: await fixture('search-page-2.json'),
    };
    const inventory = await collectPaginatedSearch({
      initialUrl: searchUrl,
      source: 'shbarcelona',
      maxPages: 10,
      adapter: shSearchCollectionAdapter,
      acquirePage: async (url, index): Promise<AcquiredSearchPage> => ({
        success: true,
        document: pages[url],
        outputDir: `pages/${index}`,
      }),
    });
    expect(inventory.status).toBe('complete');
    expect(inventory.summary).toMatchObject({ pagesFetched: 2, uniqueListings: 3, duplicatesSkipped: 1 });
    expect(inventory.listings.map((listing) => [listing.listingId, listing.position])).toEqual([
      ['16723', 1],
      ['18800', 2],
      ['21242', 3],
    ]);
  });

  it('marks the snapshot partial when a later page is not a search payload', async () => {
    const inventory = await collectPaginatedSearch({
      initialUrl: searchUrl,
      source: 'shbarcelona',
      maxPages: 10,
      adapter: shSearchCollectionAdapter,
      acquirePage: async (url): Promise<AcquiredSearchPage> => ({
        success: true,
        document: url === normalizeUrl(searchUrl) ? await fixture('search-active.html') : '<html><body>nope</body></html>',
        outputDir: 'page',
      }),
    });
    expect(inventory.status).toBe('partial');
    expect(inventory.listings).toHaveLength(2);
  });
});
