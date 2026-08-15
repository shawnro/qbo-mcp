import { describe, expect, it } from "vitest";
import { resolveUniqueName } from "../name-resolution.js";

function candidate(id: number, name: string) {
  return {
    value: id,
    names: [name],
    label: `${name} (ID: ${id})`,
  };
}

describe("resolveUniqueName", () => {
  it("prefers one exact name over partial matches", () => {
    const result = resolveUniqueName("Item", "Widget", [
      candidate(1, "Premium Widget"),
      candidate(2, "Widget"),
    ]);

    expect(result).toBe(2);
  });

  it("returns one unique partial match", () => {
    expect(resolveUniqueName("Vendor", "Depot", [
      candidate(1, "Office Depot"),
      candidate(2, "Shell Gas Station"),
    ])).toBe(1);
  });

  it("rejects duplicate exact names", () => {
    expect(() => resolveUniqueName("Department", "Maintenance", [
      candidate(1, "Maintenance"),
      candidate(2, "Maintenance"),
    ])).toThrow('Department name is ambiguous: "Maintenance"');
  });

  it("bounds ambiguity details to five candidates", () => {
    const candidates = Array.from({ length: 6 }, (_, index) =>
      candidate(index + 1, `Office ${index + 1}`)
    );

    let message = "";
    try {
      resolveUniqueName("Account", "Office", candidates);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("Office 5 (ID: 5), and 1 more");
    expect(message).not.toContain("Office 6 (ID: 6)");
  });

  it("does not treat blank input as a partial match for every candidate", () => {
    expect(resolveUniqueName("Account", "  ", [candidate(1, "Cash")])).toBeUndefined();
  });
});