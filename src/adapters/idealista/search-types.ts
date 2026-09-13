export interface IdealistaSearchListing {
  idealistaId: string;
  url: string;
  title: string | null;
  priceEurMonth: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  sizeM2: number | null;
  floorText: string | null;
  locationText: string | null;
  descriptionExcerpt: string | null;
  tags: string[];
  photoCount: number | null;
  position: number;
}

export interface IdealistaSearchResult {
  schema: 1;
  source: 'idealista';
  url: string;
  pageType: 'search';
  summary: {
    resultCount: number | null;
    currentPage: number | null;
    totalPages: number | null;
  };
  listings: IdealistaSearchListing[];
  pagination: {
    nextUrl: string | null;
    previousUrl: string | null;
  };
  warnings: string[];
  provenance: {
    method: string[];
    rawHtmlRetainedForDebugOnly: true;
  };
}

export interface IdealistaSearchCompleteness {
  accepted: boolean;
  searchPageRecognized: boolean;
  listingCardsFound: boolean;
  listingIdsResolved: boolean;
  blocked: boolean;
  rejectionReasons: string[];
}

export interface IdealistaSearchParseResult {
  pageType: 'search' | 'unsupported';
  search: IdealistaSearchResult | null;
  completeness: IdealistaSearchCompleteness | null;
  errors: string[];
}

export interface ParseIdealistaSearchInput {
  html: string;
  url: string | URL;
}
