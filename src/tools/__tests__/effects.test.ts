import { describe, expect, it } from "vitest";
import { getToolEffect } from "../effects.js";
import { toolDefinitions } from "../definitions.js";

describe("getToolEffect", () => {
  it("classifies reads", () => {
    expect(getToolEffect("get_bill", { id: "1" })).toBe("read");
    expect(getToolEffect("query", { query: "SELECT * FROM Bill" })).toBe("read");
  });

  it("classifies draft-first tools by explicit commit state", () => {
    expect(getToolEffect("create_bill", {})).toBe("preview");
    expect(getToolEffect("create_bill", { draft: true })).toBe("preview");
    expect(getToolEffect("create_bill", { draft: false })).toBe("committed-mutation");
    expect(getToolEffect("deactivate_vendor", { draft: false })).toBe("committed-mutation");
  });

  it("classifies deletes by confirmation", () => {
    expect(getToolEffect("delete_entity", { confirm: false })).toBe("preview");
    expect(getToolEffect("delete_entity", { confirm: true })).toBe("committed-mutation");
  });

  it("fails closed for tools without effect metadata", () => {
    expect(() => getToolEffect("future_write_tool", {})).toThrow(
      "has no execution effect classification"
    );
  });

  it("classifies every registered QBO operation", () => {
    const specialTools = new Set([
      "qbo_authenticate",
      "list_qbo_profiles",
      "switch_qbo_profile",
    ]);
    for (const definition of toolDefinitions) {
      if (specialTools.has(definition.name)) continue;
      expect(() => getToolEffect(definition.name, {
        draft: false,
        confirm: true,
      })).not.toThrow();
    }
  });
});