import { describe, expect, it } from "vitest";
import { validateDocNumber } from "../validation.js";

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