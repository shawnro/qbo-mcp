// Handlers for attachable tools (create with file upload, get, edit)

import fs from "node:fs";
import path from "node:path";
import QuickBooks from "node-quickbooks";
import { promisify } from "../../client/index.js";
import { outputReport } from "../../utils/index.js";

interface QBAttachable {
  Id: string;
  SyncToken: string;
  FileName?: string;
  FileAccessUri?: string;
  TempDownloadUri?: string;
  Size?: number;
  ContentType?: string;
  Category?: string;
  Lat?: string;
  Long?: string;
  PlaceName?: string;
  Note?: string;
  Tag?: string;
  ThumbnailFileAccessUri?: string;
  ThumbnailTempDownloadUri?: string;
  AttachableRef?: Array<{
    EntityRef?: { value: string; type?: string; name?: string };
    IncludeOnSend?: boolean;
  }>;
  MetaData?: { CreateTime?: string; LastUpdatedTime?: string };
}

const MIME_MAP: Record<string, string> = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".csv": "text/csv",
  ".txt": "text/plain",
  ".rtf": "application/rtf",
  ".xml": "application/xml",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".ods": "application/vnd.oasis.opendocument.spreadsheet",
  ".eps": "application/postscript",
  ".ai": "application/postscript",
};

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB

function detectContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_MAP[ext] || "application/octet-stream";
}

async function validateFilePath(filePath: string): Promise<{ resolvedPath: string; size: number }> {
  const resolvedPath = path.resolve(filePath);

  // Block dotfiles and credential files (prevent leaking secrets to QBO)
  const basename = path.basename(resolvedPath);
  const segments = resolvedPath.split(path.sep);
  if (basename.startsWith('.') || segments.some(s => s.startsWith('.') && s !== '.' && s !== '..')) {
    throw new Error(`Blocked: dotfiles cannot be uploaded (${basename})`);
  }
  const blockedNames = ['tokens.json', 'credentials.json', 'temp-creds.json'];
  const blockedExts = ['.env', '.pem', '.key'];
  if (blockedNames.includes(basename.toLowerCase()) ||
      blockedExts.some(ext => basename.toLowerCase().endsWith(ext))) {
    throw new Error(`Blocked: credential/secret files cannot be uploaded (${basename})`);
  }

  // Check existence
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(resolvedPath);
  } catch {
    throw new Error(`File not found: ${resolvedPath}`);
  }

  // Must be a file
  if (!stat.isFile()) {
    throw new Error(`Not a file: ${resolvedPath}`);
  }

  // Check readable
  try {
    await fs.promises.access(resolvedPath, fs.constants.R_OK);
  } catch {
    throw new Error(`File not readable: ${resolvedPath}`);
  }

  // Size check
  if (stat.size > MAX_FILE_SIZE) {
    throw new Error(
      `File too large: ${(stat.size / 1024 / 1024).toFixed(1)} MB (max ${MAX_FILE_SIZE / 1024 / 1024} MB)`
    );
  }

  if (stat.size === 0) {
    throw new Error(`File is empty: ${resolvedPath}`);
  }

  return { resolvedPath, size: stat.size };
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
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { file_path, note, entity_type, entity_id, include_on_send, category, draft = true } = args;

  if (!file_path && !note) {
    throw new Error("At least one of file_path or note is required.");
  }

  // Validate file if provided
  let fileInfo: { resolvedPath: string; size: number } | undefined;
  let contentType: string | undefined;
  let fileName: string | undefined;
  if (file_path) {
    fileInfo = await validateFilePath(file_path);
    contentType = detectContentType(fileInfo.resolvedPath);
    fileName = path.basename(fileInfo.resolvedPath);
  }

  if (draft) {
    const preview: string[] = [
      "DRAFT - Attachable Preview",
      "",
    ];

    if (fileInfo) {
      preview.push(`File: ${fileName}`);
      preview.push(`Path: ${fileInfo.resolvedPath}`);
      preview.push(`Size: ${(fileInfo.size / 1024).toFixed(1)} KB`);
      preview.push(`Content Type: ${contentType}`);
    }
    if (note) preview.push(`Note: ${note}`);
    if (category) preview.push(`Category: ${category}`);
    if (entity_type && entity_id) {
      preview.push(`Linked to: ${entity_type} #${entity_id}`);
      if (include_on_send !== undefined) preview.push(`Include on Send: ${include_on_send}`);
    }
    preview.push("", "Set draft=false to create this attachable.");

    return { content: [{ type: "text", text: preview.join("\n") }] };
  }

  let result: QBAttachable;

  if (fileInfo) {
    // File upload via node-quickbooks upload()
    // upload() signature is overloaded: if the entityType param is a function,
    // it's treated as the callback and no entity linking occurs. If entityType
    // is a string (even empty ""), upload() calls updateAttachable() to create
    // an EntityRef — passing empty string would write a malformed ref into QBO.
    const stream = fs.createReadStream(fileInfo.resolvedPath);
    if (entity_type && entity_id) {
      // Upload and link to entity (upload does internal updateAttachable)
      result = (await promisify<unknown>((cb) =>
        client.upload(fileName!, contentType!, stream, entity_type, entity_id, cb)
      )) as QBAttachable;
    } else {
      // Upload without entity linking — pass callback in entityType position
      result = (await promisify<unknown>((cb) =>
        (client as any).upload(fileName!, contentType!, stream, cb)
      )) as QBAttachable;
    }

    // If note or category provided, update the attachable to add them
    if (note || category) {
      const updateObj: Record<string, unknown> = {
        Id: result.Id,
        SyncToken: result.SyncToken,
        sparse: true,
      };
      if (note) updateObj.Note = note;
      if (category) updateObj.Category = category;
      result = (await promisify<unknown>((cb) =>
        client.updateAttachable(updateObj, cb)
      )) as QBAttachable;
    }
  } else {
    // Note-only attachable
    const attachableObj: Record<string, unknown> = {};
    if (note) attachableObj.Note = note;
    if (category) attachableObj.Category = category;

    if (entity_type && entity_id) {
      const ref: Record<string, unknown> = {
        EntityRef: { value: entity_id, type: entity_type },
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
  args: { id: string }
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { id } = args;

  const attachable = (await promisify<unknown>((cb) =>
    client.getAttachable(id, cb)
  )) as QBAttachable;

  const lines: string[] = [
    "Attachable",
    "==========",
    `ID: ${attachable.Id}`,
    `SyncToken: ${attachable.SyncToken}`,
  ];

  if (attachable.FileName) lines.push(`File Name: ${attachable.FileName}`);
  if (attachable.ContentType) lines.push(`Content Type: ${attachable.ContentType}`);
  if (attachable.Size != null) lines.push(`Size: ${(attachable.Size / 1024).toFixed(1)} KB`);
  if (attachable.Note) lines.push(`Note: ${attachable.Note}`);
  if (attachable.Category) lines.push(`Category: ${attachable.Category}`);

  if (attachable.TempDownloadUri) {
    lines.push(`Download URL: ${attachable.TempDownloadUri}`);
  }

  if (attachable.AttachableRef && attachable.AttachableRef.length > 0) {
    lines.push("", "Linked Entities:");
    for (const ref of attachable.AttachableRef) {
      if (ref.EntityRef) {
        const entity = ref.EntityRef;
        lines.push(`  ${entity.type || "Unknown"} #${entity.value}${entity.name ? ` (${entity.name})` : ""}`);
        if (ref.IncludeOnSend) lines.push("    Include on Send: true");
      }
    }
  }

  if (attachable.MetaData) {
    if (attachable.MetaData.CreateTime)
      lines.push(`Created: ${attachable.MetaData.CreateTime}`);
    if (attachable.MetaData.LastUpdatedTime)
      lines.push(`Last Updated: ${attachable.MetaData.LastUpdatedTime}`);
  }

  return outputReport(`attachable-${attachable.Id}`, attachable, lines.join("\n"));
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
  if (entity_type && entity_id) {
    const ref: Record<string, unknown> = {
      EntityRef: { value: entity_id, type: entity_type },
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
    if (entity_type && entity_id) {
      const existingCount = current.AttachableRef?.length || 0;
      const label = existingCount > 0
        ? `  Link: → ${entity_type} #${entity_id} (replaces ${existingCount} existing link${existingCount > 1 ? 's' : ''})`
        : `  Link: → ${entity_type} #${entity_id}`;
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
