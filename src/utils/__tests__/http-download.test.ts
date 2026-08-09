import { afterEach, describe, expect, it, vi } from "vitest";
import {
  downloadHttpsContent,
  HttpDownloadError,
} from "../http-download.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("downloadHttpsContent", () => {
  it("downloads bounded HTTPS content and normalizes MIME type", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("invoice", {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8", "content-length": "7" },
    })));

    const result = await downloadHttpsContent("https://files.example/invoice.txt", { maxBytes: 100 });
    expect(result.bytes.toString()).toBe("invoice");
    expect(result.contentType).toBe("text/plain");
  });

  it("rejects non-HTTPS URLs before fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(downloadHttpsContent("http://files.example/invoice.txt", { maxBytes: 100 }))
      .rejects.toThrow("must use HTTPS");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("follows bounded HTTPS redirects", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, {
        status: 302,
        headers: { location: "https://cdn.example/invoice.txt" },
      }))
      .mockResolvedValueOnce(new Response("invoice", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await downloadHttpsContent("https://files.example/start", {
      maxBytes: 100,
      maxRedirects: 2,
    });
    expect(result.bytes.toString()).toBe("invoice");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects redirects to non-HTTPS destinations", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, {
      status: 302,
      headers: { location: "http://insecure.example/invoice.txt" },
    })));
    await expect(downloadHttpsContent("https://files.example/start", { maxBytes: 100 }))
      .rejects.toThrow("must use HTTPS");
  });

  it("preserves HTTP status for expired URL recovery", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("expired", { status: 403 })));
    const error = await downloadHttpsContent("https://files.example/expired", { maxBytes: 100 })
      .catch((caught) => caught);
    expect(error).toBeInstanceOf(HttpDownloadError);
    expect(error.status).toBe(403);
  });

  it("rejects declared and streamed content over the limit", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("large", {
      status: 200,
      headers: { "content-length": "1000" },
    })));
    await expect(downloadHttpsContent("https://files.example/large", { maxBytes: 5 }))
      .rejects.toThrow("too large to read");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("sixsix", { status: 200 })));
    await expect(downloadHttpsContent("https://files.example/chunked", { maxBytes: 5 }))
      .rejects.toThrow("exceeded the 5-byte read limit");
  });

  it("times out stalled downloads", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })
    ));
    try {
      const download = downloadHttpsContent("https://files.example/stalled", {
        maxBytes: 100,
        timeoutMs: 100,
      });
      const expectation = expect(download).rejects.toThrow("timed out after 100 ms");
      await vi.advanceTimersByTimeAsync(101);
      await expectation;
    } finally {
      vi.useRealTimers();
    }
  });
});
