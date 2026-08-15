// Handlers for attachable tools (create with file upload, get, edit)

import fs from "node:fs";
import QuickBooks from "node-quickbooks";
import { promisify } from "../../client/index.js";
import {
  formatQBOError,
  outputReport,
  validateUploadFile,
} from "../../utils/index.js";
import type { ValidatedUploadFile } from "../../utils/index.js";
import type { QBAttachable } from "../../types/index.js";
import type { QboRequestContext } from "../../runtime/types.js";
import {
  ATTACHABLE_CATEGORIES,
  canonicalizeAttachableEntityType,
  validateQboEntityId,
} from "../attachable-fields.js";
import { safeAttachableMetadata } from "./attachment-content.js";

function validateMetadata(note?: string, category?: string): void {
  if (note !== undefined && note.length > 2000) {
    throw new Error("note must be 2000 characters or fewer");
  }
  if (category !== undefined && !ATTACHABLE_CATEGORIES.includes(category as typeof ATTACHABLE_CATEGORIES[number])) {
    throw new Error(`category must be one of: ${ATTACHABLE_CATEGORIES.join(", ")}`);
  }
}

function validateEntityLink(
  entityType?: string,
  entityId?: string,
  includeOnSend?: boolean
): string | undefined {
  const hasEntityType = entityType !== undefined;
  const hasEntityId = entityId !== undefined;
  if (hasEntityType !== hasEntityId ||
      (hasEntityType && (!entityType?.trim() || !entityId?.trim()))) {
    throw new Error("entity_type and entity_id must be provided together");
  }
  if (includeOnSend !== undefined && (!entityType || !entityId)) {
    throw new Error("include_on_send requires entity_type and entity_id");
  }
  if (!entityType) return undefined;
  validateQboEntityId(entityId!);
  return canonicalizeAttachableEntityType(entityType);
}

export async function handleCreateAttachable(
  client: QuickBooks,
  args: {
    file_path?: string;
    note?: string;
    entity_type?: string;
    entity_id?: string;
    include_on_send?: boolean;
    category?: string;
    draft?: boolean;
  }
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const { file_path, note, entity_type, entity_id, include_on_send, category, draft = true } = args;

  if (!file_path && !note) {
    throw new Error("At least one of file_path or note is required.");
  }
  validateMetadata(note, category);
  const canonicalEntityType = validateEntityLink(entity_type, entity_id, include_on_send);

  // Validate file if provided
  let fileInfo: ValidatedUploadFile | undefined;
  if (file_path) {
    fileInfo = await validateUploadFile(file_path);
  }

  if (draft) {
    const preview: string[] = [
      "DRAFT - Attachable Preview",
      "",
    ];

    if (fileInfo) {
      preview.push(`File: ${fileInfo.fileName}`);
      preview.push(`Path: ${fileInfo.resolvedPath}`);
      if (fileInfo.rootLabel) preview.push(`Business Folder: ${fileInfo.rootLabel}`);
      preview.push(`Size: ${(fileInfo.size / 1024).toFixed(1)} KB`);
      preview.push(`Content Type: ${fileInfo.contentType}`);
    }
    if (note) preview.push(`Note: ${note}`);
    if (category) preview.push(`Category: ${category}`);
    if (canonicalEntityType && entity_id) {
      preview.push(`Linked to: ${canonicalEntityType} #${entity_id}`);
      if (include_on_send !== undefined) preview.push(`Include on Send: ${include_on_send}`);
    }
    preview.push("", "Set draft=false to create this attachable.");

    return { content: [{ type: "text", text: preview.join("\n") }] };
  }

  let result: QBAttachable;

  if (fileInfo) {
    // Always upload first without linking. The SDK's combined overload performs
    // a hidden second write, making partial success impossible to recover safely.
    const stream = fs.createReadStream(fileInfo.resolvedPath);
    try {
      result = (await promisify<unknown>((cb) =>
        client.upload(fileInfo.fileName, fileInfo.contentType, stream, cb)
      )) as QBAttachable;
    } catch (error) {
      stream.destroy();
      throw error;
    }

    // Apply linking and metadata in one controlled follow-up update.
    if (canonicalEntityType || note || category) {
      const updateObj: Record<string, unknown> = {
        Id: result.Id,
        SyncToken: result.SyncToken,
        sparse: true,
      };
      if (note) updateObj.Note = note;
      if (category) updateObj.Category = category;
      if (canonicalEntityType && entity_id) {
        updateObj.AttachableRef = [{
          EntityRef: { value: entity_id, type: canonicalEntityType },
          ...(include_on_send !== undefined && { IncludeOnSend: include_on_send }),
        }];
      }
      try {
        const updated = (await promisify<unknown>((cb) =>
          client.updateAttachable(updateObj, cb)
        )) as QBAttachable;
        result = { ...result, ...updated };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: [
              `File ${result.FileName || fileInfo.fileName} was uploaded as Attachable ${result.Id}, but linking or metadata update failed: ${formatQBOError(error)}.`,
              `Use edit_attachable with id=${result.Id} to finish the link or metadata update.`,
            ].join("\n"),
          }],
          isError: true,
        };
      }
    }
  } else {
    // Note-only attachable
    const attachableObj: Record<string, unknown> = {};
    if (note) attachableObj.Note = note;
    if (category) attachableObj.Category = category;

    if (canonicalEntityType && entity_id) {
      const ref: Record<string, unknown> = {
        EntityRef: { value: entity_id, type: canonicalEntityType },
      };
      if (include_on_send !== undefined) ref.IncludeOnSend = include_on_send;
      attachableObj.AttachableRef = [ref];
    }

    result = (await promisify<unknown>((cb) =>
      client.createAttachable(attachableObj, cb)
    )) as QBAttachable;
  }

  const response: string[] = [
    "Attachable Created!",
    "",
    `ID: ${result.Id}`,
  ];
  if (result.FileName) response.push(`File: ${result.FileName}`);
  if (result.Note) response.push(`Note: ${result.Note}`);
  if (result.ContentType) response.push(`Content Type: ${result.ContentType}`);
  if (result.Size) response.push(`Size: ${(result.Size / 1024).toFixed(1)} KB`);

  return { content: [{ type: "text", text: response.join("\n") }] };
}

export async function handleGetAttachable(
  client: QuickBooks,
  args: { id: string },
  context?: QboRequestContext
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { id } = args;

  const attachable = (await promisify<unknown>((cb) =>
    client.getAttachable(id, cb)
  )) as QBAttachable;
  const metadata = safeAttachableMetadata(attachable);

  const lines: string[] = [
    "Attachable",
    "==========",
    `ID: ${metadata.id}`,
    `SyncToken: ${metadata.syncToken}`,
  ];

  if (metadata.fileName) lines.push(`File Name: ${metadata.fileName}`);
  if (metadata.contentType) lines.push(`Content Type: ${metadata.contentType}`);
  if (metadata.size != null) lines.push(`Size: ${(metadata.size / 1024).toFixed(1)} KB`);
  if (metadata.note) lines.push(`Note: ${metadata.note}`);
  if (metadata.category) lines.push(`Category: ${metadata.category}`);

  if (metadata.linkedEntities.length > 0) {
    lines.push("", "Linked Entities:");
    for (const entity of metadata.linkedEntities) {
      lines.push(`  ${entity.type || "Unknown"} #${entity.id}${entity.name ? ` (${entity.name})` : ""}`);
      if (entity.includeOnSend) lines.push("    Include on Send: true");
    }
  }

  if (metadata.createdAt) lines.push(`Created: ${metadata.createdAt}`);
  if (metadata.updatedAt) lines.push(`Last Updated: ${metadata.updatedAt}`);

  return outputReport(`attachable-${metadata.id}`, metadata, lines.join("\n"), context?.output);
}

export async function handleEditAttachable(
  client: QuickBooks,
  args: {
    id: string;
    note?: string;
    category?: string;
    entity_type?: string;
    entity_id?: string;
    include_on_send?: boolean;
    draft?: boolean;
  }
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { id, note, category, entity_type, entity_id, include_on_send, draft = true } = args;

  validateMetadata(note, category);
  const canonicalEntityType = validateEntityLink(entity_type, entity_id, include_on_send);
  if (note === undefined && category === undefined && !canonicalEntityType) {
    throw new Error("At least one attachable change is required");
  }

  // Fetch current
  const current = (await promisify<unknown>((cb) =>
    client.getAttachable(id, cb)
  )) as QBAttachable;

  // Build sparse update
  const updated: Record<string, unknown> = {
    Id: current.Id,
    SyncToken: current.SyncToken,
    sparse: true,
  };

  if (note !== undefined) updated.Note = note;
  if (category !== undefined) updated.Category = category;

  // Update entity link if provided — replaces entire AttachableRef array
  // (QBO sparse updates replace arrays, consistent with Line edits in other handlers)
  if (canonicalEntityType && entity_id) {
    const ref: Record<string, unknown> = {
      EntityRef: { value: entity_id, type: canonicalEntityType },
    };
    if (include_on_send !== undefined) ref.IncludeOnSend = include_on_send;

    updated.AttachableRef = [ref];
  }

  if (draft) {
    const previewLines: string[] = [
      "DRAFT - Attachable Edit Preview",
      "",
      `ID: ${id}`,
      `SyncToken: ${current.SyncToken}`,
    ];
    if (current.FileName) previewLines.push(`File: ${current.FileName}`);
    previewLines.push("", "Changes:");

    if (note !== undefined)
      previewLines.push(`  Note: ${current.Note || "(none)"} → ${note}`);
    if (category !== undefined)
      previewLines.push(`  Category: ${current.Category || "(none)"} → ${category}`);
    if (canonicalEntityType && entity_id) {
      const existingCount = current.AttachableRef?.length || 0;
      const label = existingCount > 0
        ? `  Link: → ${canonicalEntityType} #${entity_id} (replaces ${existingCount} existing link${existingCount > 1 ? 's' : ''})`
        : `  Link: → ${canonicalEntityType} #${entity_id}`;
      previewLines.push(label);
    }

    previewLines.push("", "Set draft=false to apply changes.");

    return { content: [{ type: "text", text: previewLines.join("\n") }] };
  }

  const result = (await promisify<unknown>((cb) =>
    client.updateAttachable(updated, cb)
  )) as QBAttachable;

  const response: string[] = [
    "Attachable Updated!",
    "",
    `ID: ${result.Id}`,
  ];
  if (result.FileName) response.push(`File: ${result.FileName}`);
  if (result.Note) response.push(`Note: ${result.Note}`);

  return { content: [{ type: "text", text: response.join("\n") }] };
}
