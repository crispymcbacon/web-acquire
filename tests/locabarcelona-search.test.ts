import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectPaginatedSearch, type AcquiredSearchPage } from '../src/core/collect.js';
import { normalizeUrl } from '../src/core/identity.js';
import {
  LocaBarcelonaAdapter,
  isLocaBarcelonaSearchUrl,
  locaSearchCollectionAdapter,
  parseLocaBarcelonaSearch,
} from '../src/adapters/locabarcelona/index.js';

const fixture = (name: string) => readFile(path.join('tests', 'fixtures', 'locabarcelona', name), 'utf8');
const searchUrl = 'https://www.locabarcelona.com/en/property-status/long-term-rental/';
const page2Url = 'https://www.locabarcelona.com/en/property-status/long-term-rental/page/2/';
const adapter = new LocaBarcelonaAdapter();

describe('LOCA Barcelona URL handling', () => {
  it('recognizes the long-term archive, its pagination, and the blocked search URL', () => {
    expect(adapter.pageType(searchUrl)).toBe('search');
    expect(adapter.pageType(page2Url)).toBe('search');
    expect(isLocaBarcelonaSearchUrl('https://www.locabarcelona.com/en/property-search/?status=long-term-rental&bedrooms=3&max-price=2500')).toBe(true);
    expect(adapter.pageType('https://www.locabarcelona.com/en/property/housing-maternitat-sant-ramon-barcelona-la31pis514/')).toBe('unsupported');
    expect(isLocaBarcelonaSearchUrl('https://www.shbarcelona.com/apartments-for-rent/long-term')).toBe(false);
    expect(adapter.canHandle(new URL('https://example.com/property-status/long-term-rental/'))).toBe(false);
  });
});

describe('LOCA Barcelona search parsing', () => {
  it('extracts listing cards and the next page link', async () => {
    const result = parseLocaBarcelonaSearch({ html: await fixture('search-active.html'), url: searchUrl });
    expect(result.completeness?.accepted).toBe(true);
    expect(result.search?.summary.resultCount).toBe(2);
    expect(result.search?.pagination.nextUrl).toBe(page2Url);
    expect(result.search?.listings).toEqual([
      {
        listingId: '856957',
        reference: 'LA31PIS514',
        url: 'https://www.locabarcelona.com/en/property/housing-maternitat-sant-ramon-barcelona-la31pis514/',
        title: 'Long-term rental housing in Les Corts, Barcelona',
        priceEurMonth: 1354,
        bedrooms: 4,
        bathrooms: 1,
        sizeM2: 94,
        locationText: 'Corts . C. del Pisuerga',
        descriptionExcerpt: null,
        contractType: 'long-term',
        position: 1,
      },
      {
        listingId: '1125772',
        reference: 'LA12COC938',
        url: 'https://www.locabarcelona.com/en/property/property-antiga-esquerra-eixample-barcelona-la12coc/',
        title: 'Charming property in Antiga Esquerra de l’Eixample, with parking, Barcelona',
        priceEurMonth: 2230,
        bedrooms: 3,
        bathrooms: 2,
        sizeM2: 111,
        locationText: "L' Antiga Esquerra de l'Eixample . Carrer del Consell de Cent",
        descriptionExcerpt: null,
        contractType: 'long-term',
        position: 2,
      },
    ]);
  });

  it('treats a next link to the current page as the end', async () => {
    const result = parseLocaBarcelonaSearch({ html: await fixture('search-page-2.html'), url: page2Url });
    expect(result.completeness?.accepted).toBe(true);
    expect(result.search?.pagination.nextUrl).toBeNull();
  });

  it('accepts an explicit zero-result page and rejects broken, blocked, and id-less pages', async () => {
    const empty = parseLocaBarcelonaSearch({ html: await fixture('search-empty.html'), url: searchUrl });
    expect(empty.completeness?.explicitZeroResults).toBe(true);
    expect(empty.completeness?.accepted).toBe(true);
    expect(empty.search?.listings).toEqual([]);

    const blocked = parseLocaBarcelonaSearch({
      html: await fixture('search-blocked.html'),
      url: 'https://www.locabarcelona.com/en/property-search/?status=long-term-rental',
    });
    expect(blocked.completeness?.blocked).toBe(true);
    expect(blocked.completeness?.accepted).toBe(false);

    const malformed = parseLocaBarcelonaSearch({ html: '<html><body><h1>Hello</h1></body></html>', url: searchUrl });
    expect(malformed.completeness?.accepted).toBe(false);
    expect(malformed.completeness?.rejectionReasons).toContain('search_page_not_recognized');

    const unresolved = parseLocaBarcelonaSearch({ html: await fixture('search-unresolved.html'), url: searchUrl });
    expect(unresolved.completeness?.accepted).toBe(false);
    expect(unresolved.completeness?.rejectionReasons).toContain('listing_ids_unresolved');
  });
});

describe('LOCA Barcelona collection', () => {
  it('collects pages, drops duplicates, and stops on a self next link', async () => {
    const pages: Record<string, string> = {
      [normalizeUrl(searchUrl)]: await fixture('search-active.html'),
      [normalizeUrl(page2Url)]: await fixture('search-page-2.html'),
    };
    const inventory = await collectPaginatedSearch({
      initialUrl: searchUrl,
      source: 'locabarcelona',
      maxPages: 10,
      adapter: locaSearchCollectionAdapter,
      acquirePage: async (url, index): Promise<AcquiredSearchPage> => ({
        success: true,
        document: pages[url],
        outputDir: `pages/${index}`,
      }),
    });
    expect(inventory.status).toBe('complete');
    expect(inventory.summary).toMatchObject({ pagesFetched: 2, uniqueListings: 3, duplicatesSkipped: 1 });
    expect(inventory.listings.map((listing) => listing.listingId)).toEqual(['856957', '1125772', '483728']);
    expect(inventory.listings.map((listing) => listing.position)).toEqual([1, 2, 3]);
  });

  it('does not keep a partial page as a complete inventory', async () => {
    const inventory = await collectPaginatedSearch({
      initialUrl: searchUrl,
      source: 'locabarcelona',
      maxPages: 10,
      adapter: locaSearchCollectionAdapter,
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
