export type IdealistaListingState = 'active' | 'deleted' | 'blocked' | 'partial';

export interface IdealistaFacts {
  title: string | null;
  price_eur_month: number | null;
  size_m2_built: number | null;
  size_m2_usable: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  floor_text: string | null;
  location_text: string | null;
  neighborhood_or_area: string | null;
  district: string | null;
  city: string | null;
  feature_summary: string | null;
}

export interface IdealistaAdvertiser {
  name: string | null;
  type_text: string | null;
  reference: string | null;
}

export interface IdealistaTextEvidence {
  lease_contract: string[];
  deposit_guarantees: string[];
  income_documents: string[];
  fees_costs: string[];
  occupancy_restrictions: string[];
  availability: string[];
  transport_location: string[];
}

export interface IdealistaListing {
  schema: 1;
  source: 'idealista';
  idealista_id: string;
  url: string;
  language: 'es';
  listing_state: IdealistaListingState;
  facts: IdealistaFacts;
  spanish_description: string | null;
  property_feature_groups: Record<string, string[]>;
  advertiser: IdealistaAdvertiser;
  occupancy_profile: string[];
  price_terms: string[] | null;
  text_evidence: IdealistaTextEvidence;
  unknown_or_not_found: string[];
  provenance: {
    method: string[];
    raw_html_retained_for_debug_only: true;
  };
}

export interface IdealistaCompleteness {
  accepted: boolean;
  expected_id_found: boolean;
  price_found: boolean;
  property_metadata_found: boolean;
  spanish_description_found: boolean;
  advertiser_found: boolean;
  rejection_reasons: string[];
}

export interface IdealistaParseResult {
  page_type: 'detail' | 'unsupported';
  listing: IdealistaListing | null;
  completeness: IdealistaCompleteness | null;
  errors: string[];
}

export interface ParseIdealistaDetailInput {
  html: string;
  url: string | URL;
}
