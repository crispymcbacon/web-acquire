import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { IdealistaAdapter, isIdealistaSearchUrl, parseIdealistaSearch } from '../src/adapters/idealista/index.js';

const fixture = (name: string) => readFile(path.join('tests', 'fixtures', 'idealista', name), 'utf8');
const searchUrl = 'https://www.idealista.com/alquiler-viviendas/barcelona-barcelona/';

const adapter = new IdealistaAdapter();

describe('Idealista page-type detection', () => {
  it('distinguishes detail, search, paginated search, and unsupported pages', () => {
    expect(adapter.pageType('https://www.idealista.com/inmueble/112536871/')).toBe('detail');
    expect(adapter.pageType(searchUrl)).toBe('search');
    expect(adapter.pageType(`${searchUrl}pagina-2.htm`)).toBe('search');
    expect(adapter.pageType(`${searchUrl}?ordenado-por=precios-asc`)).toBe('search');
    expect(adapter.pageType('https://www.idealista.com/')).toBe('unsupported');
    expect(isIdealistaSearchUrl('https://example.com/alquiler-viviendas/barcelona/')).toBe(false);
  });
});

describe('Idealista search parsing', () => {
  it('extracts cards, facts, tags, and preserves card ordering', async () => {
    const result = parseIdealistaSearch({ html: await fixture('search-active.html'), url: searchUrl });
    expect(result.pageType).toBe('search');
    expect(result.completeness).toEqual({
      accepted: true,
      searchPageRecognized: true,
      listingCardsFound: true,
      listingIdsResolved: true,
      blocked: false,
      rejectionReasons: [],
    });
    expect(result.search?.summary).toEqual({ resultCount: 1234, currentPage: null, totalPages: null });
    expect(result.search?.listings).toEqual([
      {
        idealistaId: '1001',
        url: 'https://www.idealista.com/inmueble/1001/',
        title: 'Piso exterior luminoso',
        priceEurMonth: 1800,
        bedrooms: 3,
        bathrooms: 2,
        sizeM2: 80,
        floorText: '5ª planta exterior',
        locationText: 'Eixample, Barcelona',
        descriptionExcerpt: 'Piso reformado cerca del centro.',
        tags: ['Alquiler de temporada', 'Lujo'],
        photoCount: 8,
        position: 1,
      },
      {
        idealistaId: '1002',
        url: 'https://www.idealista.com/inmueble/1002/',
        title: 'Apartamento con terraza',
        priceEurMonth: 950,
        bedrooms: 1,
        bathrooms: null,
        sizeM2: 45,
        floorText: '2ª planta',
        locationText: 'Gràcia',
        descriptionExcerpt: null,
        tags: [],
        photoCount: null,
        position: 2,
      },
      {
        idealistaId: '1003',
        url: 'https://www.idealista.com/inmueble/1003/',
        title: 'Casa tranquila',
        priceEurMonth: 2400,
        bedrooms: 4,
        bathrooms: 3,
        sizeM2: 120,
        floorText: null,
        locationText: null,
        descriptionExcerpt: 'Descripción breve.',
        tags: [],
        photoCount: null,
        position: 3,
      },
    ]);
  });

  it('deduplicates cards by ID and keeps the first occurrence', async () => {
    const result = parseIdealistaSearch({ html: await fixture('search-duplicates.html'), url: searchUrl });
    expect(result.search?.listings.map(({ idealistaId, title, position }) => ({ idealistaId, title, position }))).toEqual([
      { idealistaId: '2001', title: 'Primera aparición', position: 1 },
      { idealistaId: '2002', title: 'Segunda vivienda', position: 2 },
    ]);
  });

  it('extracts explicit pagination and normalizes URLs', async () => {
    const url = `${searchUrl}pagina-2.htm`;
    const result = parseIdealistaSearch({ html: await fixture('search-pagination.html'), url });
    expect(result.search?.summary).toEqual({ resultCount: 20, currentPage: 2, totalPages: 5 });
    expect(result.search?.pagination).toEqual({
      nextUrl: 'https://www.idealista.com/alquiler-viviendas/barcelona-barcelona/pagina-3.htm',
      previousUrl: 'https://www.idealista.com/alquiler-viviendas/barcelona-barcelona/',
    });
  });

  it('accepts an explicit zero-result search', async () => {
    const result = parseIdealistaSearch({ html: await fixture('search-empty.html'), url: searchUrl });
    expect(result.search?.listings).toEqual([]);
    expect(result.search?.summary.resultCount).toBe(0);
    expect(result.completeness?.accepted).toBe(true);
  });

  it('rejects blocked and unrecognized searches', async () => {
    const blocked = parseIdealistaSearch({ html: await fixture('search-blocked.html'), url: searchUrl });
    expect(blocked.completeness?.blocked).toBe(true);
    expect(blocked.completeness?.accepted).toBe(false);
    expect(blocked.search?.warnings).toContain('challenge_or_blocked');

    const unrecognized = parseIdealistaSearch({ html: '<html><body><h1>Something else</h1></body></html>', url: searchUrl });
    expect(unrecognized.completeness?.accepted).toBe(false);
    expect(unrecognized.completeness?.rejectionReasons).toContain('listing_cards_not_found');
  });
});
