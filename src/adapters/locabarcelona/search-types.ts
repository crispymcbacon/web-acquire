export type LocaContractType = 'long-term' | 'short-term';

export interface LocaSearchListing {
  listingId: string;
  reference: string | null;
  url: string | null;
  title: string | null;
  priceEurMonth: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  sizeM2: number | null;
  locationText: string | null;
  descriptionExcerpt: string | null;
  contractType: LocaContractType | null;
  position: number;
}

export interface LocaSearchResult {
  schema: 1;
  source: 'locabarcelona';
  url: string;
  pageType: 'search';
  summary: { resultCount: number | null };
  listings: LocaSearchListing[];
  pagination: { nextUrl: string | null };
  warnings: string[];
}

export interface LocaSearchCompleteness {
  accepted: boolean;
  searchPageRecognized: boolean;
  listingCardsFound: boolean;
  listingIdsResolved: boolean;
  explicitZeroResults: boolean;
  blocked: boolean;
  rejectionReasons: string[];
}

export interface LocaSearchParseResult {
  pageType: 'search' | 'unsupported';
  search: LocaSearchResult | null;
  completeness: LocaSearchCompleteness | null;
  errors: string[];
}

export interface ParseLocaSearchInput {
  html: string;
  url: string | URL;
}
