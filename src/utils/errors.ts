import {
  extractHttpStatus,
  extractQBErrorInfo,
  unwrapQBError,
} from "../types/index.js";

const MAX_FIELD_LENGTH = 500;
const MAX_ERROR_LENGTH = 2_000;

function bounded(value: unknown, limit = MAX_FIELD_LENGTH): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const text = String(value);
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1)}…`;
}

function finalize(message: string): string {
  if (message.length <= MAX_ERROR_LENGTH) return message;
  return `${message.slice(0, MAX_ERROR_LENGTH - 1)}…`;
}

/**
 * Format an API error using only explicitly allowlisted fields.
 * Never serialize raw Axios response, request, config, or header objects.
 */
export function formatQBOError(error: unknown): string {
  if (unwrapQBError(error)) {
    const info = extractQBErrorInfo(error);
    const code = bounded(info.code);
    const message = bounded(info.message);
    const detail = bounded(info.detail);
    const element = bounded(info.element);

    let result = code ? `QBO error ${code}` : "QBO error";
    if (message) result += `: ${message}`;
    if (detail && detail !== message) result += ` — ${detail}`;
    if (element) result += ` (${element})`;
    return finalize(result);
  }

  if (error instanceof Error) {
    const status = extractHttpStatus(error);
    const errorCode = bounded((error as Error & { code?: unknown }).code);
    const message = bounded(error.message) ?? "Unknown error";
    if (status) return finalize(`HTTP ${status}: ${message}`);
    if (errorCode) return finalize(`Error ${errorCode}: ${message}`);
    return finalize(message);
  }

  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    const status = extractHttpStatus(error);
    const errorCode = bounded(record.code);
    const message = bounded(record.message);
    if (status) return finalize(`HTTP ${status}: ${message ?? "Unknown error"}`);
    if (errorCode) return finalize(`Error ${errorCode}: ${message ?? "Unknown error"}`);
    return finalize(message ?? "Unknown error");
  }

  return finalize(bounded(error, MAX_ERROR_LENGTH) ?? "Unknown error");
}