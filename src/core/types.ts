export type AcquisitionMethod = 'web_unlocker' | 'native-fetch' | 'unknown';

export interface AcquisitionRequest {
  url: string;
}

export interface AcquisitionResult {
  requestedUrl: string;
  finalUrl?: string;
  success: boolean;
  provider: string;
  method: AcquisitionMethod;
  httpStatus?: number;
  contentType?: string;
  responseSizeBytes?: number;
  elapsedMs: number;
  content?: string;
  retainedContentPath?: string;
  outputDir?: string;
  warnings: string[];
  errors: string[];
  startedAt: string;
  completedAt: string;
}

export interface AcquisitionProvider {
  readonly name: string;
  acquire(request: AcquisitionRequest): Promise<AcquisitionResult>;
}

export interface SiteAdapter {
  readonly name: string;
  readonly domains: readonly string[];
  canHandle(url: URL): boolean;
  parse(_document: string, _url: URL): Promise<unknown>;
}
