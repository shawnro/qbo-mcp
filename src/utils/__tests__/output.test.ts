import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import {
  MAX_INLINE_JSON_CHARS,
  isHttpMode,
  isLambdaMode,
  outputReport,
  setExecutionEnvironment,
  setOutputMode,
} from "../output.js";
import type { OutputPolicy } from "../../runtime/types.js";

const httpPolicy: OutputPolicy = { mode: "http", executionEnvironment: "lambda" };
const stdioPolicy: OutputPolicy = { mode: "stdio", executionEnvironment: "local" };

describe("setOutputMode / isHttpMode", () => {
  beforeEach(() => {
    setOutputMode("stdio");
    setExecutionEnvironment("local");
  });

  it("defaults to stdio mode", () => {
    expect(isHttpMode()).toBe(false);
  });

  it("switches to http mode", () => {
    setOutputMode("http");
    expect(isHttpMode()).toBe(true);
  });

  it("switches back to stdio mode", () => {
    setOutputMode("http");
    setOutputMode("stdio");
    expect(isHttpMode()).toBe(false);
  });

  it("tracks Lambda execution independently from output mode", () => {
    setOutputMode("http");
    expect(isLambdaMode()).toBe(false);

    setExecutionEnvironment("lambda");
    expect(isLambdaMode()).toBe(true);
    expect(isHttpMode()).toBe(true);
  });

  it("uses explicit policies without changing global compatibility", () => {
    setOutputMode("http");
    setExecutionEnvironment("lambda");

    expect(isHttpMode(stdioPolicy)).toBe(false);
    expect(isLambdaMode(stdioPolicy)).toBe(false);
    expect(isHttpMode(httpPolicy)).toBe(true);
    expect(isLambdaMode(httpPolicy)).toBe(true);
    expect(isHttpMode()).toBe(true);
    expect(isLambdaMode()).toBe(true);
  });
});

describe("outputReport", () => {
  beforeEach(() => {
    setOutputMode("stdio");
    setExecutionEnvironment("local");
  });

  describe("http mode", () => {
    beforeEach(() => {
      setOutputMode("http");
    });

    it("returns summary and inline JSON", () => {
      const data = { accounts: [{ name: "Cash", balance: 1000 }] };
      const result = outputReport("accounts", data, "Found 1 account");

      expect(result.content).toHaveLength(2);
      expect(result.content[0]).toEqual({ type: "text", text: "Found 1 account" });
      expect(result.content[1]).toEqual({
        type: "text",
        text: JSON.stringify(data),
      });
    });

    it("handles empty data", () => {
      const result = outputReport("test", {}, "No results");
      expect(result.content[1].text).toBe("{}");
    });

    it("handles array data", () => {
      const data = [1, 2, 3];
      const result = outputReport("test", data, "Summary");
      expect(result.content[1].text).toBe("[1,2,3]");
    });

    it("omits oversized inline JSON with bounded continuation guidance", () => {
      const data = { value: "x".repeat(MAX_INLINE_JSON_CHARS) };
      const result = outputReport("large-query", data, "Large query");

      expect(result.content[0].text).toContain("Inline data omitted");
      const metadata = JSON.parse(result.content[1].text);
      expect(metadata).toEqual({
        inlineDataOmitted: true,
        serializedCharacters: JSON.stringify(data).length,
        limit: MAX_INLINE_JSON_CHARS,
        guidance: "Use narrower filters, a smaller date range, or paginated requests.",
      });
      expect(result.content[1].text.length).toBeLessThan(500);
    });
  });

  describe("stdio mode", () => {
    it("writes to temp file and returns filepath in summary", () => {
      const data = { total: 5000 };
      const result = outputReport("test-report", data, "Summary line");

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe("text");
      expect(result.content[0].text).toContain("Summary line");
      expect(result.content[0].text).toContain("Full data:");
      expect(result.content[0].text).toMatch(/\.json/);
    });

    it("includes report type in filename", () => {
      const result = outputReport("profit-loss", { revenue: 100 }, "P&L");
      expect(result.content[0].text).toContain("profit-loss");
    });

    it("writes oversized data completely instead of applying inline limits", () => {
      const data = { value: "x".repeat(MAX_INLINE_JSON_CHARS) };
      const result = outputReport("large-stdio", data, "Large local report");
      const filepath = result.content[0].text.match(/Full data: (.+)$/)?.[1];

      expect(filepath).toBeDefined();
      expect(JSON.parse(readFileSync(filepath!, "utf8"))).toEqual(data);
    });
  });

  it("isolates concurrent explicit HTTP and stdio policies", async () => {
    setOutputMode("http");
    const data = { total: 5000 };

    const [httpResult, stdioResult] = await Promise.all([
      Promise.resolve().then(() => outputReport("concurrent-http", data, "HTTP", httpPolicy)),
      Promise.resolve().then(() => outputReport("concurrent-stdio", data, "stdio", stdioPolicy)),
    ]);

    expect(httpResult.content).toEqual([
      { type: "text", text: "HTTP" },
      { type: "text", text: JSON.stringify(data) },
    ]);
    expect(stdioResult.content).toHaveLength(1);
    expect(stdioResult.content[0].text).toContain("Full data:");
    expect(stdioResult.content[0].text).toContain("concurrent-stdio");
    expect(isHttpMode()).toBe(true);
  });
});
