import { load, type CheerioAPI } from 'cheerio';
import { normalizeUrl } from '../../core/identity.js';
import { cleanText, sameSite } from '../text.js';
import type {
  ParseShSearchInput,
  ShContractType,
  ShSearchCompleteness,
  ShSearchListing,
  ShSearchParseResult,
  ShSearchResult,
} from './search-types.js';

interface ShProperty {
  id?: number | string;
  reference?: string;
  surface?: number | null;
  situation?: string | null;
  price?: number | null;
  department_name?: string | null;
  city?: { description?: string | null } | null;
  zone?: { description?: string | null } | null;
  favourite_characteristics?: { description?: string; value?: number | null }[] | null;
  texts?: { title?: string | null; description?: string | null }[] | null;
  property_departments?: { reference?: string | null }[] | null;
}

interface ShPayload {
  pageSize?: number;
  pageNumber?: number;
  totalPages?: number;
  totalElements?: number;
  data?: ShProperty[];
}

const BLOCKED_MARKERS = [
  'residential failed',
  'bad_endpoint',
  'just a moment',
  'cf-challenge',
  'challenge-platform',
  'captcha-delivery',
  'datadome',
];
const SKIPPED_QUERY_KEYS = new Set(['__rew', 'from', 'to']);

function pageUrlOf(value: string | URL): URL {
  return typeof value === 'string' ? new URL(value) : value;
}

function characteristic(property: ShProperty, name: string): number | null {
  const value = property.favourite_characteristics?.find((item) => item.description === name)?.value;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function contractType(name: string | null | undefined): ShContractType | null {
  if (name === 'yearly') return 'long-term';
  if (name === 'short-term') return 'short-term';
  return null;
}

function slugify(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function excerpt(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const $ = load(`<div>${value}</div>`);
  const text = cleanText($('p').first().text() || $.root().text());
  return text || null;
}

function listingUrl($: CheerioAPI | null, property: ShProperty, id: string, pageUrl: URL): string | null {
  const fromDom = $?.(`a[href*="--${id}"]`).first().attr('href');
  if (fromDom) {
    try {
      return new URL(fromDom, pageUrl).toString();
    } catch {
      return null;
    }
  }
  const slug = slugify(property.situation?.trim() || property.texts?.find((text) => text.title?.trim())?.title?.trim() || '');
  const path = slug ? `/l/${slug}--${id}` : `/l/${id}`;
  return new URL(path, 'https://www.shbarcelona.com').toString();
}

function parseProperty($: CheerioAPI | null, property: ShProperty, pageUrl: URL, position: number): ShProperty & { listing: ShSearchListing | null } {
  const id = property.id;
  const listingId = typeof id === 'number' || (typeof id === 'string' && /^\d+$/.test(id)) ? String(id) : '';
  if (!listingId) return { ...property, listing: null };
  const title = cleanText(property.texts?.find((text) => text.title?.trim())?.title ?? '') || cleanText(property.situation ?? '') || null;
  const location = [property.zone?.description, property.city?.description].map((part) => cleanText(part ?? '')).filter(Boolean).join(', ');
  const reference = property.property_departments?.find((item) => item.reference?.trim())?.reference?.trim()
    ?? property.reference?.trim()
    ?? null;
  return {
    ...property,
    listing: {
      listingId,
      reference,
      url: listingUrl($, property, listingId, pageUrl),
      title,
      priceEurMonth: typeof property.price === 'number' && Number.isFinite(property.price) ? property.price : null,
      bedrooms: characteristic(property, 'bedrooms'),
      bathrooms: characteristic(property, 'bathrooms'),
      sizeM2: typeof property.surface === 'number' && Number.isFinite(property.surface) ? property.surface : null,
      locationText: location || null,
      descriptionExcerpt: excerpt(property.texts?.find((text) => text.description?.trim())?.description),
      contractType: contractType(property.department_name),
      position,
    },
  };
}

function provinceFor(hostname: string): string | null {
  const host = hostname.toLowerCase();
  if (host.includes('shbarcelona')) return '8';
  if (host.includes('shmadrid')) return '28';
  return null;
}

function nextPropertiesUrl(pageUrl: URL, payload: ShPayload, query: Record<string, unknown>): string | null {
  const pageNumber = payload.pageNumber ?? Number(pageUrl.searchParams.get('pageNumber') ?? 1);
  const totalPages = payload.totalPages ?? 0;
  if (!(totalPages > pageNumber)) return null;
  const onApi = /\/property\/properties\/?$/i.test(pageUrl.pathname);
  const params = new URLSearchParams(onApi ? pageUrl.searchParams : undefined);
  const entries = Object.entries(query).filter(([key, value]) => !SKIPPED_QUERY_KEYS.has(key) && (typeof value === 'string' || typeof value === 'number'));
  for (const [key, value] of entries.sort(([left], [right]) => left.localeCompare(right))) {
    params.set(key, String(value));
  }
  params.set('pageNumber', String(pageNumber + 1));
  params.set('pageSize', String(payload.pageSize ?? params.get('pageSize') ?? 25));
  if (!params.has('province')) {
    const province = provinceFor(pageUrl.hostname);
    if (province) params.set('province', province);
  }
  const next = new URL('/api/proxy/Property/properties', pageUrl.origin);
  next.search = params.toString();
  try {
    const normalized = normalizeUrl(next);
    // ponytail: load-more does not change the HTML URL; page 2+ is this JSON endpoint.
    return normalized === normalizeUrl(pageUrl) ? null : normalized;
  } catch {
    return null;
  }
}

function readPayload(html: string, $: CheerioAPI): { payload: ShPayload | null; query: Record<string, unknown> } {
  const trimmed = html.trim().replace(/^\uFEFF/, '');
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as ShPayload;
      if (Array.isArray(parsed.data) && typeof parsed.totalElements === 'number') {
        return { payload: parsed, query: {} };
      }
    } catch {
      return { payload: null, query: {} };
    }
  }
  const raw = $('#__NEXT_DATA__').text();
  if (!raw) return { payload: null, query: {} };
  try {
    const parsed = JSON.parse(raw) as { props?: { pageProps?: { initialProperties?: ShPayload; department?: string } }; query?: Record<string, unknown> };
    const payload = parsed.props?.pageProps?.initialProperties ?? null;
    const query = { ...(parsed.query ?? {}) };
    if (typeof query.department !== 'string' && parsed.props?.pageProps?.department) {
      query.department = parsed.props.pageProps.department;
    }
    return { payload, query };
  } catch {
    return { payload: null, query: {} };
  }
}

export function isShBarcelonaSearchUrl(value: string | URL): boolean {
  let url: URL;
  try {
    url = pageUrlOf(value);
  } catch {
    return false;
  }
  if (!sameSite(url, 'shbarcelona.com')) return false;
  const path = url.pathname.toLowerCase();
  if (/^\/l(?:\/|$)/.test(path)) return false;
  return /\/apartments-for-rent(?:\/|$)/.test(path) || /\/api\/proxy\/property\/properties\/?$/.test(path);
}

export function parseShBarcelonaSearch(input: ParseShSearchInput): ShSearchParseResult {
  if (!isShBarcelonaSearchUrl(input.url)) {
    return {
      pageType: 'unsupported',
      search: null,
      completeness: null,
      errors: ['Unsupported ShBarcelona URL: search page expected'],
    };
  }
  const pageUrl = pageUrlOf(input.url);
  const $ = load(input.html);
  const source = input.html.toLowerCase();
  const blocked = BLOCKED_MARKERS.some((marker) => source.includes(marker));
  const { payload, query } = readPayload(input.html, $);
  const properties = payload?.data ?? [];
  const seen = new Set<string>();
  const listings: ShSearchListing[] = [];
  let unresolved = 0;
  for (const property of properties) {
    const parsed = parseProperty(input.html.trim().startsWith('<') ? $ : null, property, pageUrl, listings.length + 1);
    if (!parsed.listing) {
      unresolved += 1;
      continue;
    }
    if (seen.has(parsed.listing.listingId)) continue;
    seen.add(parsed.listing.listingId);
    parsed.listing.position = listings.length + 1;
    listings.push(parsed.listing);
  }
  const explicitZeroResults = payload?.totalElements === 0 && properties.length === 0;
  const searchPageRecognized = payload !== null && Array.isArray(payload.data) && typeof payload.totalElements === 'number';
  const countMismatch = searchPageRecognized
    && (payload?.totalPages ?? 0) <= 1
    && payload?.totalElements !== properties.length;
  const listingCardsFound = listings.length > 0 || explicitZeroResults;
  const listingIdsResolved = unresolved === 0 && listings.every((listing) => /^\d+$/.test(listing.listingId));
  const rejectionReasons: string[] = [];
  if (blocked) rejectionReasons.push('challenge_or_blocked');
  if (!searchPageRecognized) rejectionReasons.push('search_page_not_recognized');
  if (countMismatch) rejectionReasons.push('listing_count_mismatch');
  if (!listingCardsFound) rejectionReasons.push('listing_cards_not_found');
  if (unresolved > 0) rejectionReasons.push('listing_ids_unresolved');
  const nextUrl = !blocked && payload && !countMismatch ? nextPropertiesUrl(pageUrl, payload, query) : null;
  if (!blocked && payload && (payload.totalPages ?? 0) > (payload.pageNumber ?? 1) && !nextUrl) {
    rejectionReasons.push('pagination_unresolved');
  }
  const completeness: ShSearchCompleteness = {
    accepted: rejectionReasons.length === 0 && (explicitZeroResults || listings.length > 0),
    searchPageRecognized,
    listingCardsFound,
    listingIdsResolved,
    explicitZeroResults,
    blocked,
    rejectionReasons,
  };
  const search: ShSearchResult = {
    schema: 1,
    source: 'shbarcelona',
    url: pageUrl.toString(),
    pageType: 'search',
    summary: {
      resultCount: payload?.totalElements ?? null,
      currentPage: payload?.pageNumber ?? null,
      totalPages: payload?.totalPages ?? null,
    },
    listings,
    pagination: { nextUrl: completeness.accepted ? nextUrl : null },
    warnings: completeness.accepted ? [] : rejectionReasons,
  };
  return { pageType: 'search', search, completeness, errors: [] };
}
