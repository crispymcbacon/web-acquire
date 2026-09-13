import type { SiteAdapter } from '../../core/types.js';
import { isIdealistaDetailUrl, parseIdealistaDetail } from './parser.js';
import type { IdealistaParseResult } from './types.js';

export class IdealistaAdapter implements SiteAdapter {
  readonly name = 'idealista';
  readonly domains = ['idealista.com', 'www.idealista.com'] as const;

  canHandle(url: URL): boolean {
    return this.domains.includes(url.hostname.toLowerCase() as (typeof this.domains)[number]);
  }

  isDetailUrl(url: string | URL): boolean {
    return isIdealistaDetailUrl(url);
  }

  async parse(document: string, url: URL): Promise<IdealistaParseResult> {
    return parseIdealistaDetail({ html: document, url });
  }
}

export { isIdealistaDetailUrl, parseIdealistaDetail } from './parser.js';
export type {
  IdealistaAdvertiser,
  IdealistaCompleteness,
  IdealistaFacts,
  IdealistaListing,
  IdealistaListingState,
  IdealistaParseResult,
  IdealistaTextEvidence,
  ParseIdealistaDetailInput,
} from './types.js';
