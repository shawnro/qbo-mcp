import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "node:fs";
import {
  createMockClient,
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
  return { ...actual };
});

import {
  handleCreateAttachable,
  handleGetAttachable,
  handleEditAttachable,
} from "../attachable.js";

describe("handleCreateAttachable", () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
    resetMockClient(client);
    vi.clearAllMocks();
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
      FileName: "invoice.pdf",
      ContentType: "application/pdf",
      Size: 1024,
    });

    await handleCreateAttachable(client as never, {
      file_path: "/tmp/invoice.pdf",
      entity_type: "Bill",
      entity_id: "77",
      draft: false,
    });

    expect(client.upload).toHaveBeenCalledOnce();
    const uploadArgs = client.upload.mock.calls[0];
    expect(uploadArgs[0]).toBe("invoice.pdf");
    expect(uploadArgs[1]).toBe("application/pdf");
    expect(uploadArgs[2]).toBe("mock-stream");
    expect(uploadArgs[3]).toBe("Bill");
    expect(uploadArgs[4]).toBe("77");
    expect(uploadArgs[5]).toBeTypeOf("function");
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
    vi.spyOn(fs.promises, "stat").mockRejectedValue(new Error("ENOENT"));

    await expect(
      handleCreateAttachable(client as never, {
        file_path: "/no/such/file.pdf",
        draft: false,
      })
    ).rejects.toThrow("File not found");
  });

  it("throws for file exceeding size limit", async () => {
    vi.spyOn(fs.promises, "stat").mockResolvedValue({
      isFile: () => true,
      size: 200 * 1024 * 1024, // 200 MB
    } as fs.Stats);

    await expect(
      handleCreateAttachable(client as never, {
        file_path: "/tmp/huge.pdf",
        draft: false,
      })
    ).rejects.toThrow("File too large");
  });

  it("throws for dotfiles", async () => {
    await expect(
      handleCreateAttachable(client as never, {
        file_path: "/home/user/.env",
        draft: false,
      })
    ).rejects.toThrow("Blocked: dotfiles cannot be uploaded");
  });

  it("throws for credential files", async () => {
    await expect(
      handleCreateAttachable(client as never, {
        file_path: "/home/user/tokens.json",
        draft: false,
      })
    ).rejects.toThrow("Blocked: credential/secret files cannot be uploaded");
  });

  it("throws for files in dotfile directories", async () => {
    await expect(
      handleCreateAttachable(client as never, {
        file_path: "/home/user/.ssh/id_rsa",
        draft: false,
      })
    ).rejects.toThrow("Blocked: dotfiles cannot be uploaded");
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
      Note: "Receipt for lunch",
      AttachableRef: [
        {
          EntityRef: { value: "42", type: "Purchase", name: "Office Supplies" },
          IncludeOnSend: false,
        },
      ],
      MetaData: { CreateTime: "2024-01-15", LastUpdatedTime: "2024-01-15" },
    });

    const result = await handleGetAttachable(client as never, { id: "200" });
    const text = result.content[0].text;

    expect(text).toContain("receipt.pdf");
    expect(text).toContain("application/pdf");
    expect(text).toContain("15.0 KB");
    expect(text).toContain("https://example.com/download/200");
    expect(text).toContain("Receipt for lunch");
    expect(text).toContain("Purchase #42");
    expect(text).toContain("SyncToken: 1");
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
