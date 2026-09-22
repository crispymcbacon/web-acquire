export interface GuinotSearchListing {
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
  position: number;
}

export interface GuinotSearchResult {
  schema: 1;
  source: 'guinotprunera';
  url: string;
  pageType: 'search';
  summary: { resultCount: number | null };
  listings: GuinotSearchListing[];
  pagination: { nextUrl: string | null };
  warnings: string[];
}

export interface GuinotSearchCompleteness {
  accepted: boolean;
  searchPageRecognized: boolean;
  listingCardsFound: boolean;
  listingIdsResolved: boolean;
  explicitZeroResults: boolean;
  blocked: boolean;
  rejectionReasons: string[];
}

export interface GuinotSearchParseResult {
  pageType: 'search' | 'unsupported';
  search: GuinotSearchResult | null;
  completeness: GuinotSearchCompleteness | null;
  errors: string[];
}

export interface ParseGuinotSearchInput {
  html: string;
  url: string | URL;
}
