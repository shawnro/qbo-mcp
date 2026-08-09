import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMockClient,
  mockPromisify,
  mockSuccess,
  resetMockClient,
} from "../../../__mocks__/mock-client.js";

vi.mock("../../../client/index.js", () => ({ promisify: mockPromisify }));
vi.mock("../../../utils/index.js", async () => {
  const actual = await vi.importActual<typeof import("../../../utils/index.js")>(
    "../../../utils/index.js"
  );
  return {
    ...actual,
    downloadHttpsContent: vi.fn(),
    outputReport: vi.fn((_type: string, _data: unknown, summary: string) => ({
      content: [{ type: "text", text: summary }],
    })),
  };
});
vi.mock("../../../utils/pdf.js", () => ({ renderPdfPages: vi.fn() }));

import {
  downloadHttpsContent,
  HttpDownloadError,
  outputReport,
  setExecutionEnvironment,
  setOutputMode,
} from "../../../utils/index.js";
import { renderPdfPages } from "../../../utils/pdf.js";
import {
  handleListTransactionAttachables,
  handleReadAttachableContent,
} from "../attachment-content.js";

const mockDownload = vi.mocked(downloadHttpsContent);
const mockOutputReport = vi.mocked(outputReport);
const mockRenderPdfPages = vi.mocked(renderPdfPages);

describe("handleListTransactionAttachables", () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
    resetMockClient(client);
    vi.clearAllMocks();
    setOutputMode("stdio");
    setExecutionEnvironment("local");
  });

  it("queries linked IDs and returns safe full metadata", async () => {
    mockSuccess(client.findAttachables, {
      QueryResponse: { Attachable: [{ Id: "200" }, { Id: "201" }] },
    });
    client.getAttachable
      .mockImplementationOnce((_id: string, callback: Function) => callback(null, {
        Id: "200",
        SyncToken: "1",
        FileName: "invoice.pdf",
        ContentType: "application/pdf",
        Size: 1024,
        TempDownloadUri: "https://signed.example/secret",
        AttachableRef: [{ EntityRef: { type: "Bill", value: "77" }, IncludeOnSend: true }],
      }))
      .mockImplementationOnce((_id: string, callback: Function) => callback(null, {
        Id: "201",
        SyncToken: "0",
        Note: "Approval note",
        AttachableRef: [{ EntityRef: { type: "Bill", value: "77" } }],
      }));

    const result = await handleListTransactionAttachables(client as never, {
      entity_type: "bill",
      entity_id: "77",
    });

    expect(result.content[0].text).toContain("Count: 2");
    const criteria = client.findAttachables.mock.calls[0][0];
    expect(criteria).toEqual([
      { field: "AttachableRef.EntityRef.Type", value: "bill", operator: "=" },
      { field: "AttachableRef.EntityRef.value", value: "77", operator: "=" },
      { field: "limit", value: 20 },
    ]);
    const report = mockOutputReport.mock.calls[0][1] as {
      attachments: Array<Record<string, unknown>>;
    };
    expect(report.attachments[0]).toMatchObject({
      id: "200",
      fileName: "invoice.pdf",
      contentType: "application/pdf",
    });
    expect(report.attachments[0]).not.toHaveProperty("TempDownloadUri");
    expect(JSON.stringify(report)).not.toContain("signed.example");
  });

  it("returns an explicit empty result", async () => {
    mockSuccess(client.findAttachables, { QueryResponse: {} });
    const result = await handleListTransactionAttachables(client as never, {
      entity_type: "Bill",
      entity_id: "77",
      limit: 5,
    });
    expect(result.content[0].text).toContain("Count: 0");
    expect(client.getAttachable).not.toHaveBeenCalled();
  });

  it("validates entity inputs and limits before QBO calls", async () => {
    await expect(handleListTransactionAttachables(client as never, {
      entity_type: "Unknown",
      entity_id: "77",
    })).rejects.toThrow("Unsupported entity_type");
    await expect(handleListTransactionAttachables(client as never, {
      entity_type: "Bill",
      entity_id: "not-id",
    })).rejects.toThrow("numeric QBO entity ID");
    await expect(handleListTransactionAttachables(client as never, {
      entity_type: "Bill",
      entity_id: "77",
      limit: 101,
    })).rejects.toThrow("limit must be an integer");
    expect(client.findAttachables).not.toHaveBeenCalled();
  });

  it("caps HTTP metadata detail at 20 attachments", async () => {
    setOutputMode("http");
    mockSuccess(client.findAttachables, { QueryResponse: {} });

    const result = await handleListTransactionAttachables(client as never, {
      entity_type: "Bill",
      entity_id: "77",
      limit: 100,
    });

    expect(client.findAttachables.mock.calls[0][0]).toContainEqual({ field: "limit", value: 20 });
    expect(result.content[0].text).toContain("capped at 20");
    const report = mockOutputReport.mock.calls[0][1] as Record<string, unknown>;
    expect(report).toMatchObject({ detailCapped: true, requestedLimit: 100 });
  });

  it("hydrates attachment metadata with at most five concurrent QBO reads", async () => {
    const ids = Array.from({ length: 12 }, (_, index) => ({ Id: String(300 + index) }));
    mockSuccess(client.findAttachables, { QueryResponse: { Attachable: ids } });
    let active = 0;
    let maximum = 0;
    client.getAttachable.mockImplementation((id: string, callback: Function) => {
      active++;
      maximum = Math.max(maximum, active);
      setImmediate(() => {
        active--;
        callback(null, { Id: id, SyncToken: "0", Note: `Note ${id}` });
      });
    });

    await handleListTransactionAttachables(client as never, {
      entity_type: "Bill",
      entity_id: "77",
      limit: 12,
    });

    expect(maximum).toBe(5);
    expect(client.getAttachable).toHaveBeenCalledTimes(12);
  });
});

describe("handleReadAttachableContent", () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
    resetMockClient(client);
    vi.clearAllMocks();
    setOutputMode("stdio");
    setExecutionEnvironment("local");
  });

  it("returns note-only content without downloading", async () => {
    mockSuccess(client.getAttachable, { Id: "200", SyncToken: "0", Note: "Approved" });
    const result = await handleReadAttachableContent(client as never, { id: "200" });
    expect(result.content[0].text).toContain("Approved");
    expect(mockDownload).not.toHaveBeenCalled();
  });

  it("returns image content", async () => {
    mockSuccess(client.getAttachable, {
      Id: "200", SyncToken: "0", FileName: "receipt.png", ContentType: "image/png",
      Size: 3, TempDownloadUri: "https://signed.example/image",
    });
    mockDownload.mockResolvedValue({ bytes: Buffer.from("png"), contentType: "image/png" });

    const result = await handleReadAttachableContent(client as never, { id: "200" });
    expect(result.content[1]).toEqual({
      type: "image",
      data: Buffer.from("png").toString("base64"),
      mimeType: "image/png",
    });
  });

  it("returns strict UTF-8 text content", async () => {
    mockSuccess(client.getAttachable, {
      Id: "201", SyncToken: "0", FileName: "invoice.txt", ContentType: "text/plain",
      Size: 12, TempDownloadUri: "https://signed.example/text",
    });
    mockDownload.mockResolvedValue({ bytes: Buffer.from("Invoice 123"), contentType: "text/plain" });

    const result = await handleReadAttachableContent(client as never, { id: "201" });
    expect(result.content[1].text).toContain("Invoice 123");
  });

  it("renders bounded PDF pages as native JPEG image blocks", async () => {
    const pdf = Buffer.from("%PDF-1.4 test");
    const pageTwo = Buffer.from("jpeg-page-two");
    const pageThree = Buffer.from("jpeg-page-three");
    mockSuccess(client.getAttachable, {
      Id: "202", SyncToken: "0", FileName: "invoice.pdf", ContentType: "application/pdf",
      Size: pdf.length, TempDownloadUri: "https://signed.example/pdf",
    });
    mockDownload.mockResolvedValue({ bytes: pdf, contentType: "application/pdf" });
    mockRenderPdfPages.mockResolvedValue({
      pageCount: 5,
      pages: [
        { page: 2, data: pageTwo, width: 1000, height: 1400 },
        { page: 3, data: pageThree, width: 1000, height: 1400 },
      ],
    });

    const result = await handleReadAttachableContent(client as never, {
      id: "202",
      page_start: 2,
      page_count: 2,
    });
    expect(mockRenderPdfPages).toHaveBeenCalledWith(pdf, { pageStart: 2, pageCount: 2 });
    expect(result.content[0].text).toContain("Rendered pages 2-3 of 5");
    expect(result.content[0].text).toContain("page_start: 4");
    expect(result.content[1]).toEqual({
      type: "image",
      data: pageTwo.toString("base64"),
      mimeType: "image/jpeg",
    });
    expect(result.content[2]).toEqual({
      type: "image",
      data: pageThree.toString("base64"),
      mimeType: "image/jpeg",
    });
    expect(JSON.stringify(result)).not.toContain("signed.example");
  });

  it("returns PDF metadata only in Lambda mode", async () => {
    setExecutionEnvironment("lambda");
    mockSuccess(client.getAttachable, {
      Id: "208", SyncToken: "0", FileName: "invoice.pdf", ContentType: "application/pdf",
      Size: 100, TempDownloadUri: "https://signed.example/pdf",
    });

    const result = await handleReadAttachableContent(client as never, { id: "208" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("local stdio");
    expect(mockDownload).not.toHaveBeenCalled();
    expect(mockRenderPdfPages).not.toHaveBeenCalled();
  });

  it("refreshes an expired QBO download URL once", async () => {
    client.getAttachable
      .mockImplementationOnce((_id: string, callback: Function) => callback(null, {
        Id: "203", SyncToken: "0", FileName: "invoice.txt", ContentType: "text/plain",
        Size: 2, TempDownloadUri: "https://signed.example/expired",
      }))
      .mockImplementationOnce((_id: string, callback: Function) => callback(null, {
        Id: "203", SyncToken: "0", FileName: "invoice.txt", ContentType: "text/plain",
        Size: 2, TempDownloadUri: "https://signed.example/fresh",
      }));
    mockDownload
      .mockRejectedValueOnce(new HttpDownloadError("HTTP 403", 403))
      .mockResolvedValueOnce({ bytes: Buffer.from("ok"), contentType: "text/plain" });

    const result = await handleReadAttachableContent(client as never, { id: "203" });
    expect(result.content[1].text).toContain("ok");
    expect(client.getAttachable).toHaveBeenCalledTimes(2);
    expect(mockDownload).toHaveBeenCalledTimes(2);
  });

  it("rejects oversized metadata and MIME mismatches", async () => {
    mockSuccess(client.getAttachable, {
      Id: "204", SyncToken: "0", FileName: "huge.pdf", ContentType: "application/pdf",
      Size: 11 * 1024 * 1024, TempDownloadUri: "https://signed.example/huge",
    });
    await expect(handleReadAttachableContent(client as never, { id: "204" }))
      .rejects.toThrow("too large to read");
    expect(mockDownload).not.toHaveBeenCalled();

    resetMockClient(client);
    mockSuccess(client.getAttachable, {
      Id: "205", SyncToken: "0", FileName: "invoice.pdf", ContentType: "application/pdf",
      Size: 10, TempDownloadUri: "https://signed.example/mismatch",
    });
    mockDownload.mockResolvedValue({ bytes: Buffer.from("not pdf"), contentType: "text/plain" });
    await expect(handleReadAttachableContent(client as never, { id: "205" }))
      .rejects.toThrow("content type mismatch");
  });

  it("returns an actionable error for unsupported Office content", async () => {
    mockSuccess(client.getAttachable, {
      Id: "206", SyncToken: "0", FileName: "invoice.docx",
      ContentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      Size: 100, TempDownloadUri: "https://signed.example/docx",
    });
    const result = await handleReadAttachableContent(client as never, { id: "206" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("cannot yet be read by Claude");
    expect(mockDownload).not.toHaveBeenCalled();
  });

  it("caps binary content at 4 MB in HTTP mode", async () => {
    setOutputMode("http");
    mockSuccess(client.getAttachable, {
      Id: "207", SyncToken: "0", FileName: "large.pdf", ContentType: "application/pdf",
      Size: 5 * 1024 * 1024, TempDownloadUri: "https://signed.example/large-pdf",
    });

    await expect(handleReadAttachableContent(client as never, { id: "207" }))
      .rejects.toThrow("inline/HTTP output mode");
    expect(mockDownload).not.toHaveBeenCalled();
  });
});
