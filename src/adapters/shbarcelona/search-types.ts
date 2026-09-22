export type ShContractType = 'long-term' | 'short-term';

export interface ShSearchListing {
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
  contractType: ShContractType | null;
  position: number;
}

export interface ShSearchResult {
  schema: 1;
  source: 'shbarcelona';
  url: string;
  pageType: 'search';
  summary: {
    resultCount: number | null;
    currentPage: number | null;
    totalPages: number | null;
  };
  listings: ShSearchListing[];
  pagination: { nextUrl: string | null };
  warnings: string[];
}

export interface ShSearchCompleteness {
  accepted: boolean;
  searchPageRecognized: boolean;
  listingCardsFound: boolean;
  listingIdsResolved: boolean;
  explicitZeroResults: boolean;
  blocked: boolean;
  rejectionReasons: string[];
}

export interface ShSearchParseResult {
  pageType: 'search' | 'unsupported';
  search: ShSearchResult | null;
  completeness: ShSearchCompleteness | null;
  errors: string[];
}

export interface ParseShSearchInput {
  html: string;
  url: string | URL;
}
