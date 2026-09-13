import type { SiteAdapter } from '../../core/types.js';

export class IdealistaAdapter implements SiteAdapter {
  readonly name = 'idealista';
  readonly domains = ['idealista.com', 'www.idealista.com'] as const;

  canHandle(url: URL): boolean {
    return this.domains.includes(url.hostname.toLowerCase() as (typeof this.domains)[number]);
  }

  async parse(_document: string, _url: URL): Promise<unknown> {
    throw new Error('Idealista extraction is not implemented yet.');
  }
}
