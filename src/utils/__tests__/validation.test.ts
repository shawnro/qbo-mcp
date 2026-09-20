import { describe, expect, it } from "vitest";
import { validateDocNumber, validateJournalEntryId } from "../validation.js";

describe("validateJournalEntryId", () => {
  it.each(["1", "77", "725394"])("accepts QBO entity ID %s", (id) => {
    expect(validateJournalEntryId(id)).toBe(id);
  });

  it.each(["", " ", "0", "01", "-1", "1.5", "abc"])(
    "rejects placeholder or malformed ID %j",
    (id) => {
      expect(() => validateJournalEntryId(id)).toThrow(
        "positive numeric QBO journal entry ID obtained from QuickBooks"
      );
    }
  );
});

describe("validateDocNumber", () => {
  it("allows an omitted document number", () => {
    expect(validateDocNumber(undefined)).toBeUndefined();
  });

  it("allows an empty document number without changing it", () => {
    expect(validateDocNumber("")).toBe("");
  });

  it("allows exactly 21 characters", () => {
    const docNumber = "X".repeat(21);
    expect(validateDocNumber(docNumber)).toBe(docNumber);
  });

  it("rejects 22 characters", () => {
    expect(() => validateDocNumber("X".repeat(22)))
      .toThrow("doc_number must be 21 characters or fewer");
  });

  it("does not trim or otherwise mutate the value", () => {
    const docNumber = "  REF-001  ";
    expect(validateDocNumber(docNumber)).toBe(docNumber);
  });
});