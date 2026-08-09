// Read-only discovery and content retrieval for QBO Attachables

import QuickBooks from "node-quickbooks";
import { promisify } from "../../client/index.js";
import { asMCPToolResult } from "../../types/index.js";
import type { MCPToolResult, QBAttachable } from "../../types/index.js";
import {
  downloadHttpsContent,
  HttpDownloadError,
  isHttpMode,
  isLambdaMode,
  outputReport,
} from "../../utils/index.js";
import {
  canonicalizeAttachableEntityType,
  validateQboEntityId,
} from "../attachable-fields.js";

const MAX_ATTACHMENTS = 100;
const HTTP_ATTACHMENT_LIMIT = 20;
const METADATA_CONCURRENCY = 5;
const MAX_TEXT_BYTES = 256 * 1024;
const MAX_BINARY_BYTES = 10 * 1024 * 1024;
const MAX_HTTP_BINARY_BYTES = 4 * 1024 * 1024;

const IMAGE_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/gif"]);
const TEXT_TYPES = new Set(["text/plain", "text/csv", "text/xml", "application/xml"]);
const PDF_TYPE = "application/pdf";

interface SafeAttachableMetadata {
  id: string;
  syncToken: string;
  fileName?: string;
  contentType?: string;
  size?: number;
  note?: string;
  category?: string;
  linkedEntities: Array<{
    type?: string;
    id: string;
    name?: string;
    includeOnSend?: boolean;
  }>;
  createdAt?: string;
  updatedAt?: string;
}

function safeMetadata(attachable: QBAttachable): SafeAttachableMetadata {
  return {
    id: attachable.Id,
    syncToken: attachable.SyncToken,
    fileName: attachable.FileName,
    contentType: attachable.ContentType,
    size: attachable.Size,
    note: attachable.Note,
    category: attachable.Category,
    linkedEntities: (attachable.AttachableRef ?? [])
      .filter((ref) => ref.EntityRef?.value)
      .map((ref) => ({
        type: ref.EntityRef?.type,
        id: ref.EntityRef!.value,
        name: ref.EntityRef?.name,
        includeOnSend: ref.IncludeOnSend,
      })),
    createdAt: attachable.MetaData?.CreateTime,
    updatedAt: attachable.MetaData?.LastUpdatedTime,
  };
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex++;
      results[index] = await mapper(values[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => worker())
  );
  return results;
}

async function getAttachable(client: QuickBooks, id: string): Promise<QBAttachable> {
  return await promisify<unknown>((callback) => client.getAttachable(id, callback)) as QBAttachable;
}

function normalizeContentType(value: string | undefined): string | undefined {
  return value?.split(";", 1)[0]?.trim().toLowerCase();
}

function contentTypesCompatible(expected: string, actual: string | undefined): boolean {
  if (!actual || actual === "application/octet-stream") return true;
  if (expected === actual) return true;
  return (expected === "image/jpeg" && actual === "image/jpg") ||
    (expected === "image/jpg" && actual === "image/jpeg");
}

function binaryReadLimit(): number {
  return isHttpMode() ? MAX_HTTP_BINARY_BYTES : MAX_BINARY_BYTES;
}

async function downloadAttachable(
  client: QuickBooks,
  attachable: QBAttachable,
  maxBytes: number
): Promise<{ attachable: QBAttachable; bytes: Buffer; responseType?: string }> {
  if (!attachable.TempDownloadUri) {
    throw new Error(`Attachable ${attachable.Id} does not contain a downloadable file`);
  }

  try {
    const downloaded = await downloadHttpsContent(attachable.TempDownloadUri, { maxBytes });
    return { attachable, bytes: downloaded.bytes, responseType: downloaded.contentType };
  } catch (error) {
    if (!(error instanceof HttpDownloadError) || (error.status !== 401 && error.status !== 403)) {
      throw error;
    }

    // QBO download URLs expire after roughly 15 minutes. Re-read metadata for a
    // fresh signed URL and retry exactly once.
    const refreshed = await getAttachable(client, attachable.Id);
    if (!refreshed.TempDownloadUri) throw error;
    const downloaded = await downloadHttpsContent(refreshed.TempDownloadUri, { maxBytes });
    return { attachable: refreshed, bytes: downloaded.bytes, responseType: downloaded.contentType };
  }
}

export async function handleListTransactionAttachables(
  client: QuickBooks,
  args: { entity_type: string; entity_id: string; limit?: number }
): Promise<MCPToolResult> {
  const entityType = canonicalizeAttachableEntityType(args.entity_type);
  validateQboEntityId(args.entity_id);
  const limit = args.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ATTACHMENTS) {
    throw new Error(`limit must be an integer from 1 to ${MAX_ATTACHMENTS}`);
  }
  const effectiveLimit = isHttpMode() ? Math.min(limit, HTTP_ATTACHMENT_LIMIT) : limit;

  const queryResult = await promisify<unknown>((callback) =>
    client.findAttachables([
      { field: "AttachableRef.EntityRef.Type", value: entityType.toLowerCase(), operator: "=" },
      { field: "AttachableRef.EntityRef.value", value: args.entity_id, operator: "=" },
      { field: "limit", value: effectiveLimit },
    ], callback)
  ) as { QueryResponse?: { Attachable?: Array<{ Id?: string }> } };

  const ids = (queryResult.QueryResponse?.Attachable ?? [])
    .map((attachable) => attachable.Id)
    .filter((id): id is string => Boolean(id));
  const attachables = await mapWithConcurrency(ids, METADATA_CONCURRENCY, (id) =>
    getAttachable(client, id)
  );
  const metadata = attachables.map(safeMetadata);

  const lines = [
    `Attachments linked to ${entityType} #${args.entity_id}`,
    `Count: ${metadata.length}`,
  ];
  if (effectiveLimit < limit) {
    lines.push(`HTTP mode detail capped at ${HTTP_ATTACHMENT_LIMIT} attachments (requested ${limit}).`);
  }
  for (const item of metadata) {
    const label = item.fileName || item.note || "Note-only attachment";
    const size = item.size !== undefined ? `, ${(item.size / 1024).toFixed(1)} KB` : "";
    lines.push(`  ${item.id}: ${label}${item.contentType ? ` (${item.contentType}${size})` : ""}`);
  }
  if (metadata.length === 0) lines.push("  (none)");

  return asMCPToolResult(outputReport(
    `attachables-${entityType.toLowerCase()}-${args.entity_id}`,
    {
      entityType,
      entityId: args.entity_id,
      attachments: metadata,
      ...(effectiveLimit < limit && { detailCapped: true, requestedLimit: limit }),
    },
    lines.join("\n")
  ));
}

export async function handleReadAttachableContent(
  client: QuickBooks,
  args: { id: string; page_start?: number; page_count?: number }
): Promise<MCPToolResult> {
  validateQboEntityId(args.id);
  let attachable = await getAttachable(client, args.id);
  const expectedType = normalizeContentType(attachable.ContentType);

  if (!attachable.FileName || !expectedType) {
    if (attachable.Note) {
      return {
        content: [{
          type: "text",
          text: `Note-only Attachable ${attachable.Id}:\n\n${attachable.Note}`,
        }],
      };
    }
    return {
      content: [{ type: "text", text: `Attachable ${attachable.Id} has no readable file or note.` }],
      isError: true,
    };
  }
  const fileName = attachable.FileName;

  if (!IMAGE_TYPES.has(expectedType) && !TEXT_TYPES.has(expectedType) && expectedType !== PDF_TYPE) {
    return {
      content: [{
        type: "text",
        text: `Attachable ${attachable.Id} (${attachable.FileName}, ${expectedType}) cannot yet be read by Claude. Metadata remains available through get_attachable.`,
      }],
      isError: true,
    };
  }

  const maxBytes = TEXT_TYPES.has(expectedType)
    ? MAX_TEXT_BYTES
    : binaryReadLimit();
  if (attachable.Size !== undefined && attachable.Size > maxBytes) {
    const modeHint = isHttpMode() && !TEXT_TYPES.has(expectedType)
      ? " in inline/HTTP output mode; local users can disable QBO_INLINE_OUTPUT for files up to 10 MB"
      : "";
    throw new Error(
      `Attachable ${attachable.Id} is too large to read (${attachable.Size} bytes; max ${maxBytes}${modeHint})`
    );
  }

  const summary = `Attachable ${attachable.Id}: ${fileName} (${expectedType}, ${attachable.Size ?? "unknown"} bytes)`;

  if (expectedType === PDF_TYPE) {
    if (isLambdaMode()) {
      return {
        content: [{
          type: "text",
          text: `${summary}\n\nPDF visual reading is available through the local stdio qbo-mcp server; the Lambda transport returns metadata only.`,
        }],
        isError: true,
      };
    }

    const downloaded = await downloadAttachable(client, attachable, maxBytes);
    attachable = downloaded.attachable;
    if (!contentTypesCompatible(expectedType, normalizeContentType(downloaded.responseType))) {
      throw new Error(
        `Attachable content type mismatch: QBO metadata says ${expectedType}, download returned ${downloaded.responseType}`
      );
    }

    const { renderPdfPages } = await import("../../utils/pdf.js");
    const rendered = await renderPdfPages(downloaded.bytes, {
      pageStart: args.page_start,
      pageCount: args.page_count,
    });
    const firstPage = rendered.pages[0].page;
    const lastPage = rendered.pages[rendered.pages.length - 1].page;
    const remaining = rendered.pageCount - lastPage;
    return {
      content: [
        {
          type: "text",
          text: `${summary}\nRendered pages ${firstPage}-${lastPage} of ${rendered.pageCount}.` +
            (remaining > 0 ? ` Call again with page_start: ${lastPage + 1} to inspect later pages.` : ""),
        },
        ...rendered.pages.map((page) => ({
          type: "image" as const,
          data: page.data.toString("base64"),
          mimeType: "image/jpeg",
        })),
      ],
    };
  }

  const downloaded = await downloadAttachable(client, attachable, maxBytes);
  attachable = downloaded.attachable;
  if (!contentTypesCompatible(expectedType, normalizeContentType(downloaded.responseType))) {
    throw new Error(
      `Attachable content type mismatch: QBO metadata says ${expectedType}, download returned ${downloaded.responseType}`
    );
  }

  const downloadedSummary = `Attachable ${attachable.Id}: ${fileName} (${expectedType}, ${downloaded.bytes.length} bytes)`;

  if (IMAGE_TYPES.has(expectedType)) {
    return {
      content: [
        { type: "text", text: downloadedSummary },
        { type: "image", data: downloaded.bytes.toString("base64"), mimeType: expectedType },
      ],
    };
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(downloaded.bytes);
  } catch {
    throw new Error(`Attachable ${attachable.Id} is not valid UTF-8 text`);
  }
  return {
    content: [
      { type: "text", text: downloadedSummary },
      { type: "text", text: `Attachment content:\n\n${text}` },
    ],
  };
}
