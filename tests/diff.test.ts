import { describe, expect, it } from 'vitest';
import { createSearchKey, normalizeUrl } from '../src/core/identity.js';
import type { SearchInventory } from '../src/core/collect.js';
import { diffInventories } from '../src/core/diff.js';

type Item = { idealistaId: string; title: string; priceEurMonth?: number };

const normalizedInitialUrl = 'https://www.idealista.com/alquiler-viviendas/barcelona-barcelona/';
const searchKey = createSearchKey('idealista', normalizedInitialUrl);

function inventory(
  ids: string[],
  overrides: Partial<SearchInventory<Item>> = {},
): SearchInventory<Item> {
  const listings = ids.map((id, index) => ({ idealistaId: id, title: `Listing ${id}`, priceEurMonth: 1000 + index }));
  return {
    schema: 2,
    source: 'idealista',
    snapshotId: `snapshot-${overrides.collectedAt ?? 'base'}-${ids.join('')}`,
    initialUrl: normalizedInitialUrl,
    normalizedInitialUrl,
    searchKey,
    status: 'complete',
    collectedAt: '2026-01-01T00:00:00.000Z',
    summary: {
      pagesFetched: 1,
      listingsSeen: listings.length,
      uniqueListings: listings.length,
      duplicatesSkipped: 0,
      reportedResultCount: listings.length,
    },
    listings,
    pages: [],
    warnings: [],
    nextUrl: null,
    ...overrides,
  };
}

const identity = (item: Item) => item.idealistaId;

describe('inventory presence diff', () => {
  it('classifies added listings and retains current representations', () => {
    const previous = inventory(['A', 'B']);
    const current = inventory(['A', 'B', 'C'], { collectedAt: '2026-01-02T00:00:00.000Z' });
    const diff = diffInventories({ previous, current, getItemIdentity: identity, generatedAt: '2026-01-03T00:00:00.000Z' });
    expect(diff.added.map((item) => item.idealistaId)).toEqual(['C']);
    expect(diff.retained.map((item) => item.idealistaId)).toEqual(['A', 'B']);
    expect(diff.removed).toEqual([]);
  });

  it('classifies removed listings using previous representations', () => {
    const previous = inventory(['A', 'B', 'C']);
    const current = inventory(['A', 'C'], { collectedAt: '2026-01-02T00:00:00.000Z' });
    const diff = diffInventories({ previous, current, getItemIdentity: identity });
    expect(diff.removed.map((item) => item.idealistaId)).toEqual(['B']);
  });

  it('preserves current and previous ordering for combined changes', () => {
    const previous = inventory(['A', 'B', 'C']);
    const current = inventory(['D', 'C', 'B'], { collectedAt: '2026-01-02T00:00:00.000Z' });
    const diff = diffInventories({ previous, current, getItemIdentity: identity });
    expect(diff.added.map((item) => item.idealistaId)).toEqual(['D']);
    expect(diff.retained.map((item) => item.idealistaId)).toEqual(['C', 'B']);
    expect(diff.removed.map((item) => item.idealistaId)).toEqual(['A']);
    expect(diff.summary).toEqual({ previousCount: 3, currentCount: 3, added: 1, retained: 2, removed: 1 });
  });

  it('treats metadata changes as retained presence', () => {
    const previous = inventory(['A']);
    const current = inventory(['A'], {
      collectedAt: '2026-01-02T00:00:00.000Z',
      listings: [{ idealistaId: 'A', title: 'Updated title', priceEurMonth: 1900 }],
    });
    const diff = diffInventories({ previous, current, getItemIdentity: identity });
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.retained).toEqual(current.listings);
  });

  it('returns an empty change set when identities are unchanged', () => {
    const previous = inventory(['A', 'B']);
    const current = inventory(['A', 'B'], { collectedAt: '2026-01-02T00:00:00.000Z' });
    const diff = diffInventories({ previous, current, getItemIdentity: identity });
    expect(diff.summary).toEqual({ previousCount: 2, currentCount: 2, added: 0, retained: 2, removed: 0 });
  });

  it.each(['partial', 'failed', 'max_pages_reached'] as const)('rejects an unsafe %s snapshot', (status) => {
    const previous = inventory(['A']);
    const current = inventory(['A'], { status, collectedAt: '2026-01-02T00:00:00.000Z' });
    expect(() => diffInventories({ previous, current, getItemIdentity: identity })).toThrow(`current inventory is ${status}, not complete`);
  });

  it('rejects different source and search identities', () => {
    const previous = inventory(['A']);
    expect(() => diffInventories({ previous, current: inventory(['A'], { source: 'other', collectedAt: '2026-01-02T00:00:00.000Z' }), getItemIdentity: identity })).toThrow('different sources');
    expect(() => diffInventories({ previous, current: inventory(['A'], { searchKey: 'different', collectedAt: '2026-01-02T00:00:00.000Z' }), getItemIdentity: identity })).toThrow('different searches');
  });

  it('rejects duplicate identities and reversed chronology', () => {
    const duplicate = inventory(['A', 'A']);
    expect(() => diffInventories({ previous: duplicate, current: inventory(['A'], { collectedAt: '2026-01-02T00:00:00.000Z' }), getItemIdentity: identity })).toThrow('duplicate listing identity A');
    expect(() => diffInventories({ previous: inventory(['A']), current: inventory(['A'], { collectedAt: '2025-12-31T00:00:00.000Z' }), getItemIdentity: identity })).toThrow('previous collectedAt is newer');
  });

  it('requires canonical schema 2 inventories', () => {
    const schema1 = { ...inventory(['A']), schema: 1 } as unknown as SearchInventory<Item>;
    expect(() => diffInventories({ previous: schema1, current: inventory(['A'], { collectedAt: '2026-01-02T00:00:00.000Z' }), getItemIdentity: identity })).toThrow('schema 2 is required');
  });
});

describe('search identity normalization', () => {
  it('gives equivalent generic URL formatting the same search key', () => {
    const first = normalizeUrl('https://example.com/search?b=2&a=1');
    const second = normalizeUrl('https://EXAMPLE.com:443/search?a=1&b=2#ignored');
    expect(first).toBe(second);
    expect(createSearchKey('example', first)).toBe(createSearchKey('example', second));
  });

  it('keeps genuinely different filters distinct', () => {
    expect(createSearchKey('example', normalizeUrl('https://example.com/search?a=1')))
      .not.toBe(createSearchKey('example', normalizeUrl('https://example.com/search?a=2')));
  });
});
