// Tests for pagination param parsing

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parsePaginationFromQuery,
  BATCH_SIZE,
  HTTP_QUERY_LIMIT,
  SAFETY_LIMIT,
} from "../pagination.js";

// Mock isHttpMode
vi.mock("../../utils/output.js", () => ({
  isHttpMode: vi.fn(() => false),
}));

import { isHttpMode } from "../../utils/output.js";
const mockIsHttpMode = isHttpMode as ReturnType<typeof vi.fn>;

describe("parsePaginationFromQuery", () => {
  beforeEach(() => {
    mockIsHttpMode.mockReturnValue(false);
  });

  describe("MAXRESULTS parsing", () => {
    it("defaults to 1000 in stdio mode", () => {
      mockIsHttpMode.mockReturnValue(false);
      const result = parsePaginationFromQuery("SELECT * FROM Invoice");
      expect(result.maxResults).toBe(1000);
    });

    it("defaults to 100 in HTTP mode", () => {
      mockIsHttpMode.mockReturnValue(true);
      const result = parsePaginationFromQuery("SELECT * FROM Invoice");
      expect(result.maxResults).toBe(100);
    });

    it("caps explicit MAXRESULTS in HTTP mode", () => {
      mockIsHttpMode.mockReturnValue(true);
      const result = parsePaginationFromQuery("SELECT * FROM Invoice MAXRESULTS 500");
      expect(result.maxResults).toBe(HTTP_QUERY_LIMIT);
    });

    it("extracts explicit MAXRESULTS", () => {
      const result = parsePaginationFromQuery("SELECT * FROM Invoice MAXRESULTS 50");
      expect(result.maxResults).toBe(50);
    });

    it("parses case-insensitively (maxresults)", () => {
      const result = parsePaginationFromQuery("SELECT * FROM Bill maxresults 25");
      expect(result.maxResults).toBe(25);
    });

    it("parses mixed case (MaxResults)", () => {
      const result = parsePaginationFromQuery("SELECT * FROM Bill MaxResults 200");
      expect(result.maxResults).toBe(200);
    });
  });

  describe("STARTPOSITION parsing", () => {
    it("defaults to null when not specified", () => {
      const result = parsePaginationFromQuery("SELECT * FROM Invoice");
      expect(result.startPosition).toBeNull();
    });

    it("extracts explicit STARTPOSITION", () => {
      const result = parsePaginationFromQuery("SELECT * FROM Invoice STARTPOSITION 101");
      expect(result.startPosition).toBe(101);
    });

    it("parses case-insensitively", () => {
      const result = parsePaginationFromQuery("SELECT * FROM Invoice startposition 50");
      expect(result.startPosition).toBe(50);
    });
  });

  describe("baseCriteria extraction", () => {
    it("extracts WHERE clause as baseCriteria", () => {
      const result = parsePaginationFromQuery(
        "SELECT * FROM Invoice WHERE TxnDate >= '2024-01-01'"
      );
      expect(result.baseCriteria).toBe("WHERE TxnDate >= '2024-01-01'");
    });

    it("strips MAXRESULTS from criteria", () => {
      const result = parsePaginationFromQuery(
        "SELECT * FROM Invoice WHERE Active = true MAXRESULTS 50"
      );
      expect(result.baseCriteria).toBe("WHERE Active = true");
    });

    it("strips STARTPOSITION from criteria", () => {
      const result = parsePaginationFromQuery(
        "SELECT * FROM Invoice WHERE Active = true STARTPOSITION 10"
      );
      expect(result.baseCriteria).toBe("WHERE Active = true");
    });

    it("strips both pagination clauses from criteria", () => {
      const result = parsePaginationFromQuery(
        "SELECT * FROM Invoice WHERE TxnDate > '2024-01-01' MAXRESULTS 100 STARTPOSITION 50"
      );
      expect(result.baseCriteria).toBe("WHERE TxnDate > '2024-01-01'");
      expect(result.maxResults).toBe(100);
      expect(result.startPosition).toBe(50);
    });

    it("strips trailing semicolons", () => {
      const result = parsePaginationFromQuery("SELECT * FROM Bill WHERE Active = true;");
      expect(result.baseCriteria).toBe("WHERE Active = true");
    });

    it("returns empty string when no criteria after FROM Entity", () => {
      const result = parsePaginationFromQuery("SELECT * FROM JournalEntry");
      expect(result.baseCriteria).toBe("");
    });

    it("handles extra whitespace", () => {
      const result = parsePaginationFromQuery(
        "SELECT * FROM Invoice   WHERE Active = true   MAXRESULTS   25"
      );
      expect(result.baseCriteria).toBe("WHERE Active = true");
      expect(result.maxResults).toBe(25);
    });
  });

  describe("isHttpMode is called", () => {
    it("checks isHttpMode to determine default", () => {
      parsePaginationFromQuery("SELECT * FROM Invoice");
      expect(mockIsHttpMode).toHaveBeenCalled();
    });
  });
});
