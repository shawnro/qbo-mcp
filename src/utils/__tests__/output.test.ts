import { describe, it, expect, beforeEach } from "vitest";
import {
  isHttpMode,
  isLambdaMode,
  outputReport,
  setExecutionEnvironment,
  setOutputMode,
} from "../output.js";

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
  });
});
