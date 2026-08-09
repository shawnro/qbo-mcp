import fs from "node:fs";
import path from "node:path";
import { getActiveProfile, hasProfiles } from "../credentials/index.js";
import type { QBUploadRoot } from "../credentials/index.js";

export const MAX_UPLOAD_FILE_SIZE = 100 * 1024 * 1024;

const MIME_MAP: Record<string, string> = {
  ".ai": "application/postscript",
  ".csv": "text/csv",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".eps": "application/postscript",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".ods": "application/vnd.oasis.opendocument.spreadsheet",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".rtf": "text/rtf",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".txt": "text/plain",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xml": "text/xml",
};

const BLOCKED_NAMES = new Set([
  "credentials.json",
  "temp-creds.json",
  "tokens.json",
]);
const BLOCKED_EXTENSIONS = [".env", ".key", ".p12", ".pem", ".pfx"];

export interface ValidatedUploadFile {
  resolvedPath: string;
  fileName: string;
  size: number;
  contentType: string;
  rootLabel?: string;
}

export function getConfiguredUploadRoots(): QBUploadRoot[] {
  if (hasProfiles()) {
    return getActiveProfile()?.upload_roots ?? [];
  }

  const raw = process.env.QBO_UPLOAD_ROOTS;
  if (!raw) return [];
  return raw
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((rootPath, index) => {
      if (!path.isAbsolute(rootPath)) {
        throw new Error(`QBO_UPLOAD_ROOTS entry must be absolute: ${rootPath}`);
      }
      return {
        label: path.basename(path.normalize(rootPath)) || `Upload root ${index + 1}`,
        path: rootPath,
      };
    });
}

function isPathInside(rootPath: string, filePath: string): boolean {
  const relative = path.relative(rootPath, filePath);
  return relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function assertSafeName(filePath: string): void {
  const segments = path.normalize(filePath).split(path.sep);
  const fileName = path.basename(filePath);
  const lowerName = fileName.toLowerCase();

  if (segments.some((segment) => segment.startsWith(".") && segment !== "." && segment !== "..")) {
    throw new Error(`Blocked: dotfiles cannot be uploaded (${fileName})`);
  }
  if (BLOCKED_NAMES.has(lowerName) || BLOCKED_EXTENSIONS.some((extension) => lowerName.endsWith(extension))) {
    throw new Error(`Blocked: credential/secret files cannot be uploaded (${fileName})`);
  }
  if (fileName.length > 1000) {
    throw new Error("File name must be 1000 characters or fewer");
  }
}

export async function validateUploadFile(filePath: string): Promise<ValidatedUploadFile> {
  if (!path.isAbsolute(filePath)) {
    throw new Error("file_path must be an absolute path on the computer running qbo-mcp");
  }

  const requestedPath = path.resolve(filePath);
  assertSafeName(requestedPath);

  let fileStat: fs.Stats;
  try {
    fileStat = await fs.promises.lstat(requestedPath);
  } catch {
    throw new Error(`File not found: ${requestedPath}`);
  }
  if (fileStat.isSymbolicLink()) {
    throw new Error(`Blocked: symbolic links cannot be uploaded (${path.basename(requestedPath)})`);
  }
  if (!fileStat.isFile()) {
    throw new Error(`Not a file: ${requestedPath}`);
  }

  let resolvedPath: string;
  let resolvedStat: fs.Stats;
  try {
    resolvedPath = await fs.promises.realpath(requestedPath);
    await fs.promises.access(resolvedPath, fs.constants.R_OK);
    resolvedStat = await fs.promises.stat(resolvedPath);
  } catch {
    throw new Error(`File not readable: ${requestedPath}`);
  }
  assertSafeName(resolvedPath);

  const roots = getConfiguredUploadRoots();
  let rootLabel: string | undefined;
  if (roots.length > 0) {
    const availableRoots: Array<{ label: string; path: string }> = [];
    for (const root of roots) {
      try {
        const rootPath = await fs.promises.realpath(root.path);
        const rootStat = await fs.promises.stat(rootPath);
        if (rootStat.isDirectory()) {
          availableRoots.push({ label: root.label, path: rootPath });
        }
      } catch {
        // An offline or unavailable configured root should not block other roots.
      }
    }
    const matchedRoot = availableRoots.find((root) => isPathInside(root.path, resolvedPath));
    if (!matchedRoot) {
      throw new Error(
        `File is outside the active QBO profile's upload roots. Allowed roots: ${roots.map((root) => root.label).join(", ")}`
      );
    }
    rootLabel = matchedRoot.label;
  }

  const extension = path.extname(resolvedPath).toLowerCase();
  const contentType = MIME_MAP[extension];
  if (!contentType) {
    throw new Error(
      `Unsupported attachment file type "${extension || "(none)"}". ` +
      `Allowed extensions: ${Object.keys(MIME_MAP).join(", ")}`
    );
  }

  if (resolvedStat.size > MAX_UPLOAD_FILE_SIZE) {
    throw new Error(
      `File too large: ${(resolvedStat.size / 1024 / 1024).toFixed(1)} MB ` +
      `(max ${MAX_UPLOAD_FILE_SIZE / 1024 / 1024} MB)`
    );
  }
  if (resolvedStat.size === 0) {
    throw new Error(`File is empty: ${resolvedPath}`);
  }

  return {
    resolvedPath,
    fileName: path.basename(resolvedPath),
    size: resolvedStat.size,
    contentType,
    rootLabel,
  };
}
