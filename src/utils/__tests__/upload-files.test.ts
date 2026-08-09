import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../credentials/index.js", () => ({
  hasProfiles: vi.fn(),
  getActiveProfile: vi.fn(),
}));

import { getActiveProfile, hasProfiles } from "../../credentials/index.js";
import {
  MAX_UPLOAD_FILE_SIZE,
  getConfiguredUploadRoots,
  validateUploadFile,
} from "../upload-files.js";

const mockHasProfiles = vi.mocked(hasProfiles);
const mockGetActiveProfile = vi.mocked(getActiveProfile);

let tempRoot: string;
let invoicePath: string;

beforeEach(async () => {
  vi.restoreAllMocks();
  mockHasProfiles.mockReturnValue(false);
  mockGetActiveProfile.mockReturnValue(null);
  delete process.env.QBO_UPLOAD_ROOTS;
  tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "qbo-upload-test-"));
  invoicePath = path.join(tempRoot, "invoice.pdf");
  await fs.promises.writeFile(invoicePath, "%PDF-1.4\ntest invoice\n");
});

afterEach(async () => {
  delete process.env.QBO_UPLOAD_ROOTS;
  await fs.promises.rm(tempRoot, { recursive: true, force: true });
});

describe("getConfiguredUploadRoots", () => {
  it("uses active profile roots when profiles are configured", () => {
    mockHasProfiles.mockReturnValue(true);
    mockGetActiveProfile.mockReturnValue({
      mode: "local",
      upload_roots: [{ label: "AP", path: tempRoot }],
    });

    expect(getConfiguredUploadRoots()).toEqual([{ label: "AP", path: tempRoot }]);
  });

  it("uses platform-delimited environment roots only in single-company mode", () => {
    const secondRoot = path.join(tempRoot, "receipts");
    process.env.QBO_UPLOAD_ROOTS = [tempRoot, secondRoot].join(path.delimiter);

    expect(getConfiguredUploadRoots()).toEqual([
      { label: path.basename(tempRoot), path: tempRoot },
      { label: "receipts", path: secondRoot },
    ]);
  });

  it("rejects relative environment roots", () => {
    process.env.QBO_UPLOAD_ROOTS = "relative-folder";
    expect(() => getConfiguredUploadRoots()).toThrow("must be absolute");
  });
});

describe("validateUploadFile", () => {
  it("validates a supported absolute file", async () => {
    await expect(validateUploadFile(invoicePath)).resolves.toMatchObject({
      resolvedPath: await fs.promises.realpath(invoicePath),
      fileName: "invoice.pdf",
      contentType: "application/pdf",
    });
  });

  it("requires an absolute path", async () => {
    await expect(validateUploadFile("invoice.pdf")).rejects.toThrow("must be an absolute path");
  });

  it("enforces the active profile upload roots", async () => {
    const outsideRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "qbo-upload-outside-"));
    try {
      mockHasProfiles.mockReturnValue(true);
      mockGetActiveProfile.mockReturnValue({
        mode: "local",
        upload_roots: [{ label: "Other Business", path: outsideRoot }],
      });
      await expect(validateUploadFile(invoicePath)).rejects.toThrow(
        "outside the active QBO profile's upload roots"
      );
    } finally {
      await fs.promises.rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it("allows a file in any available configured root and returns its label", async () => {
    mockHasProfiles.mockReturnValue(true);
    mockGetActiveProfile.mockReturnValue({
      mode: "local",
      upload_roots: [
        { label: "Offline", path: path.join(tempRoot, "missing") },
        { label: "AP Invoices", path: tempRoot },
      ],
    });

    await expect(validateUploadFile(invoicePath)).resolves.toMatchObject({ rootLabel: "AP Invoices" });
  });

  it("rejects symbolic links", async () => {
    vi.spyOn(fs.promises, "lstat").mockResolvedValue({
      isSymbolicLink: () => true,
    } as fs.Stats);
    await expect(validateUploadFile(invoicePath)).rejects.toThrow("symbolic links cannot be uploaded");
  });

  it("rejects dotfiles and credential files", async () => {
    await expect(validateUploadFile(path.join(tempRoot, ".env"))).rejects.toThrow("dotfiles");
    await expect(validateUploadFile(path.join(tempRoot, "tokens.json"))).rejects.toThrow("credential/secret");
  });

  it("rejects unsupported extensions", async () => {
    const executablePath = path.join(tempRoot, "program.exe");
    await fs.promises.writeFile(executablePath, "not executable");
    await expect(validateUploadFile(executablePath)).rejects.toThrow("Unsupported attachment file type");
  });

  it("rejects empty and oversized files", async () => {
    const emptyPath = path.join(tempRoot, "empty.txt");
    await fs.promises.writeFile(emptyPath, "");
    await expect(validateUploadFile(emptyPath)).rejects.toThrow("File is empty");

    const realStat = fs.promises.stat.bind(fs.promises);
    vi.spyOn(fs.promises, "stat").mockImplementation(async (filePath) => {
      const stat = await realStat(filePath);
      Object.defineProperty(stat, "size", { value: MAX_UPLOAD_FILE_SIZE + 1 });
      return stat;
    });
    await expect(validateUploadFile(invoicePath)).rejects.toThrow("File too large");
  });
});
