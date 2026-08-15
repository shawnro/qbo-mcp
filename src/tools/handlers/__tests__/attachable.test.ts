import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "node:fs";
import {
  createMockClient,
  mockError,
  mockSuccess,
  resetMockClient,
  mockPromisify,
} from "../../../__mocks__/mock-client.js";

vi.mock("../../../client/index.js", () => ({
  promisify: mockPromisify,
  getClient: vi.fn(),
  clearCredentialsCache: vi.fn(),
  refreshTokens: vi.fn(),
  isAuthError: vi.fn(),
  clearLookupCache: vi.fn(),
  getCompanyIdValue: vi.fn(),
}));

vi.mock("../../../utils/index.js", async () => {
  const actual = await vi.importActual<typeof import("../../../utils/index.js")>(
    "../../../utils/index.js"
  );
  return { ...actual, validateUploadFile: vi.fn() };
});

import {
  handleCreateAttachable,
  handleGetAttachable,
  handleEditAttachable,
} from "../attachable.js";
import { validateUploadFile } from "../../../utils/index.js";

const mockValidateUploadFile = vi.mocked(validateUploadFile);

describe("handleCreateAttachable", () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
    resetMockClient(client);
    vi.clearAllMocks();
    mockValidateUploadFile.mockImplementation(async (filePath: string) => {
      const fileName = filePath.split(/[\\/]/).pop() || "attachment.txt";
      const extension = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
      const contentType = extension === ".pdf"
        ? "application/pdf"
        : extension === ".png"
          ? "image/png"
          : "text/plain";
      return { resolvedPath: filePath, fileName, size: 1024, contentType };
    });
  });

  it("throws when neither file_path nor note provided", async () => {
    await expect(
      handleCreateAttachable(client as never, {})
    ).rejects.toThrow("At least one of file_path or note is required");
  });

  it("creates note-only attachable when draft=false", async () => {
    mockSuccess(client.createAttachable, {
      Id: "200",
      Note: "Important memo",
    });

    const result = await handleCreateAttachable(client as never, {
      note: "Important memo",
      draft: false,
    });

    expect(client.createAttachable).toHaveBeenCalledOnce();
    const payload = client.createAttachable.mock.calls[0][0];
    expect(payload.Note).toBe("Important memo");
    expect(result.content[0].text).toContain("Attachable Created");
    expect(result.content[0].text).toContain("200");
  });

  it("returns preview for note-only in draft mode", async () => {
    const result = await handleCreateAttachable(client as never, {
      note: "Draft note",
    });

    expect(result.content[0].text).toContain("DRAFT");
    expect(result.content[0].text).toContain("Draft note");
    expect(client.createAttachable).not.toHaveBeenCalled();
  });

  it("includes entity link in note-only attachable", async () => {
    mockSuccess(client.createAttachable, { Id: "201", Note: "Receipt" });

    await handleCreateAttachable(client as never, {
      note: "Receipt",
      entity_type: "Invoice",
      entity_id: "55",
      include_on_send: true,
      draft: false,
    });

    const payload = client.createAttachable.mock.calls[0][0];
    expect(payload.AttachableRef).toEqual([
      {
        EntityRef: { value: "55", type: "Invoice" },
        IncludeOnSend: true,
      },
    ]);
  });

  it("uploads file when file_path provided and draft=false", async () => {
    // Mock fs operations
    vi.spyOn(fs.promises, "stat").mockResolvedValue({
      isFile: () => true,
      size: 1024,
    } as fs.Stats);
    vi.spyOn(fs.promises, "access").mockResolvedValue(undefined);
    vi.spyOn(fs, "createReadStream").mockReturnValue("mock-stream" as unknown as fs.ReadStream);

    mockSuccess(client.upload, {
      Id: "202",
      FileName: "receipt.pdf",
      ContentType: "application/pdf",
      Size: 1024,
    });

    const result = await handleCreateAttachable(client as never, {
      file_path: "/tmp/receipt.pdf",
      draft: false,
    });

    expect(client.upload).toHaveBeenCalledOnce();
    const uploadArgs = client.upload.mock.calls[0];
    expect(uploadArgs[0]).toBe("receipt.pdf");
    expect(uploadArgs[1]).toBe("application/pdf");
    expect(uploadArgs[2]).toBe("mock-stream");
    // Without entity_type, callback is passed as 4th arg (no empty strings)
    expect(uploadArgs[3]).toBeTypeOf("function");
    expect(uploadArgs).toHaveLength(4);
    expect(result.content[0].text).toContain("Attachable Created");
    expect(result.content[0].text).toContain("receipt.pdf");
  });

  it("uploads file with entity linking when entity_type provided", async () => {
    vi.spyOn(fs.promises, "stat").mockResolvedValue({
      isFile: () => true,
      size: 1024,
    } as fs.Stats);
    vi.spyOn(fs.promises, "access").mockResolvedValue(undefined);
    vi.spyOn(fs, "createReadStream").mockReturnValue("mock-stream" as unknown as fs.ReadStream);

    mockSuccess(client.upload, {
      Id: "204",
      SyncToken: "0",
      FileName: "invoice.pdf",
      ContentType: "application/pdf",
      Size: 1024,
    });
    mockSuccess(client.updateAttachable, {
      Id: "204",
      SyncToken: "1",
      FileName: "invoice.pdf",
      AttachableRef: [{
        EntityRef: { value: "77", type: "Bill" },
        IncludeOnSend: true,
      }],
    });

    await handleCreateAttachable(client as never, {
      file_path: "/tmp/invoice.pdf",
      entity_type: "Bill",
      entity_id: "77",
      include_on_send: true,
      draft: false,
    });

    expect(client.upload).toHaveBeenCalledOnce();
    const uploadArgs = client.upload.mock.calls[0];
    expect(uploadArgs[0]).toBe("invoice.pdf");
    expect(uploadArgs[1]).toBe("application/pdf");
    expect(uploadArgs[2]).toBe("mock-stream");
    expect(uploadArgs[3]).toBeTypeOf("function");
    expect(uploadArgs).toHaveLength(4);
    expect(client.updateAttachable.mock.calls[0][0]).toMatchObject({
      Id: "204",
      SyncToken: "0",
      sparse: true,
      AttachableRef: [{
        EntityRef: { value: "77", type: "Bill" },
        IncludeOnSend: true,
      }],
    });
  });

  it("updates note after file upload", async () => {
    vi.spyOn(fs.promises, "stat").mockResolvedValue({
      isFile: () => true,
      size: 512,
    } as fs.Stats);
    vi.spyOn(fs.promises, "access").mockResolvedValue(undefined);
    vi.spyOn(fs, "createReadStream").mockReturnValue("mock-stream" as unknown as fs.ReadStream);

    mockSuccess(client.upload, { Id: "203", SyncToken: "0", FileName: "doc.pdf" });
    mockSuccess(client.updateAttachable, {
      Id: "203",
      SyncToken: "1",
      FileName: "doc.pdf",
      Note: "My receipt",
    });

    const result = await handleCreateAttachable(client as never, {
      file_path: "/tmp/doc.pdf",
      note: "My receipt",
      draft: false,
    });

    expect(client.upload).toHaveBeenCalledOnce();
    expect(client.updateAttachable).toHaveBeenCalledOnce();
    const updatePayload = client.updateAttachable.mock.calls[0][0];
    expect(updatePayload.Note).toBe("My receipt");
    expect(result.content[0].text).toContain("My receipt");
  });

  it("shows file info in draft preview", async () => {
    vi.spyOn(fs.promises, "stat").mockResolvedValue({
      isFile: () => true,
      size: 2048,
    } as fs.Stats);
    vi.spyOn(fs.promises, "access").mockResolvedValue(undefined);

    const result = await handleCreateAttachable(client as never, {
      file_path: "/tmp/photo.png",
      note: "A photo",
    });

    expect(result.content[0].text).toContain("DRAFT");
    expect(result.content[0].text).toContain("photo.png");
    expect(result.content[0].text).toContain("image/png");
    expect(result.content[0].text).toContain("A photo");
    expect(client.upload).not.toHaveBeenCalled();
  });

  it("throws for non-existent file", async () => {
    mockValidateUploadFile.mockRejectedValue(new Error("File not found: /no/such/file.pdf"));

    await expect(
      handleCreateAttachable(client as never, {
        file_path: "/no/such/file.pdf",
        draft: false,
      })
    ).rejects.toThrow("File not found");
  });

  it("throws for file exceeding size limit", async () => {
    mockValidateUploadFile.mockRejectedValue(new Error("File too large: 200.0 MB (max 100 MB)"));

    await expect(
      handleCreateAttachable(client as never, {
        file_path: "/tmp/huge.pdf",
        draft: false,
      })
    ).rejects.toThrow("File too large");
  });

  it("throws for dotfiles", async () => {
    mockValidateUploadFile.mockRejectedValue(new Error("Blocked: dotfiles cannot be uploaded (.env)"));
    await expect(
      handleCreateAttachable(client as never, {
        file_path: "/home/user/.env",
        draft: false,
      })
    ).rejects.toThrow("Blocked: dotfiles cannot be uploaded");
  });

  it("throws for credential files", async () => {
    mockValidateUploadFile.mockRejectedValue(new Error("Blocked: credential/secret files cannot be uploaded (tokens.json)"));
    await expect(
      handleCreateAttachable(client as never, {
        file_path: "/home/user/tokens.json",
        draft: false,
      })
    ).rejects.toThrow("Blocked: credential/secret files cannot be uploaded");
  });

  it("throws for files in dotfile directories", async () => {
    mockValidateUploadFile.mockRejectedValue(new Error("Blocked: dotfiles cannot be uploaded (id_rsa)"));
    await expect(
      handleCreateAttachable(client as never, {
        file_path: "/home/user/.ssh/id_rsa",
        draft: false,
      })
    ).rejects.toThrow("Blocked: dotfiles cannot be uploaded");
  });

  it("returns non-retriable partial success when linking fails after upload", async () => {
    vi.spyOn(fs, "createReadStream").mockReturnValue("mock-stream" as unknown as fs.ReadStream);
    mockSuccess(client.upload, {
      Id: "205",
      SyncToken: "0",
      FileName: "invoice.pdf",
    });
    mockError(client.updateAttachable, "Unauthorized while linking");

    const result = await handleCreateAttachable(client as never, {
      file_path: "/tmp/invoice.pdf",
      entity_type: "Bill",
      entity_id: "77",
      draft: false,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("uploaded as Attachable 205");
    expect(result.content[0].text).toContain("Use edit_attachable");
    expect(client.upload).toHaveBeenCalledOnce();
  });

  it("destroys the read stream when upload fails", async () => {
    const stream = { destroy: vi.fn() } as unknown as fs.ReadStream;
    vi.spyOn(fs, "createReadStream").mockReturnValue(stream);
    mockError(client.upload, "Upload failed");

    await expect(handleCreateAttachable(client as never, {
      file_path: "/tmp/invoice.pdf",
      draft: false,
    })).rejects.toThrow("Upload failed");
    expect(stream.destroy).toHaveBeenCalledOnce();
  });

  it("requires entity_type and entity_id together", async () => {
    await expect(handleCreateAttachable(client as never, {
      note: "Invoice note",
      entity_type: "Bill",
    })).rejects.toThrow("entity_type and entity_id must be provided together");
    await expect(handleCreateAttachable(client as never, {
      note: "Invoice note",
      entity_id: "77",
    })).rejects.toThrow("entity_type and entity_id must be provided together");
    await expect(handleCreateAttachable(client as never, {
      note: "Invoice note",
      entity_type: "",
      entity_id: "",
    })).rejects.toThrow("entity_type and entity_id must be provided together");
  });

  it("requires a numeric QBO entity ID", async () => {
    await expect(handleCreateAttachable(client as never, {
      note: "Invoice note",
      entity_type: "Bill",
      entity_id: "not-an-id",
    })).rejects.toThrow("entity_id must be a numeric QBO entity ID");
  });

  it("validates note length and category", async () => {
    await expect(handleCreateAttachable(client as never, {
      note: "N".repeat(2001),
    })).rejects.toThrow("note must be 2000 characters or fewer");
    await expect(handleCreateAttachable(client as never, {
      note: "Invoice",
      category: "document",
    })).rejects.toThrow("category must be one of");
  });
});

describe("handleGetAttachable", () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
    resetMockClient(client);
  });

  it("returns attachable details with file info", async () => {
    mockSuccess(client.getAttachable, {
      Id: "200",
      SyncToken: "1",
      FileName: "receipt.pdf",
      ContentType: "application/pdf",
      Size: 15360,
      TempDownloadUri: "https://example.com/download/200",
      ThumbnailTempDownloadUri: "https://example.com/thumbnail/200",
      FileAccessUri: "https://example.com/file/200",
      Note: "Receipt for lunch",
      Category: "Receipt",
      AttachableRef: [
        {
          EntityRef: { value: "42", type: "Purchase", name: "Office Supplies" },
          IncludeOnSend: false,
        },
      ],
      MetaData: { CreateTime: "2024-01-15", LastUpdatedTime: "2024-01-15" },
    });

    const context = {
      output: { mode: "http", executionEnvironment: "local" },
    } as never;
    const result = await handleGetAttachable(client as never, { id: "200" }, context);
    const text = result.content[0].text;
    const completeOutput = result.content.map((item) => item.text).join("\n");

    expect(text).toContain("receipt.pdf");
    expect(text).toContain("application/pdf");
    expect(text).toContain("15.0 KB");
    expect(text).toContain("Receipt for lunch");
    expect(text).toContain("Category: Receipt");
    expect(text).toContain("Purchase #42");
    expect(text).toContain("SyncToken: 1");
    expect(completeOutput).not.toContain("Download URL");
    expect(completeOutput).not.toContain("example.com");
    expect(completeOutput).not.toContain("TempDownloadUri");
    expect(completeOutput).not.toContain("ThumbnailTempDownloadUri");
    expect(completeOutput).not.toContain("FileAccessUri");
  });

  it("returns note-only attachable", async () => {
    mockSuccess(client.getAttachable, {
      Id: "201",
      SyncToken: "0",
      Note: "Standalone note",
    });

    const result = await handleGetAttachable(client as never, { id: "201" });

    expect(result.content[0].text).toContain("Standalone note");
    expect(result.content[0].text).not.toContain("File Name:");
  });
});

describe("handleEditAttachable", () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
    resetMockClient(client);
    vi.clearAllMocks();
  });

  it("returns preview in draft mode", async () => {
    mockSuccess(client.getAttachable, {
      Id: "200",
      SyncToken: "1",
      FileName: "receipt.pdf",
      Note: "Old note",
    });

    const result = await handleEditAttachable(client as never, {
      id: "200",
      note: "New note",
    });

    expect(result.content[0].text).toContain("DRAFT");
    expect(result.content[0].text).toContain("Old note → New note");
    expect(client.updateAttachable).not.toHaveBeenCalled();
  });

  it("rejects an edit with no changes before reading QBO", async () => {
    await expect(handleEditAttachable(client as never, { id: "200" }))
      .rejects.toThrow("At least one attachable change is required");
    expect(client.getAttachable).not.toHaveBeenCalled();
  });

  it("applies sparse update when draft=false", async () => {
    mockSuccess(client.getAttachable, {
      Id: "200",
      SyncToken: "1",
      Note: "Old note",
    });
    mockSuccess(client.updateAttachable, {
      Id: "200",
      Note: "New note",
    });

    const result = await handleEditAttachable(client as never, {
      id: "200",
      note: "New note",
      draft: false,
    });

    const payload = client.updateAttachable.mock.calls[0][0];
    expect(payload.Id).toBe("200");
    expect(payload.SyncToken).toBe("1");
    expect(payload.Note).toBe("New note");
    expect(payload.sparse).toBe(true);
    expect(result.content[0].text).toContain("Attachable Updated");
  });

  it("adds entity link", async () => {
    mockSuccess(client.getAttachable, {
      Id: "200",
      SyncToken: "0",
      AttachableRef: [],
    });
    mockSuccess(client.updateAttachable, {
      Id: "200",
      Note: "",
    });

    await handleEditAttachable(client as never, {
      id: "200",
      entity_type: "Bill",
      entity_id: "99",
      draft: false,
    });

    const payload = client.updateAttachable.mock.calls[0][0];
    expect(payload.AttachableRef).toEqual([
      { EntityRef: { value: "99", type: "Bill" } },
    ]);
  });

  it("replaces existing refs instead of appending", async () => {
    mockSuccess(client.getAttachable, {
      Id: "200",
      SyncToken: "2",
      AttachableRef: [
        { EntityRef: { value: "50", type: "Invoice" }, IncludeOnSend: true },
        { EntityRef: { value: "51", type: "Purchase" } },
      ],
    });
    mockSuccess(client.updateAttachable, { Id: "200" });

    await handleEditAttachable(client as never, {
      id: "200",
      entity_type: "Bill",
      entity_id: "99",
      draft: false,
    });

    const payload = client.updateAttachable.mock.calls[0][0];
    // Should replace, not append to existing refs
    expect(payload.AttachableRef).toEqual([
      { EntityRef: { value: "99", type: "Bill" } },
    ]);
    expect(payload.AttachableRef).toHaveLength(1);
  });
});
