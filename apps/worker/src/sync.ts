import { createAppError, type AppErrorShape, type JsonValue } from '@subforge/shared';

export interface FetchTextResult {
  text: string;
  status: number;
  durationMs: number;
  fetchedBytes: number;
  contentType?: string;
}

type SyncErrorDetails = Record<string, JsonValue | undefined>;

class SyncFailure extends Error {
  readonly detailPatch: SyncErrorDetails;

  constructor(detailPatch: SyncErrorDetails, message: string) {
    super(message);
    this.name = 'SyncFailure';
    this.detailPatch = detailPatch;
    Object.setPrototypeOf(this, SyncFailure.prototype);
  }
}

export class SyncFetchError extends Error {
  status: number | undefined;
  fetchedBytes: number | undefined;
  durationMs: number;

  constructor(message: string, input: { status?: number; fetchedBytes?: number; durationMs: number }) {
    super(message);
    this.name = 'SyncFetchError';
    this.status = input.status;
    this.fetchedBytes = input.fetchedBytes;
    this.durationMs = input.durationMs;
  }
}

function compactRecord(record: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record as Record<string, unknown>).filter(([, value]) => value !== undefined));
}

export async function fetchText(sourceUrl: string, timeoutMs: number): Promise<FetchTextResult> {
  const controller = new AbortController();
  const start = Date.now();
  const timer = setTimeout(() => controller.abort('timeout'), timeoutMs);

  try {
    let response: Response;

    try {
      response = await fetch(sourceUrl, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'user-agent': 'SubForge/0.1.0'
        }
      });
    } catch (error) {
      const durationMs = Date.now() - start;

      if (controller.signal.aborted && controller.signal.reason === 'timeout') {
        throw new SyncFailure(
          {
            stage: 'fetch',
            errorCode: 'FETCH_TIMEOUT',
            durationMs,
            reason: `upstream request timed out after ${timeoutMs}ms`
          },
          `upstream request timed out after ${timeoutMs}ms`
        );
      }

      const reason = error instanceof Error ? error.message : 'upstream request failed';
      throw new SyncFailure(
        {
          stage: 'fetch',
          errorCode: 'FETCH_NETWORK_ERROR',
          durationMs,
          reason
        },
        reason
      );
    }

    const contentType = response.headers.get('content-type') ?? undefined;
    const text = (await response.text()).trim();
    const durationMs = Date.now() - start;
    const fetchedBytes = new TextEncoder().encode(text).byteLength;

    if (!response.ok) {
      throw new SyncFetchError(`upstream returned ${response.status}`, {
        status: response.status,
        fetchedBytes,
        durationMs
      });
    }

    return {
      text,
      status: response.status,
      durationMs,
      fetchedBytes,
      contentType
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new SyncFetchError('upstream request timed out', {
        durationMs: Date.now() - start
      });
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function toFetchTextValidationError(error: unknown, sourceUrl: string): AppErrorShape | null {
  if (error instanceof SyncFailure) {
    return createAppError(
      'VALIDATION_FAILED',
      error.message,
      compactRecord({
        sourceUrl,
        ...error.detailPatch
      })
    );
  }

  if (error instanceof SyncFetchError) {
    return createAppError(
      'VALIDATION_FAILED',
      error.message,
      compactRecord({
        sourceUrl,
        durationMs: error.durationMs,
        ...(error.status !== undefined ? { upstreamStatus: error.status } : {}),
        ...(error.fetchedBytes !== undefined ? { fetchedBytes: error.fetchedBytes } : {})
      })
    );
  }

  return null;
}
