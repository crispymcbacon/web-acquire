import type { AcquisitionProvider, AcquisitionRequest, AcquisitionResult } from '../../core/types.js';
import { loadBrightDataConfig, type BrightDataConfig } from './config.js';

/** Skeleton only: intentionally performs no network request in this milestone. */
export class BrightDataUnlockerProvider implements AcquisitionProvider {
  readonly name = 'brightdata';
  private readonly config: BrightDataConfig;

  constructor(config: BrightDataConfig = loadBrightDataConfig()) {
    this.config = config;
  }

  async acquire(request: AcquisitionRequest): Promise<AcquisitionResult> {
    const startedAt = new Date().toISOString();
    return {
      requestedUrl: request.url,
      success: false,
      provider: this.name,
      method: 'brightdata-web-unlocker',
      elapsedMs: 0,
      warnings: ['Network acquisition is not enabled in this milestone.'],
      errors: ['Bright Data Web Unlocker integration is not implemented yet.'],
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }
}
