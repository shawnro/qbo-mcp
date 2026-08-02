import { describe, expect, it } from "vitest";
import { toolDefinitions } from "../definitions.js";

interface TestToolDefinition {
  name: string;
  inputSchema: {
    properties: Record<string, {
      type?: string;
      maxLength?: number;
      description?: string;
    }>;
  };
}

describe("toolDefinitions document numbers", () => {
  const expectedTools = [
    "create_bill",
    "create_bill_payment",
    "create_expense",
    "create_invoice",
    "create_journal_entry",
    "create_sales_receipt",
    "create_vendor_credit",
    "edit_bill",
    "edit_journal_entry",
    "edit_vendor_credit",
  ];

  it("limits every existing doc_number input to 21 characters", () => {
    const definitions = toolDefinitions as unknown as TestToolDefinition[];
    const withDocNumber = definitions.filter((definition) =>
      Object.prototype.hasOwnProperty.call(definition.inputSchema.properties, "doc_number")
    );

    expect(withDocNumber.map((definition) => definition.name).sort()).toEqual(expectedTools);
    for (const definition of withDocNumber) {
      const schema = definition.inputSchema.properties.doc_number;
      expect(schema.type, definition.name).toBe("string");
      expect(schema.maxLength, definition.name).toBe(21);
      expect(schema.description, definition.name).toContain("maximum 21 characters");
    }
  });
});