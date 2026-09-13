import { load, type CheerioAPI } from 'cheerio';
type AnyNode = NonNullable<Parameters<CheerioAPI>[0]>;
import { isIdealistaDetailUrl } from './parser.js';
import type {
  IdealistaSearchCompleteness,
  IdealistaSearchListing,
  IdealistaSearchParseResult,
  IdealistaSearchResult,
  ParseIdealistaSearchInput,
} from './search-types.js';

const BLOCKED_MARKERS = [
  'datadome',
  'captcha-delivery',
  'has sido bloqueado',
  'uso indebido',
  'acceso se ha bloqueado',
  'verificación visual',
  'verificacion visual',
];

const ZERO_RESULT_MARKERS = /0\s+(?:anuncios?|resultados?|inmuebles?)/i;
const SEARCH_MARKERS = /(?:alquiler|venta|comprar|viviendas?|inmuebles?|habitaciones?|resultados?|anuncios?)/i;

function cleanText(value: string): string {
  return value.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(cleanText).filter(Boolean))];
}

function nodeText($: CheerioAPI, node: AnyNode): string {
  const clone = $(node).clone();
  clone.find('br').replaceWith('\n');
  return cleanText(clone.text());
}

function firstText($: CheerioAPI, container: AnyNode, selectors: string): string | null {
  let found: string | null = null;
  $(container).find(selectors).each((_, element) => {
    if (found) return;
    const text = nodeText($, element);
    if (text) found = text;
  });
  return found;
}

function parseLocalizedNumber(value: string): number | null {
  const raw = value.match(/\d[\d.\s]*(?:,\d+)?/)?.[0];
  if (!raw) return null;
  const compact = raw.replace(/[\s.]/g, '');
  const parsed = Number(compact.includes(',') ? compact.replace(',', '.') : compact);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstMatchingNumber(text: string, patterns: RegExp[]): number | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const result = parseLocalizedNumber(match[1] ?? match[0]);
      if (result !== null) return result;
    }
  }
  return null;
}

function detailId(value: string): string | null {
  return value.match(/\/inmueble\/(\d+)(?:\/|$)/i)?.[1] ?? null;
}

function absoluteDetailUrl(value: string, base: URL, id: string): string {
  try {
    const parsed = new URL(value, base);
    if (parsed.hostname.toLowerCase() === 'idealista.com' || parsed.hostname.toLowerCase() === 'www.idealista.com') {
      return `https://www.idealista.com/inmueble/${id}/`;
    }
  } catch {
    // Fall back to the canonical URL below.
  }
  return `https://www.idealista.com/inmueble/${id}/`;
}

function cardText($: CheerioAPI, card: AnyNode): string {
  return nodeText($, card);
}

function findListingCards($: CheerioAPI): AnyNode[] {
  const cards: AnyNode[] = [];
  const selectors = [
    'article.item',
    'article[class*="item"]',
    'li.item',
    '[data-testid*="listing"]',
    '[data-testid*="property"]',
    '.listing-card',
    '.item',
  ];
  for (const selector of selectors) {
    $(selector).each((_, element) => {
      if ($(element).find('a[href*="/inmueble/"]').length > 0) cards.push(element);
    });
    if (cards.length > 0) break;
  }

  if (cards.length > 0) return cards;

  // Conservative fallback: use the nearest article/list item around detail links,
  // rather than treating every detail URL anywhere in the document as a result.
  $('a[href*="/inmueble/"]').each((_, anchor) => {
    const container = $(anchor).closest('article, li').get(0);
    if (container && $(container).find('a[href*="/inmueble/"]').length > 0) cards.push(container);
  });
  return cards;
}

function parseTags($: CheerioAPI, card: AnyNode): string[] {
  return unique($(card).find('.item-tags li, .item-tags span, .item-tag, .tag, [data-tag], [class~="badge"]')
    .map((_, element) => nodeText($, element)).get().filter((text) => text.length <= 80));
}

function parsePhotoCount($: CheerioAPI, card: AnyNode, text: string): number | null {
  const attribute = $(card).find('[data-photo-count], [data-images-count]').first();
  const attributeValue = attribute.attr('data-photo-count') ?? attribute.attr('data-images-count');
  if (attributeValue && /^\d+$/.test(attributeValue)) return Number(attributeValue);
  const counter = firstText($, card, '.item-multimedia-pictures__counter, [class*="photo-count"]');
  const counterMatch = counter?.match(/\/\s*(\d+)/);
  if (counterMatch) return Number(counterMatch[1]);
  return firstMatchingNumber(text, [/([\d.]+)\s*(?:fotos?|photos?)/i]);
}

function parseSearchCard($: CheerioAPI, card: AnyNode, pageUrl: URL, position: number): IdealistaSearchListing | null {
  const link = $(card).find('a[href*="/inmueble/"]').filter((_, element) => Boolean(detailId($(element).attr('href') ?? ''))).first();
  const href = link.attr('href');
  const id = detailId(href ?? '');
  if (!id) return null;
  const url = absoluteDetailUrl(href ?? '', pageUrl, id);
  const text = cardText($, card);
  const title = firstText($, card, '.item-title, .item-link, h2, h3, [class*="title"]') ?? (cleanText(link.text()) || null);
  const priceText = firstText($, card, '.item-price, [class*="price"]') ?? text;
  const featureValues = unique($(card).find('.item-detail, .item-features, [class*="feature"]')
    .map((_, element) => nodeText($, element)).get());
  if (featureValues.length === 0) {
    const detailContainer = firstText($, card, '.item-detail-char');
    if (detailContainer) featureValues.push(detailContainer);
  }
  const featureText = featureValues.join(' ') || text;
  const locationText = firstText($, card, '.item-location')
    ?? title?.match(/\s+en\s+(.+)$/i)?.[1]?.trim()
    ?? null;
  const descriptionExcerpt = firstText($, card, '.item-description, [class*="description"]');
  return {
    idealistaId: id,
    url,
    title,
    priceEurMonth: firstMatchingNumber(priceText, [/([\d][\d.\s]*(?:,\d+)?)\s*€(?:\s*\/\s*mes)?/i]),
    bedrooms: firstMatchingNumber(featureText, [/([\d][\d.\s]*)\s*(?:hab\.?|habitaciones?)/i]),
    bathrooms: firstMatchingNumber(featureText, [/([\d][\d.\s]*)\s*baños?/i]),
    sizeM2: firstMatchingNumber(featureText, [/([\d][\d.\s]*(?:,\d+)?)\s*m(?:²|2)/i]),
    floorText: firstText($, card, '[class*="floor"]')
      ?? featureValues.flatMap((value) => value.split(/[·|]/)).find((value) => /planta/i.test(value))?.trim()
      ?? featureText.match(/[^\n,;·]*planta[^\n,;·]*/i)?.[0]?.trim()
      ?? null,
    locationText,
    descriptionExcerpt,
    tags: parseTags($, card),
    photoCount: parsePhotoCount($, card, text),
    position,
  };
}

function parseListings($: CheerioAPI, pageUrl: URL): IdealistaSearchListing[] {
  const seen = new Set<string>();
  const listings: IdealistaSearchListing[] = [];
  for (const card of findListingCards($)) {
    const parsed = parseSearchCard($, card, pageUrl, listings.length + 1);
    if (!parsed || seen.has(parsed.idealistaId)) continue;
    seen.add(parsed.idealistaId);
    parsed.position = listings.length + 1;
    listings.push(parsed);
  }
  return listings;
}

function searchTextCandidates($: CheerioAPI): string[] {
  return unique($('h1, h2, [class*="result"], [class*="summary"], [class*="search-title"]')
    .map((_, element) => nodeText($, element)).get());
}

function parseSummary($: CheerioAPI, pageUrl: URL): IdealistaSearchResult['summary'] {
  const candidates = searchTextCandidates($);
  const resultPattern = /([\d.\s]+)\s+(?:anuncios?|resultados?|inmuebles?|casas\s+y\s+pisos)/i;
  const summaryText = candidates.find((text) => resultPattern.test(text)) ?? candidates[0] ?? '';
  const resultCount = summaryText.match(resultPattern)?.[1];
  const pageFromUrl = pageUrl.pathname.match(/pagina-(\d+)\.htm/i)?.[1]
    ?? pageUrl.searchParams.get('pagina')
    ?? pageUrl.searchParams.get('page');
  const paginationText = $('.pagination, nav[aria-label*="pagin" i], [class*="pagination"]').map((_, element) => nodeText($, element)).get().join(' ');
  const currentText = paginationText.match(/(?:página|pagina|page)\s*(\d+)(?:\s+de\s+\d+)?/i)?.[1]
    ?? $('.pagination .active, .pagination [aria-current="page"]').first().text().match(/\d+/)?.[0];
  const totalText = paginationText.match(/(?:de|of)\s+(\d+)\b/i)?.[1];
  const lastPageElement = $('.pagination a[rel="last"], .pagination a[aria-label*="última" i], .pagination a[aria-label*="ultima" i], .pagination a[title*="última" i], .pagination a[title*="ultima" i], .pagination .last a, [class*="pagination-last"] a').first();
  let explicitLastPage: number | null = null;
  if (lastPageElement.length > 0) {
    const hrefPage = lastPageElement.attr('href')?.match(/pagina-(\d+)\.htm/i)?.[1];
    const textPage = nodeText($, lastPageElement).match(/\b\d+\b/)?.[0];
    explicitLastPage = hrefPage ? Number(hrefPage) : textPage ? Number(textPage) : null;
  }
  return {
    resultCount: resultCount ? parseLocalizedNumber(resultCount) : null,
    currentPage: pageFromUrl ? Number(pageFromUrl) : currentText ? Number(currentText) : null,
    totalPages: totalText ? Number(totalText) : explicitLastPage,
  };
}

function paginationUrl($: CheerioAPI, pageUrl: URL, relation: 'next' | 'previous'): string | null {
  const selectors = relation === 'next'
    ? ['a[rel="next"]', '.pagination-next a', 'a[aria-label*="siguiente" i]', 'a[aria-label*="next" i]', '.pagination a.icon-arrow-right-after', '.pagination a']
    : ['a[rel="prev"]', 'a[rel="previous"]', '.pagination-prev a', 'a[aria-label*="anterior" i]', 'a[aria-label*="previous" i]', '.pagination a.icon-arrow-left-after', '.pagination a'];
  for (const selector of selectors) {
    const element = $(selector).filter((_, item) => {
      if ($(item).is(':disabled') || $(item).closest('.disabled').length) return false;
      if (selector === '.pagination a') return relation === 'next'
        ? /siguiente|next/i.test(nodeText($, item))
        : /anterior|previous/i.test(nodeText($, item));
      return true;
    }).first();
    const href = element.attr('href');
    if (href) {
      try {
        return new URL(href, pageUrl).toString();
      } catch {
        return null;
      }
    }
  }
  return null;
}

function evaluateCompleteness($: CheerioAPI, html: string, listings: IdealistaSearchListing[], summary: IdealistaSearchResult['summary']): IdealistaSearchCompleteness {
  const body = $('body').get(0) ?? $.root().get(0);
  const source = `${html}\n${body ? nodeText($, body) : ''}`.toLowerCase();
  const blocked = BLOCKED_MARKERS.some((marker) => source.includes(marker));
  const searchPageRecognized = SEARCH_MARKERS.test(source);
  const explicitZero = summary.resultCount === 0 || ZERO_RESULT_MARKERS.test(source);
  const listingCardsFound = listings.length > 0 || explicitZero;
  const listingIdsResolved = listings.length > 0 && listings.every((listing) => /^\d+$/.test(listing.idealistaId));
  const rejectionReasons: string[] = [];
  if (!searchPageRecognized) rejectionReasons.push('search_page_not_recognized');
  if (!listingCardsFound) rejectionReasons.push('listing_cards_not_found');
  if (listings.length > 0 && !listingIdsResolved) rejectionReasons.push('listing_ids_unresolved');
  if (blocked) rejectionReasons.push('challenge_or_blocked');
  return {
    accepted: !blocked && searchPageRecognized && listingCardsFound && (explicitZero || listingIdsResolved),
    searchPageRecognized,
    listingCardsFound,
    listingIdsResolved,
    blocked,
    rejectionReasons,
  };
}

export function isIdealistaSearchUrl(value: string | URL): boolean {
  let url: URL;
  try {
    url = typeof value === 'string' ? new URL(value) : value;
  } catch {
    return false;
  }
  if (url.hostname.toLowerCase() !== 'idealista.com' && url.hostname.toLowerCase() !== 'www.idealista.com') return false;
  if (isIdealistaDetailUrl(url)) return false;
  if (url.pathname === '/' || url.pathname === '') return false;
  return /(?:^|\/)(?:alquiler|venta|comprar|viviendas?|inmuebles?|habitaciones?|obra-nueva|buscador|search|busquedas?|guardados?)(?:[-/]|$)/i.test(url.pathname)
    || /pagina-\d+\.htm$/i.test(url.pathname)
    || [...url.searchParams.keys()].some((key) => /pagina|page|orden|precio|habitaciones|dormitorios/i.test(key));
}

export function parseIdealistaSearch(input: ParseIdealistaSearchInput): IdealistaSearchParseResult {
  if (!isIdealistaSearchUrl(input.url)) {
    return {
      pageType: 'unsupported',
      search: null,
      completeness: null,
      errors: ['Unsupported Idealista URL: search page expected'],
    };
  }
  const pageUrl = typeof input.url === 'string' ? new URL(input.url) : input.url;
  const $ = load(input.html);
  const listings = parseListings($, pageUrl);
  const summary = parseSummary($, pageUrl);
  const search: IdealistaSearchResult = {
    schema: 1,
    source: 'idealista',
    url: pageUrl.toString(),
    pageType: 'search',
    summary,
    listings,
    pagination: {
      nextUrl: paginationUrl($, pageUrl, 'next'),
      previousUrl: paginationUrl($, pageUrl, 'previous'),
    },
    warnings: [],
    provenance: {
      method: ['search-card-dom', 'pagination-dom', 'textual-semantic-fallback'],
      rawHtmlRetainedForDebugOnly: true,
    },
  };
  const completeness = evaluateCompleteness($, input.html, listings, summary);
  if (!completeness.accepted) search.warnings.push(...completeness.rejectionReasons);
  return { pageType: 'search', search, completeness, errors: [] };
}

export type {
  IdealistaSearchCompleteness,
  IdealistaSearchListing,
  IdealistaSearchParseResult,
  IdealistaSearchResult,
  ParseIdealistaSearchInput,
} from './search-types.js';
