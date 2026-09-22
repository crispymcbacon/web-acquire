import { load, type CheerioAPI } from 'cheerio';
import { normalizeUrl } from '../../core/identity.js';
import { cleanText, firstNumber, parseLocalizedNumber, sameSite } from '../text.js';
import type {
  LocaContractType,
  LocaSearchCompleteness,
  LocaSearchListing,
  LocaSearchParseResult,
  LocaSearchResult,
  ParseLocaSearchInput,
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

function elementText($: CheerioAPI, node: AnyNode): string {
  const clone = node.clone();
  clone.find('style, script, form, .rh_list_card__contactform').remove();
  return cleanText(clone.text());
}

function contractType(pageUrl: URL): LocaContractType | null {
  const blob = `${pageUrl.pathname} ${pageUrl.searchParams.get('status') ?? ''}`.toLowerCase();
  if (blob.includes('long-term')) return 'long-term';
  if (blob.includes('short-term')) return 'short-term';
  return null;
}

function propertyUrl($: CheerioAPI, card: AnyNode, pageUrl: URL): string | null {
  const href = card.find('a[href*="/property/"]').toArray()
    .map((anchor) => $(anchor).attr('href') ?? '')
    .find((value) => /\/property\/[^/]+/i.test(value) && !/property-status|property-search/i.test(value));
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
    // ponytail: a next link to the current URL ends the crawl. Live /page/2/ points at itself.
    if (next === normalizeUrl(pageUrl)) return null;
    return next;
  } catch {
    return null;
  }
}

function parseCard($: CheerioAPI, card: AnyNode, pageUrl: URL, position: number): LocaSearchListing | null {
  const listingId = card.attr('data-propertyid')?.trim() ?? '';
  if (!/^\d+$/.test(listingId)) return null;
  const facts = card.find('span.figure').toArray()
    .map((element) => elementText($, $(element)))
    .filter((text) => /m(?:²|2)|bed|bath|hab|baño|bano|dorm/i.test(text))
    .join('\n');
  const reference = elementText($, card.find('.rh_list_card__propdertyid')).match(/property id\s+(\S+)/i)?.[1] ?? null;
  return {
    listingId,
    reference,
    url: propertyUrl($, card, pageUrl),
    title: elementText($, card.find('.rh_list_card__title')) || null,
    priceEurMonth: parseLocalizedNumber(elementText($, card.find('.rh_list_card__price'))),
    bedrooms: firstNumber(facts, [/(\d+)\s*(?:bedrooms?|habitaciones?|dormitorios?)/i]),
    bathrooms: firstNumber(facts, [/(\d+)\s*(?:bathrooms?|baños?|banos?)/i]),
    sizeM2: firstNumber(facts, [/(\d[\d.]*)\s*m(?:²|2)/i]),
    locationText: elementText($, card.find('.rh_list_card__city')) || null,
    descriptionExcerpt: null,
    contractType: contractType(pageUrl),
    position,
  };
}

function parseListings($: CheerioAPI, pageUrl: URL): { listings: LocaSearchListing[]; unresolvedCards: number } {
  const seen = new Set<string>();
  const listings: LocaSearchListing[] = [];
  let unresolvedCards = 0;
  $('.rh_list_card').each((_, element) => {
    const card = $(element);
    const parsed = parseCard($, card, pageUrl, listings.length + 1);
    if (!parsed) {
      unresolvedCards += 1;
      return;
    }
    if (seen.has(parsed.listingId)) return;
    seen.add(parsed.listingId);
    parsed.position = listings.length + 1;
    listings.push(parsed);
  });
  return { listings, unresolvedCards };
}

export function isLocaBarcelonaSearchUrl(value: string | URL): boolean {
  let url: URL;
  try {
    url = pageUrlOf(value);
  } catch {
    return false;
  }
  if (!sameSite(url, 'locabarcelona.com')) return false;
  const path = url.pathname.toLowerCase();
  return /\/property-status(?:\/|$)/.test(path) || /\/property-search(?:\/|$)/.test(path);
}

export function parseLocaBarcelonaSearch(input: ParseLocaSearchInput): LocaSearchParseResult {
  if (!isLocaBarcelonaSearchUrl(input.url)) {
    return {
      pageType: 'unsupported',
      search: null,
      completeness: null,
      errors: ['Unsupported LOCA Barcelona URL: search page expected'],
    };
  }
  const pageUrl = pageUrlOf(input.url);
  const $ = load(input.html);
  const source = input.html.toLowerCase();
  const blocked = BLOCKED_MARKERS.some((marker) => source.includes(marker));
  const { listings, unresolvedCards } = parseListings($, pageUrl);
  const countText = cleanText($('#results_num_real').text());
  const resultCount = parseLocalizedNumber(countText.match(/(\d[\d.]*)\s+results/i)?.[1] ?? '');
  const explicitZeroResults = listings.length === 0 && (
    resultCount === 0
    || /no results found|no propert(?:y|ies) found/i.test(source)
  );
  const searchPageRecognized = $('.rh_page__listing, .rh_list_card').length > 0 || explicitZeroResults;
  const listingCardsFound = listings.length > 0 || explicitZeroResults;
  const listingIdsResolved = unresolvedCards === 0 && listings.every((listing) => /^\d+$/.test(listing.listingId));
  const rejectionReasons: string[] = [];
  if (blocked) rejectionReasons.push('challenge_or_blocked');
  if (!searchPageRecognized) rejectionReasons.push('search_page_not_recognized');
  if (!listingCardsFound) rejectionReasons.push('listing_cards_not_found');
  if (unresolvedCards > 0) rejectionReasons.push('listing_ids_unresolved');
  const completeness: LocaSearchCompleteness = {
    accepted: !blocked && searchPageRecognized && listingCardsFound && listingIdsResolved && (explicitZeroResults || listings.length > 0),
    searchPageRecognized,
    listingCardsFound,
    listingIdsResolved,
    explicitZeroResults,
    blocked,
    rejectionReasons,
  };
  const search: LocaSearchResult = {
    schema: 1,
    source: 'locabarcelona',
    url: pageUrl.toString(),
    pageType: 'search',
    summary: { resultCount },
    listings,
    pagination: { nextUrl: blocked ? null : nextPageUrl($, pageUrl) },
    warnings: completeness.accepted ? [] : rejectionReasons,
  };
  return { pageType: 'search', search, completeness, errors: [] };
}
