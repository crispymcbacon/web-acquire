import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AcquisitionProvider, AcquisitionRequest, AcquisitionResult } from '../../core/types.js';
import {
  loadBrightDataConfig,
  validateBrightDataConfig,
  type BrightDataConfig,
} from './config.js';

export const DEFAULT_TIMEOUT_MS = 45_000;
export const DEFAULT_MAX_RESPONSE_BYTES = 20 * 1024 * 1024;
const MAX_ERROR_RESPONSE_BYTES = 64 * 1024;

export class BrightDataResponseTooLargeError extends Error {
  readonly code = 'response-too-large';

  constructor(limit: number) {
    super(`Response exceeds maximum retained size of ${limit} bytes`);
    this.name = 'BrightDataResponseTooLargeError';
  }
}

export interface BrightDataUnlockerOptions {
  config?: BrightDataConfig;
  timeoutMs?: number;
  maxResponseBytes?: number;
  outputDir?: string;
  fetchImpl?: typeof fetch;
}


function safeHost(value: string): string {
  return value.replace(/[^a-zA-Z0-9.-]/g, '_').replace(/^\.+|\.+$/g, '') || 'unknown-host';
}

function displayPath(directory: string, requestedDirectory: string | undefined): string {
  if (requestedDirectory) return requestedDirectory;
  return path.relative(process.cwd(), directory) || '.';
}

function createResult(
  request: AcquisitionRequest,
  startedAt: string,
  completedAt: string,
  values: Partial<AcquisitionResult> = {},
): AcquisitionResult {
  return {
    requestedUrl: request.url,
    success: false,
    provider: 'brightdata',
    method: 'web_unlocker',
    elapsedMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
    warnings: [],
    errors: [],
    startedAt,
    completedAt,
    ...values,
  };
}

function contentType(response: Response): string | undefined {
  return response.headers.get('content-type')?.split(';', 1)[0]?.trim() || undefined;
}

function isTextLike(type: string | undefined): boolean {
  return Boolean(type && (type.startsWith('text/') || type.includes('json') || type.includes('xml')));
}

function redact(value: string, token: string): string {
  return token ? value.split(token).join('[REDACTED]') : value;
}

async function readBody(response: Response, limit: number): Promise<Uint8Array> {
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > limit) throw new BrightDataResponseTooLargeError(limit);
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new BrightDataResponseTooLargeError(limit);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function metadataFor(result: AcquisitionResult): Record<string, unknown> {
  return {
    schema: 1,
    requested_url: result.requestedUrl,
    ...(result.finalUrl ? { final_url: result.finalUrl } : {}),
    provider: result.provider,
    method: result.method,
    success: result.success,
    ...(result.httpStatus === undefined ? {} : { http_status: result.httpStatus }),
    ...(result.contentType ? { content_type: result.contentType } : {}),
    ...(result.responseSizeBytes === undefined ? {} : { response_bytes: result.responseSizeBytes }),
    elapsed_ms: result.elapsedMs,
    started_at: result.startedAt,
    completed_at: result.completedAt,
    ...(result.retainedContentPath ? { response_file: result.retainedContentPath } : {}),
    warnings: result.warnings,
    ...(result.errors.length ? { errors: result.errors } : {}),
  };
}

async function persistMetadata(directory: string, result: AcquisitionResult): Promise<void> {
  await writeFile(path.join(directory, 'metadata.json'), `${JSON.stringify(metadataFor(result), null, 2)}\n`, 'utf8');
}

/** Acquires a target through Bright Data Web Unlocker with no automatic retries. */
export class BrightDataUnlockerProvider implements AcquisitionProvider {
  readonly name = 'brightdata';
  private readonly options: BrightDataUnlockerOptions;

  constructor(options: BrightDataUnlockerOptions = {}) {
    this.options = options;
  }

  async acquire(request: AcquisitionRequest): Promise<AcquisitionResult> {
    // loadBrightDataConfig loads .env without overriding explicit process values.
    const config = this.options.config ?? loadBrightDataConfig();
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxResponseBytes = this.options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    const started = Date.now();
    const startedAt = new Date(started).toISOString();
    const validation = validateBrightDataConfig(config);

    if (!validation.valid) {
      return createResult(request, startedAt, new Date().toISOString(), {
        errors: validation.errors.map((error) =>
          error.endsWith(' is required')
            ? `Missing Bright Data configuration: ${error.replace(' is required', '')}`
            : error,
        ),
      });
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(request.url);
    } catch {
      return createResult(request, startedAt, new Date().toISOString(), {
        errors: ['Invalid acquisition URL'],
      });
    }

    const runDirectory = this.options.outputDir
      ? path.resolve(this.options.outputDir)
      : path.resolve('runs', `${startedAt.replace(/[.:]/g, '-')}-${safeHost(parsedUrl.hostname)}`);
    const outputDirectory = displayPath(runDirectory, this.options.outputDir);
    const baseValues = { outputDir: outputDirectory };

    try {
      await mkdir(runDirectory, { recursive: true });
    } catch {
      return createResult(request, startedAt, new Date().toISOString(), {
        ...baseValues,
        errors: ['Unable to create the acquisition output directory'],
      });
    }

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    let response: Response;
    try {
      const fetchImpl = this.options.fetchImpl ?? globalThis.fetch;
      response = await fetchImpl(config.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          zone: config.unlockerZone,
          url: request.url,
          format: 'raw',
          method: 'GET',
        }),
        signal: controller.signal,
      });
    } catch {
      clearTimeout(timer);
      const failure = createResult(request, startedAt, new Date().toISOString(), {
        ...baseValues,
        errors: [
          timedOut
            ? `Bright Data acquisition timed out after ${timeoutMs / 1000} seconds`
            : 'Network error while contacting Bright Data',
        ],
      });
      await persistMetadata(runDirectory, failure).catch(() => undefined);
      return failure;
    }

    try {
      const type = contentType(response);
      const statusValues = {
        ...baseValues,
        httpStatus: response.status,
        contentType: type,
      };
      const declaredLength = Number(response.headers.get('content-length'));

      if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
        const failure = createResult(request, startedAt, new Date().toISOString(), {
          ...statusValues,
          errors: [`Response exceeds maximum retained size of ${maxResponseBytes} bytes`],
        });
        await persistMetadata(runDirectory, failure).catch(() => undefined);
        return failure;
      }

      if (!response.ok) {
        let diagnostic: Uint8Array<ArrayBufferLike> = new Uint8Array();
        try {
          diagnostic = await readBody(response, MAX_ERROR_RESPONSE_BYTES);
        } catch (error) {
          if (!(error instanceof BrightDataResponseTooLargeError)) throw error;
        }
        let retainedContentPath: string | undefined;
        if (diagnostic.byteLength > 0 && isTextLike(type)) {
          const diagnosticText = redact(new TextDecoder().decode(diagnostic), config.apiToken);
          await writeFile(path.join(runDirectory, 'error-response.txt'), diagnosticText, 'utf8');
          retainedContentPath = 'error-response.txt';
        }
        const failure = createResult(request, startedAt, new Date().toISOString(), {
          ...statusValues,
          retainedContentPath,
          errors: [`Bright Data returned HTTP ${response.status}`],
        });
        await persistMetadata(runDirectory, failure).catch(() => undefined);
        return failure;
      }

      const body = await readBody(response, maxResponseBytes);
      const responsePath = path.join(runDirectory, 'response.html');
      await writeFile(responsePath, body);
      const success = createResult(request, startedAt, new Date().toISOString(), {
        ...statusValues,
        success: true,
        responseSizeBytes: body.byteLength,
        retainedContentPath: 'response.html',
      });
      await persistMetadata(runDirectory, success);
      return success;
    } catch (error) {
      const failure = createResult(request, startedAt, new Date().toISOString(), {
        ...baseValues,
        httpStatus: response.status,
        contentType: contentType(response),
        errors: [
          error instanceof BrightDataResponseTooLargeError
            ? error.message
            : timedOut
              ? `Bright Data acquisition timed out after ${timeoutMs / 1000} seconds`
              : 'Unable to consume or persist the Bright Data response',
        ],
      });
      await persistMetadata(runDirectory, failure).catch(() => undefined);
      return failure;
    } finally {
      clearTimeout(timer);
    }
  }
}
