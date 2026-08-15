// Promisify helper for node-quickbooks callbacks

export const DEFAULT_QBO_REQUEST_TIMEOUT_MS = 60_000;
const MAX_QBO_REQUEST_TIMEOUT_MS = 600_000;

export class QboOperationTimeoutError extends Error {
  readonly code = "ETIMEDOUT";

  constructor(readonly timeoutMs: number) {
    super(`QuickBooks operation timed out after ${timeoutMs} ms`);
    this.name = "QboOperationTimeoutError";
  }
}

export function getQboRequestTimeoutMs(
  configured = process.env.QBO_REQUEST_TIMEOUT_MS
): number {
  if (configured === undefined || configured.trim() === "") {
    return DEFAULT_QBO_REQUEST_TIMEOUT_MS;
  }

  const timeoutMs = Number(configured);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_QBO_REQUEST_TIMEOUT_MS) {
    throw new Error(
      `QBO_REQUEST_TIMEOUT_MS must be an integer from 1 to ${MAX_QBO_REQUEST_TIMEOUT_MS}`
    );
  }
  return timeoutMs;
}

export function isQboOperationTimeoutError(error: unknown): error is QboOperationTimeoutError {
  return error instanceof QboOperationTimeoutError
    || (typeof error === "object" && error !== null
      && (error as { name?: unknown }).name === "QboOperationTimeoutError"
      && (error as { code?: unknown }).code === "ETIMEDOUT");
}

export function promisify<T>(
  fn: (callback: (err: Error | null, result: T) => void) => void,
  options: { timeoutMs?: number } = {}
): Promise<T> {
  return new Promise((resolve, reject) => {
    let timeoutMs: number;
    try {
      timeoutMs = options.timeoutMs === undefined
        ? getQboRequestTimeoutMs()
        : getQboRequestTimeoutMs(String(options.timeoutMs));
    } catch (error) {
      reject(error);
      return;
    }

    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new QboOperationTimeoutError(timeoutMs));
    }, timeoutMs);

    try {
      fn((err, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (err) reject(err);
        else resolve(result);
      });
    } catch (error) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    }
  });
}
