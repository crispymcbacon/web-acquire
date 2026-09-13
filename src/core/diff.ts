import type { SearchInventory } from './collect.js';

export interface InventoryDiff<TItem> {
  schema: 1;
  kind: 'inventory_diff';
  source: string;
  searchKey: string;
  generatedAt: string;
  previous: {
    snapshotId: string;
    collectedAt: string;
    uniqueListings: number;
  };
  current: {
    snapshotId: string;
    collectedAt: string;
    uniqueListings: number;
  };
  summary: {
    previousCount: number;
    currentCount: number;
    added: number;
    retained: number;
    removed: number;
  };
  added: TItem[];
  retained: TItem[];
  removed: TItem[];
  warnings: string[];
}

export interface DiffInventoriesOptions<TItem> {
  previous: SearchInventory<TItem>;
  current: SearchInventory<TItem>;
  getItemIdentity: (item: TItem) => string;
  generatedAt?: string;
}

function validateSnapshot<TItem>(snapshot: SearchInventory<TItem>, label: 'previous' | 'current'): void {
  if (snapshot.schema !== 2) {
    throw new Error(`Cannot compare ${label} inventory: schema 2 is required; recollect this inventory`);
  }
  if (!snapshot.snapshotId) throw new Error(`Cannot compare ${label} inventory: snapshotId is missing`);
  if (!snapshot.normalizedInitialUrl) throw new Error(`Cannot compare ${label} inventory: normalizedInitialUrl is missing`);
  if (!snapshot.searchKey) throw new Error(`Cannot compare ${label} inventory: searchKey is missing`);
  if (!snapshot.source) throw new Error(`Cannot compare ${label} inventory: source is missing`);
  if (!snapshot.collectedAt || !Number.isFinite(Date.parse(snapshot.collectedAt))) {
    throw new Error(`Cannot compare ${label} inventory: collectedAt is invalid`);
  }
  if (snapshot.status !== 'complete') {
    throw new Error(`Cannot compare listing presence: ${label} inventory is ${snapshot.status}, not complete.`);
  }
  if (!Array.isArray(snapshot.listings)) throw new Error(`Cannot compare ${label} inventory: listings must be an array`);
}

function identityMap<TItem>(snapshot: SearchInventory<TItem>, label: 'previous' | 'current', getItemIdentity: (item: TItem) => string): Map<string, TItem> {
  const identities = new Map<string, TItem>();
  snapshot.listings.forEach((item, index) => {
    let identity: string;
    try {
      identity = getItemIdentity(item).trim();
    } catch (error: unknown) {
      throw new Error(`Cannot compare ${label} inventory: unable to identify listing ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!identity) throw new Error(`Cannot compare ${label} inventory: listing ${index + 1} has no stable identity`);
    if (identities.has(identity)) throw new Error(`Cannot compare ${label} inventory: duplicate listing identity ${identity}`);
    identities.set(identity, item);
  });
  return identities;
}

export function diffInventories<TItem>(options: DiffInventoriesOptions<TItem>): InventoryDiff<TItem> {
  validateSnapshot(options.previous, 'previous');
  validateSnapshot(options.current, 'current');

  if (options.previous.source !== options.current.source) {
    throw new Error('Cannot compare inventories from different sources.');
  }
  if (options.previous.searchKey !== options.current.searchKey) {
    throw new Error('Cannot compare inventories from different searches.');
  }

  const previousTime = Date.parse(options.previous.collectedAt);
  const currentTime = Date.parse(options.current.collectedAt);
  if (previousTime > currentTime) {
    throw new Error('Cannot compare inventories: previous collectedAt is newer than current collectedAt.');
  }

  const previous = identityMap(options.previous, 'previous', options.getItemIdentity);
  const current = identityMap(options.current, 'current', options.getItemIdentity);
  const added: TItem[] = [];
  const retained: TItem[] = [];
  const removed: TItem[] = [];

  for (const [identity, item] of current) {
    if (previous.has(identity)) retained.push(item);
    else added.push(item);
  }
  for (const [identity, item] of previous) {
    if (!current.has(identity)) removed.push(item);
  }

  return {
    schema: 1,
    kind: 'inventory_diff',
    source: options.current.source,
    searchKey: options.current.searchKey,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    previous: {
      snapshotId: options.previous.snapshotId,
      collectedAt: options.previous.collectedAt,
      uniqueListings: options.previous.summary.uniqueListings,
    },
    current: {
      snapshotId: options.current.snapshotId,
      collectedAt: options.current.collectedAt,
      uniqueListings: options.current.summary.uniqueListings,
    },
    summary: {
      previousCount: previous.size,
      currentCount: current.size,
      added: added.length,
      retained: retained.length,
      removed: removed.length,
    },
    added,
    retained,
    removed,
    warnings: [],
  };
}
