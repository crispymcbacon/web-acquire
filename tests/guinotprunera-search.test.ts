import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectPaginatedSearch, type AcquiredSearchPage } from '../src/core/collect.js';
import { normalizeUrl } from '../src/core/identity.js';
import {
  GuinotPruneraAdapter,
  guinotSearchCollectionAdapter,
  isGuinotPruneraSearchUrl,
  parseGuinotPruneraSearch,
} from '../src/adapters/guinotprunera/index.js';

const fixture = (name: string) => readFile(path.join('tests', 'fixtures', 'guinotprunera', name), 'utf8');
const searchUrl = 'https://www.guinotprunera.com/es/alquiler/en-barcelona/con-3_habitaciones_min,5_habitaciones_max,2400_precio_max';
const page2Url = 'https://www.guinotprunera.com/es/alquiler/en-barcelona/page/2';
const adapter = new GuinotPruneraAdapter();

describe('GuinotPrunera URL handling', () => {
  it('recognizes rental searches and pagination, and rejects detail or other-site URLs', () => {
    expect(adapter.pageType(searchUrl)).toBe('search');
    expect(adapter.pageType(page2Url)).toBe('search');
    expect(adapter.pageType(`${searchUrl}/ref-31997`)).toBe('unsupported');
    expect(isGuinotPruneraSearchUrl('https://www.shbarcelona.com/apartments-for-rent/long-term')).toBe(false);
    expect(adapter.canHandle(new URL('https://example.com/es/alquiler'))).toBe(false);
  });
});

describe('GuinotPrunera search parsing', () => {
  it('extracts table rows and has no server next page on the live card layout', async () => {
    const result = parseGuinotPruneraSearch({ html: await fixture('search-active.html'), url: searchUrl });
    expect(result.completeness?.accepted).toBe(true);
    expect(result.search?.summary.resultCount).toBe(2);
    expect(result.search?.pagination.nextUrl).toBeNull();
    expect(result.search?.listings).toEqual([
      {
        listingId: '1783413',
        reference: '31997',
        url: 'https://www.guinotprunera.com/es/alquiler/en-barcelona/con-3_habitaciones_min,5_habitaciones_max,2400_precio_max/ref-31997',
        title: 'LUMINOSO PISO EXTERIOR JUNTO A PARADA DE METRO',
        priceEurMonth: 729,
        bedrooms: 3,
        bathrooms: 1,
        sizeM2: 67,
        locationText: 'La Teixonera, Horta-Guinardó',
        descriptionExcerpt: 'Piso exterior a calle. Salón comedor sin balcón exterior.',
        position: 1,
      },
      {
        listingId: '1788156',
        reference: '32101',
        url: 'https://www.guinotprunera.com/es/alquiler/en-barcelona/con-3_habitaciones_min,5_habitaciones_max,2400_precio_max/ref-32101',
        title: 'PISO CON TERRAZA',
        priceEurMonth: 1535,
        bedrooms: 4,
        bathrooms: 1,
        sizeM2: 95,
        locationText: 'La Vila Olímpica del Poblenou, Sant Martí',
        descriptionExcerpt: 'Piso ubicado en Sant Martí, principal con ascensor.',
        position: 2,
      },
    ]);
  });

  it('follows a next link when the HTML actually contains one', async () => {
    const result = parseGuinotPruneraSearch({ html: await fixture('search-page-1-paged.html'), url: searchUrl });
    expect(result.search?.pagination.nextUrl).toBe(page2Url);
  });

  it('accepts zero results and rejects blocked, malformed, id-less, and short pages', async () => {
    const empty = parseGuinotPruneraSearch({ html: await fixture('search-empty.html'), url: searchUrl });
    expect(empty.completeness?.explicitZeroResults).toBe(true);
    expect(empty.completeness?.accepted).toBe(true);
    expect(empty.search?.listings).toEqual([]);

    const blocked = parseGuinotPruneraSearch({ html: await fixture('search-blocked.html'), url: searchUrl });
    expect(blocked.completeness?.blocked).toBe(true);
    expect(blocked.completeness?.accepted).toBe(false);

    const malformed = parseGuinotPruneraSearch({ html: '<html><body><h1>Hello</h1></body></html>', url: searchUrl });
    expect(malformed.completeness?.accepted).toBe(false);
    expect(malformed.completeness?.rejectionReasons).toContain('search_page_not_recognized');

    const unresolved = parseGuinotPruneraSearch({ html: await fixture('search-unresolved.html'), url: searchUrl });
    expect(unresolved.completeness?.accepted).toBe(false);
    expect(unresolved.completeness?.rejectionReasons).toContain('listing_ids_unresolved');

    const mismatch = parseGuinotPruneraSearch({ html: await fixture('search-mismatch.html'), url: searchUrl });
    expect(mismatch.completeness?.accepted).toBe(false);
    expect(mismatch.completeness?.rejectionReasons).toContain('listing_count_mismatch');
  });
});

describe('GuinotPrunera collection', () => {
  it('collects a next link, drops duplicates, and stops when the next page has no further link', async () => {
    const pages: Record<string, string> = {
      [normalizeUrl(searchUrl)]: await fixture('search-page-1-paged.html'),
      [normalizeUrl(page2Url)]: await fixture('search-page-2.html'),
    };
    const inventory = await collectPaginatedSearch({
      initialUrl: searchUrl,
      source: 'guinotprunera',
      maxPages: 10,
      adapter: guinotSearchCollectionAdapter,
      acquirePage: async (url, index): Promise<AcquiredSearchPage> => ({
        success: true,
        document: pages[url],
        outputDir: `pages/${index}`,
      }),
    });
    expect(inventory.status).toBe('complete');
    expect(inventory.summary).toMatchObject({ pagesFetched: 2, uniqueListings: 3, duplicatesSkipped: 1 });
    expect(inventory.listings.map((listing) => [listing.listingId, listing.position])).toEqual([
      ['1783413', 1],
      ['1788156', 2],
      ['1788299', 3],
    ]);
  });

  it('keeps an incomplete later page out of a complete snapshot', async () => {
    const inventory = await collectPaginatedSearch({
      initialUrl: searchUrl,
      source: 'guinotprunera',
      maxPages: 10,
      adapter: guinotSearchCollectionAdapter,
      acquirePage: async (url): Promise<AcquiredSearchPage> => ({
        success: true,
        document: url === normalizeUrl(searchUrl) ? await fixture('search-page-1-paged.html') : '<html><body>nope</body></html>',
        outputDir: 'page',
      }),
    });
    expect(inventory.status).toBe('partial');
    expect(inventory.listings).toHaveLength(2);
  });
});
