import { load, type CheerioAPI } from 'cheerio';
import { normalizeUrl } from '../../core/identity.js';
import { cleanText, parseLocalizedNumber, sameSite } from '../text.js';
import type {
  GuinotSearchCompleteness,
  GuinotSearchListing,
  GuinotSearchParseResult,
  GuinotSearchResult,
  ParseGuinotSearchInput,
} from './search-types.js';

type AnyNode = ReturnType<CheerioAPI>;

const BLOCKED_MARKERS = [
  'residential failed',
  'bad_endpoint',
  'just a moment',
  'cf-challenge',
  'challenge-platform',
  'captcha-delivery',
  'datadome',
];

function pageUrlOf(value: string | URL): URL {
  return typeof value === 'string' ? new URL(value) : value;
}

function cellText($: CheerioAPI, row: AnyNode, name: string): string {
  return cleanText(row.find(`[data-info="${name}"]`).first().text());
}

function absoluteUrl(href: string | undefined, pageUrl: URL): string | null {
  if (!href) return null;
  try {
    return new URL(href, pageUrl).toString();
  } catch {
    return null;
  }
}

function nextPageUrl($: CheerioAPI, pageUrl: URL): string | null {
  const href = $('link[rel="next"]').attr('href') ?? $('a[rel="next"]').attr('href');
  if (!href) return null;
  try {
    const next = normalizeUrl(new URL(href, pageUrl));
    return next === normalizeUrl(pageUrl) ? null : next;
  } catch {
    return null;
  }
}

function parseRow($: CheerioAPI, row: AnyNode, pageUrl: URL, position: number): GuinotSearchListing | null {
  const listingId = cellText($, row, 'idInmueble');
  if (!/^\d+$/.test(listingId)) return null;
  const rentText = cellText($, row, 'precioAlquiler');
  const location = [cellText($, row, 'localizacion'), cellText($, row, 'zona')].filter(Boolean).join(', ');
  const bedrooms = cellText($, row, 'dormitorios');
  const bathrooms = cellText($, row, 'banos');
  const size = cellText($, row, 'superficie');
  return {
    listingId,
    reference: cellText($, row, 'referencia') || null,
    url: absoluteUrl(row.find('a[href*="/ref-"]').first().attr('href'), pageUrl),
    title: cellText($, row, 'tituloInmueble') || null,
    priceEurMonth: rentText ? parseLocalizedNumber(rentText) : null,
    bedrooms: bedrooms ? parseLocalizedNumber(bedrooms) : null,
    bathrooms: bathrooms ? parseLocalizedNumber(bathrooms) : null,
    sizeM2: size ? parseLocalizedNumber(size) : null,
    locationText: location || null,
    descriptionExcerpt: cellText($, row, 'resumen') || null,
    position,
  };
}

export function isGuinotPruneraSearchUrl(value: string | URL): boolean {
  let url: URL;
  try {
    url = pageUrlOf(value);
  } catch {
    return false;
  }
  if (!sameSite(url, 'guinotprunera.com')) return false;
  const path = url.pathname.toLowerCase();
  return /\/alquiler(?:\/|$)/.test(path) && !/\/ref-\d+\/?$/.test(path);
}

export function parseGuinotPruneraSearch(input: ParseGuinotSearchInput): GuinotSearchParseResult {
  if (!isGuinotPruneraSearchUrl(input.url)) {
    return {
      pageType: 'unsupported',
      search: null,
      completeness: null,
      errors: ['Unsupported GuinotPrunera URL: search page expected'],
    };
  }
  const pageUrl = pageUrlOf(input.url);
  const $ = load(input.html);
  const source = input.html.toLowerCase();
  const blocked = BLOCKED_MARKERS.some((marker) => source.includes(marker));
  const seen = new Set<string>();
  const listings: GuinotSearchListing[] = [];
  let unresolvedRows = 0;
  $('#infoListado tbody tr').each((_, element) => {
    const row = $(element);
    if (row.find('[data-info]').length === 0) return;
    const parsed = parseRow($, row, pageUrl, listings.length + 1);
    if (!parsed) {
      unresolvedRows += 1;
      return;
    }
    if (seen.has(parsed.listingId)) return;
    seen.add(parsed.listingId);
    parsed.position = listings.length + 1;
    listings.push(parsed);
  });
  const countMatch = source.match(/(\d+)\s+encontrados?/);
  const resultCount = countMatch ? Number(countMatch[1]) : null;
  const explicitZeroResults = resultCount === 0 || /no se han encontrado inmuebles/.test(source);
  const searchPageRecognized = $('#infoListado').length > 0 || explicitZeroResults;
  const countMismatch = resultCount !== null && resultCount !== listings.length + unresolvedRows;
  const listingCardsFound = listings.length > 0 || (explicitZeroResults && unresolvedRows === 0);
  const listingIdsResolved = unresolvedRows === 0 && listings.every((listing) => /^\d+$/.test(listing.listingId));
  const rejectionReasons: string[] = [];
  if (blocked) rejectionReasons.push('challenge_or_blocked');
  if (!searchPageRecognized) rejectionReasons.push('search_page_not_recognized');
  if (countMismatch) rejectionReasons.push('listing_count_mismatch');
  if (!listingCardsFound) rejectionReasons.push('listing_cards_not_found');
  if (unresolvedRows > 0) rejectionReasons.push('listing_ids_unresolved');
  const completeness: GuinotSearchCompleteness = {
    accepted: rejectionReasons.length === 0,
    searchPageRecognized,
    listingCardsFound,
    listingIdsResolved,
    explicitZeroResults: explicitZeroResults && unresolvedRows === 0 && listings.length === 0,
    blocked,
    rejectionReasons,
  };
  const search: GuinotSearchResult = {
    schema: 1,
    source: 'guinotprunera',
    url: pageUrl.toString(),
    pageType: 'search',
    summary: { resultCount },
    listings,
    // ponytail: the visible pager is client-side DataTables; follow a next link only when the HTML has one.
    pagination: { nextUrl: completeness.accepted && !blocked ? nextPageUrl($, pageUrl) : null },
    warnings: completeness.accepted ? [] : rejectionReasons,
  };
  return { pageType: 'search', search, completeness, errors: [] };
}
