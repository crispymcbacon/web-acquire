import { load, type CheerioAPI } from 'cheerio';
type AnyNode = NonNullable<Parameters<CheerioAPI>[0]>;
import type {
  IdealistaAdvertiser,
  IdealistaCompleteness,
  IdealistaFacts,
  IdealistaListing,
  IdealistaParseResult,
  IdealistaTextEvidence,
  ParseIdealistaDetailInput,
} from './types.js';

interface JsonObject {
  [key: string]: unknown;
}

const EVIDENCE_PATTERNS: Record<keyof IdealistaTextEvidence, RegExp> = {
  lease_contract: /contrato temporal|contrato de temporada|alquiler de temporada|larga duración|vivienda habitual/i,
  deposit_guarantees: /fianza|depósito|deposito|garantía/i,
  income_documents: /documentación|nóminas|nominas|ingresos|contrato de trabajo|solvencia/i,
  fees_costs: /gastos|honorarios|comunidad|suministros|comisión|comision/i,
  occupancy_restrictions: /máximo\s+\d+\s+personas|maximo\s+\d+\s+personas|no se admiten|estudiantes|niños|ninos|mascotas/i,
  availability: /disponible|a partir de|entrada/i,
  transport_location: /metro|tren|autobús|autobus|\bbus\b|cerca de|\b\d+\s+minutos/i,
};

const BLOCKED_MARKERS = [
  'datadome',
  'captcha-delivery',
  'has sido bloqueado',
  'uso indebido',
  'acceso se ha bloqueado',
  'verificación visual',
  'verificacion visual',
];

const DELETED_MARKERS = [
  'este anuncio ya no está disponible',
  'este anuncio ya no esta disponible',
  'el anuncio ya no está disponible',
  'el anuncio ya no esta disponible',
  'anuncio no disponible',
  'ya no está publicado',
  'ya no esta publicado',
  'anuncio eliminado',
  'ha sido eliminado',
];

const GROUP_NAMES = new Set([
  'características básicas',
  'caracteristicas basicas',
  'edificio',
  'equipamiento',
  'precio',
  'ubicación',
  'ubicacion',
  'distribución',
  'distribucion',
]);

function cleanText(value: string): string {
  return value.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(cleanText).filter(Boolean))];
}

function nodeText($: CheerioAPI, node: AnyNode): string {
  const clone = $(node).clone();
  clone.find('br').replaceWith('\n');
  const paragraphs = clone.find('p').map((_, element) => cleanText($(element).text())).get();
  if (paragraphs.length > 0) return unique(paragraphs).join('\n\n');
  return cleanText(clone.text());
}

function firstText($: CheerioAPI, selectors: string): string | null {
  let found: string | null = null;
  $(selectors).each((_, element) => {
    if (found) return;
    const text = nodeText($, element);
    if (text) found = text;
  });
  return found;
}

function parseJsonLd($: CheerioAPI): JsonObject[] {
  const records: JsonObject[] = [];
  $('script[type="application/ld+json"]').each((_, element) => {
    try {
      const parsed: unknown = JSON.parse($(element).text());
      const values = Array.isArray(parsed) ? parsed : [parsed];
      for (const value of values) {
        if (value && typeof value === 'object') records.push(value as JsonObject);
      }
    } catch {
      // A malformed JSON-LD block should not prevent HTML parsing.
    }
  });
  return records;
}

function objectType(record: JsonObject): string {
  const type = record['@type'];
  return Array.isArray(type) ? type.join(' ').toLowerCase() : String(type ?? '').toLowerCase();
}

function structuredRecords(records: JsonObject[]): JsonObject[] {
  return [...records].sort((left, right) => {
    const preferred = (record: JsonObject) => /listing|product|apartment|house|offer|realestate/i.test(objectType(record));
    return Number(preferred(right)) - Number(preferred(left));
  });
}

function valueText(value: unknown): string | null {
  if (typeof value === 'string' || typeof value === 'number') return cleanText(String(value)) || null;
  if (Array.isArray(value)) return value.map(valueText).filter((item): item is string => Boolean(item)).join(', ') || null;
  if (value && typeof value === 'object') {
    const object = value as JsonObject;
    return valueText(object.name) ?? valueText(object.value) ?? valueText(object.text);
  }
  return null;
}

function findNested(record: unknown, key: string): unknown {
  if (!record || typeof record !== 'object') return undefined;
  if (Array.isArray(record)) {
    for (const item of record) {
      const found = findNested(item, key);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const object = record as JsonObject;
  if (key in object) return object[key];
  for (const value of Object.values(object)) {
    const found = findNested(value, key);
    if (found !== undefined) return found;
  }
  return undefined;
}

function structuredValue(records: JsonObject[], keys: string[]): string | null {
  for (const record of structuredRecords(records)) {
    for (const key of keys) {
      const value = valueText(findNested(record, key));
      if (value) return value;
    }
  }
  return null;
}

function idFromUrl(value: string): string | null {
  const match = value.match(/\/inmueble\/(\d+)(?:\/|$)/i);
  return match?.[1] ?? null;
}

function documentId($: CheerioAPI, records: JsonObject[]): string | null {
  for (const record of structuredRecords(records)) {
    const candidate = findNested(record, 'url') ?? findNested(record, '@id');
    const id = idFromUrl(String(candidate ?? ''));
    if (id) return id;
    const identifier = valueText(findNested(record, 'identifier'));
    if (identifier && /^\d+$/.test(identifier)) return identifier;
  }

  const canonical = $('link[rel="canonical"], meta[property="og:url"]').first();
  const canonicalValue = canonical.is('meta') ? canonical.attr('content') : canonical.attr('href');
  const canonicalId = idFromUrl(canonicalValue ?? '');
  if (canonicalId) return canonicalId;

  const dataId = $('[data-ad-id], [data-property-id], [data-listing-id]').first().attr('data-ad-id')
    ?? $('[data-property-id], [data-listing-id]').first().attr('data-property-id')
    ?? $('[data-listing-id]').first().attr('data-listing-id');
  if (dataId && /^\d+$/.test(dataId)) return dataId;

  const visible = firstText($, 'body') ?? '';
  return visible.match(/(?:idealista\s*id|id del inmueble|id)\s*[:#]?\s*(\d{6,})/i)?.[1] ?? null;
}

function parseLocalizedNumber(value: string): number | null {
  const raw = value.match(/\d[\d.\s]*(?:,\d+)?/)?.[0];
  if (!raw) return null;
  const compact = raw.replace(/[\s.]/g, '');
  const normalized = compact.includes(',') ? compact.replace(',', '.') : compact;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstMatchingNumber(values: string[], pattern: RegExp): number | null {
  for (const value of values) {
    const match = value.match(pattern);
    if (match) {
      const parsed = parseLocalizedNumber(match[1] ?? match[0]);
      if (parsed !== null) return parsed;
    }
  }
  return null;
}

function featureTexts($: CheerioAPI): string[] {
  return unique($('.info-features li, .info-features span, .main-info__features li, .main-info__features span, [class*="info-features"] li')
    .map((_, element) => nodeText($, element)).get());
}

function mainFactTexts($: CheerioAPI): string[] {
  const values = featureTexts($);
  const containers = $('.info-features, .main-info__features, .info-data, .details-property');
  containers.each((_, element) => {
    values.push(nodeText($, element));
  });
  return unique(values);
}

function sectionForHeading($: CheerioAPI, heading: AnyNode): AnyNode | null {
  const parent = $(heading).parent().get(0);
  if (parent) return parent;
  return $(heading).closest('section, article, .details-property, .details-property-feature, .feature-group').first().get(0) ?? null;
}

function groupItems($: CheerioAPI, heading: AnyNode): string[] {
  const following = $(heading).nextUntil('h2, h3, h4');
  const directFeature = following.filter('.details-property_features, ul, ol, .price-features__container').first();
  if (directFeature.length > 0) {
    const items = directFeature.find('li, p').map((_, element) => nodeText($, element)).get();
    if (items.length > 0) return unique(items);
    const directNode = directFeature.get(0);
    if (directNode) {
      const text = nodeText($, directNode);
      if (text) return unique(text.split(/\n+/));
    }
  }

  const container = sectionForHeading($, heading);
  if (!container) return [];
  const items = $(container).find('li').map((_, element) => nodeText($, element)).get();
  if (items.length > 0) return unique(items);
  const paragraphs = $(container).find('p').map((_, element) => nodeText($, element)).get();
  if (paragraphs.length > 0) return unique(paragraphs);
  return unique(following.map((_, element) => nodeText($, element)).get());
}

function parseFeatureGroups($: CheerioAPI): Record<string, string[]> {
  const groups: Record<string, string[]> = {};
  $('h2, h3, h4, .details-property-h2').each((_, element) => {
    const label = nodeText($, element);
    const normalized = label.toLowerCase();
    if (!GROUP_NAMES.has(normalized)) return;
    const items = groupItems($, element);
    if (items.length > 0) groups[label] = items;
  });
  return groups;
}

function parseSpanishDescription($: CheerioAPI): string | null {
  const containers = $('.adCommentsLanguage, [class*="adCommentsLanguage"]');
  let result: string | null = null;
  containers.each((_, container) => {
    if (result) return;
    const languageChildren = $(container).find('[lang], [data-language], [data-lang]');
    const spanish = languageChildren.filter((__, element) => {
      const language = (element.attribs?.lang ?? element.attribs?.['data-language'] ?? element.attribs?.['data-lang'] ?? '').toLowerCase();
      return language.startsWith('es') && !$(element).is('.selectorLanguage, .optionalLanguage, .translation-error');
    }).map((__, element) => nodeText($, element)).get();
    if (spanish.length > 0) {
      result = unique(spanish).join('\n\n');
    } else if (languageChildren.length === 0) {
      const text = nodeText($, container);
      if (text && !/traduc|translation|error de traducción/i.test(text)) result = text;
    }
  });
  if (result) return result;

  let description: string | null = null;
  $('h2, h3, h4').each((_, heading) => {
    if (description || !/comentario del anunciante/i.test(nodeText($, heading))) return;
    const container = sectionForHeading($, heading);
    if (container) {
      const spanish = $(container).find('[lang="es"], [data-language="es"], [data-lang="es"], .adCommentsLanguage-es, .adCommentsLanguage--es').map((__, element) => nodeText($, element)).get();
      const candidates = spanish.length > 0
        ? spanish
        : $(container).find('p').map((__, element) => nodeText($, element)).get();
      description = unique(candidates).join('\n\n') || null;
    }
  });
  return description;
}

function locationParts($: CheerioAPI, records: JsonObject[]): {
  location: string | null;
  neighborhood: string | null;
  district: string | null;
  city: string | null;
} {
  const city = structuredValue(records, ['addressLocality', 'locality', 'city']);
  const region = structuredValue(records, ['addressRegion']);
  const domLocation = firstText($, '.main-info__title-minor') ?? firstText($, '[class*="location"]');
  const location = domLocation ?? structuredValue(records, ['streetAddress']);
  const source = location ?? '';
  const locationDetails = unique([source, ...$('.header-map-list').map((_, element) => nodeText($, element)).get()]).join(' | ');
  const labeled = (labels: string[]): string | null => {
    const match = locationDetails.match(new RegExp(`(?:${labels.join('|')})\\s*[:\\-]?\\s*([^,|]+)`, 'i'));
    return match?.[1] ? cleanText(match[1]) : null;
  };
  const parts = source.split(',').map(cleanText).filter(Boolean);
  const labeledNeighborhood = labeled(['barrio', 'zona', 'área', 'area']);
  const labeledDistrict = labeled(['distrito']);
  const locationCity = city ?? labeled(['ciudad']) ?? (parts.length >= 2 ? parts.at(-1) ?? null : null);
  const hasTrailingCity = Boolean(locationCity && parts.at(-1)?.toLowerCase() === locationCity.toLowerCase());
  return {
    location: location ?? (locationCity ? [region, locationCity].filter(Boolean).join(', ') : null),
    neighborhood: labeledNeighborhood ?? (hasTrailingCity && parts.length >= 2 ? parts[0] : null),
    district: labeledDistrict ?? region ?? (hasTrailingCity && parts.length >= 3 ? parts.at(-2) ?? null : null),
    city: locationCity,
  };
}

function parseAdvertiser($: CheerioAPI, records: JsonObject[]): IdealistaAdvertiser {
  const advertiserContainer = firstText($, '.advertiser-name, [class*="advertiser-name"]');
  const name = advertiserContainer ?? structuredValue(records, ['seller']);
  const typeText = firstText($, '[data-advertiser-type], .advertiser-type, .professional-type');
  let reference: string | null = null;
  $('.ad-reference-container, .txt-ref, [data-reference], .advertiser, [class*="advertiser"]').each((_, element) => {
    if (reference) return;
    const source = nodeText($, element);
    reference = source.match(/(?:referencia(?:\s+del\s+anuncio)?|ref\.?)[:\s#-]*([A-Z0-9][A-Z0-9-]{2,})/i)?.[1]
      ?? (source.match(/^\d{6,}$/)?.[0] ?? null);
  });
  return { name, type_text: typeText, reference };
}

function evidenceCandidates($: CheerioAPI): string[] {
  return unique($('li, p, h2, h3, h4, .header-map-list, .adCommentsLanguage, [class*="price"], [class*="feature"], [class*="reference"]')
    .map((_, element) => nodeText($, element)).get().filter((text) => text.length <= 300));
}

function evidenceFor($: CheerioAPI, pattern: RegExp): string[] {
  const candidates = evidenceCandidates($).filter((text) => pattern.test(text));
  return candidates.filter((candidate, index) => !candidates.some((other, otherIndex) =>
    otherIndex !== index && other.length < candidate.length && candidate.toLowerCase().includes(other.toLowerCase())));
}

function extractEvidence($: CheerioAPI): IdealistaTextEvidence {
  return {
    lease_contract: evidenceFor($, EVIDENCE_PATTERNS.lease_contract),
    deposit_guarantees: evidenceFor($, EVIDENCE_PATTERNS.deposit_guarantees),
    income_documents: evidenceFor($, EVIDENCE_PATTERNS.income_documents),
    fees_costs: evidenceFor($, EVIDENCE_PATTERNS.fees_costs),
    occupancy_restrictions: evidenceFor($, EVIDENCE_PATTERNS.occupancy_restrictions),
    availability: evidenceFor($, EVIDENCE_PATTERNS.availability),
    transport_location: evidenceFor($, EVIDENCE_PATTERNS.transport_location),
  };
}

function occupancyProfile($: CheerioAPI): string[] {
  const values: string[] = [];
  $('h2, h3, h4').each((_, heading) => {
    if (/el anunciante lo ve apropiado para/i.test(nodeText($, heading))) values.push(...groupItems($, heading));
  });
  return unique(values);
}

function classifyListingState($: CheerioAPI, html: string, completeness: Omit<IdealistaCompleteness, 'accepted' | 'rejection_reasons'>): IdealistaListing['listing_state'] {
  const source = `${html}\n${firstText($, 'body') ?? ''}`.toLowerCase();
  if (BLOCKED_MARKERS.some((marker) => source.includes(marker))) return 'blocked';
  if (DELETED_MARKERS.some((marker) => source.includes(marker))) return 'deleted';
  return completeness.expected_id_found && completeness.price_found && completeness.property_metadata_found
    && completeness.spanish_description_found && completeness.advertiser_found ? 'active' : 'partial';
}

function parseFacts($: CheerioAPI, records: JsonObject[]): IdealistaFacts {
  const features = mainFactTexts($);
  const title = structuredValue(records, ['name']) ?? firstText($, '.main-info__title-main, h1, meta[property="og:title"]');
  const structuredPrice = structuredValue(records, ['price']);
  const priceText = firstText($, '.info-data-price, [class*="info-data-price"], [data-testid*="price"]');
  const structuredPriceNumber = structuredPrice && /^\d+(?:\.\d+)?$/.test(structuredPrice)
    ? Number(structuredPrice)
    : parseLocalizedNumber(structuredPrice ?? '');
  const sizes = [...features, firstText($, 'body') ?? ''];
  const location = locationParts($, records);
  const featureSummary = featureTexts($).join(' · ') || null;
  return {
    title,
    price_eur_month: structuredPriceNumber ?? firstMatchingNumber([priceText ?? ''], /([\d][\d.\s]*(?:,\d+)?)\s*€?/i),
    size_m2_built: firstMatchingNumber(sizes, /([\d][\d.\s]*(?:,\d+)?)\s*m(?:²|2)\s*(?:construid[oa]s?)/i),
    size_m2_usable: firstMatchingNumber(sizes, /([\d][\d.\s]*(?:,\d+)?)\s*m(?:²|2)\s*(?:útiles|utiles)/i),
    bedrooms: firstMatchingNumber(sizes, /([\d][\d.\s]*)\s*habitaciones?/i),
    bathrooms: firstMatchingNumber(sizes, /([\d][\d.\s]*)\s*baños?/i),
    floor_text: features.find((text) => /planta/i.test(text)) ?? firstText($, '[class*="floor"]'),
    location_text: location.location,
    neighborhood_or_area: location.neighborhood,
    district: location.district,
    city: location.city,
    feature_summary: featureSummary,
  };
}

function completenessFor(expectedId: string, documentListingId: string | null, facts: IdealistaFacts, description: string | null, advertiser: IdealistaAdvertiser, state: IdealistaListing['listing_state']): IdealistaCompleteness {
  const expectedIdFound = documentListingId === expectedId;
  const priceFound = facts.price_eur_month !== null;
  const propertyMetadataFound = facts.size_m2_built !== null || facts.size_m2_usable !== null || facts.bedrooms !== null || facts.bathrooms !== null;
  const spanishDescriptionFound = description !== null;
  const advertiserFound = advertiser.name !== null;
  const rejectionReasons: string[] = [];
  if (!expectedIdFound) rejectionReasons.push(documentListingId ? 'document_id_mismatch' : 'expected_id_not_found');
  if (!priceFound) rejectionReasons.push('price_not_found');
  if (!propertyMetadataFound) rejectionReasons.push('property_metadata_not_found');
  if (!spanishDescriptionFound) rejectionReasons.push('spanish_description_not_found');
  if (!advertiserFound) rejectionReasons.push('advertiser_not_found');
  if (state === 'blocked') rejectionReasons.push('listing_blocked');
  if (state === 'deleted') rejectionReasons.push('listing_deleted');
  return {
    accepted: rejectionReasons.length === 0 && state === 'active',
    expected_id_found: expectedIdFound,
    price_found: priceFound,
    property_metadata_found: propertyMetadataFound,
    spanish_description_found: spanishDescriptionFound,
    advertiser_found: advertiserFound,
    rejection_reasons: rejectionReasons,
  };
}

function unsupportedResult(): IdealistaParseResult {
  return {
    page_type: 'unsupported',
    listing: null,
    completeness: null,
    errors: ['Unsupported Idealista URL: detail listing expected'],
  };
}

export function isIdealistaDetailUrl(value: string | URL): boolean {
  let url: URL;
  try {
    url = typeof value === 'string' ? new URL(value) : value;
  } catch {
    return false;
  }
  return (url.hostname.toLowerCase() === 'idealista.com' || url.hostname.toLowerCase() === 'www.idealista.com')
    && /^\/inmueble\/\d+\/?$/i.test(url.pathname);
}

export function parseIdealistaDetail(input: ParseIdealistaDetailInput): IdealistaParseResult {
  if (!isIdealistaDetailUrl(input.url)) return unsupportedResult();
  const url = typeof input.url === 'string' ? new URL(input.url) : input.url;
  const expectedId = idFromUrl(url.pathname) as string;
  const $ = load(input.html);
  const records = parseJsonLd($);
  const documentListingId = documentId($, records);
  const facts = parseFacts($, records);
  const description = parseSpanishDescription($);
  const advertiser = parseAdvertiser($, records);
  const evidence = extractEvidence($);
  const groups = parseFeatureGroups($);
  const occupancy = occupancyProfile($);
  const priceTerms = unique([...evidence.deposit_guarantees, ...evidence.lease_contract, ...evidence.fees_costs].filter((text) => /fianza|depósito|deposito|garantía|contrato|alquiler|gastos|honorarios/i.test(text)));
  const preliminary = {
    expected_id_found: documentListingId === expectedId,
    price_found: facts.price_eur_month !== null,
    property_metadata_found: facts.size_m2_built !== null || facts.size_m2_usable !== null || facts.bedrooms !== null || facts.bathrooms !== null,
    spanish_description_found: description !== null,
    advertiser_found: advertiser.name !== null,
  };
  const state = classifyListingState($, input.html, preliminary);
  const completeness = completenessFor(expectedId, documentListingId, facts, description, advertiser, state);
  const unknown = Object.entries(facts).filter(([, value]) => value === null).map(([key]) => key);
  if (!description) unknown.push('spanish_description');
  if (!advertiser.name) unknown.push('advertiser.name');
  const listing: IdealistaListing = {
    schema: 1,
    source: 'idealista',
    idealista_id: documentListingId ?? expectedId,
    url: url.toString(),
    language: 'es',
    listing_state: state,
    facts,
    spanish_description: description,
    property_feature_groups: groups,
    advertiser,
    occupancy_profile: occupancy,
    price_terms: priceTerms.length > 0 ? priceTerms : null,
    text_evidence: evidence,
    unknown_or_not_found: unique(unknown),
    provenance: {
      method: ['json-ld', 'server-rendered-html', 'textual-semantic-fallback'],
      raw_html_retained_for_debug_only: true,
    },
  };
  return { page_type: 'detail', listing, completeness, errors: [] };
}

export type { IdealistaListing, IdealistaCompleteness, IdealistaParseResult } from './types.js';
