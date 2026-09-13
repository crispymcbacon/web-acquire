import type { AcquisitionProvider, AcquisitionRequest, AcquisitionResult } from './types.js';

export async function acquire(
  provider: AcquisitionProvider,
  request: AcquisitionRequest,
): Promise<AcquisitionResult> {
  return provider.acquire(request);
}
