import { describe, expect, it } from "vitest";
import { toolDefinitions } from "../definitions.js";

interface TestToolDefinition {
  name: string;
  inputSchema: {
    properties: Record<string, {
      type?: string;
      maxLength?: number;
      description?: string;
      properties?: Record<string, unknown>;
      enum?: string[];
    }>;
    required?: string[];
  };
}

const definitions = toolDefinitions as unknown as TestToolDefinition[];

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

describe("toolDefinitions Vendor tools", () => {
  const vendorToolNames = [
    "create_vendor",
    "get_vendor",
    "edit_vendor",
    "deactivate_vendor",
  ];

  function getDefinition(name: string): TestToolDefinition {
    const definition = definitions.find((candidate) => candidate.name === name);
    expect(definition, name).toBeDefined();
    return definition!;
  }

  it("defines the complete Vendor tool inventory", () => {
    expect(definitions.filter((definition) => vendorToolNames.includes(definition.name))
      .map((definition) => definition.name)).toEqual(vendorToolNames);
  });

  it("requires only display_name for create and id for other Vendor tools", () => {
    expect(getDefinition("create_vendor").inputSchema.required).toEqual(["display_name"]);
    expect(getDefinition("get_vendor").inputSchema.required).toEqual(["id"]);
    expect(getDefinition("edit_vendor").inputSchema.required).toEqual(["id"]);
    expect(getDefinition("deactivate_vendor").inputSchema.required).toEqual(["id"]);
  });

  it("advertises QBO Vendor field limits and address shape", () => {
    const properties = getDefinition("create_vendor").inputSchema.properties;
    expect(properties.display_name.maxLength).toBe(500);
    expect(properties.title.maxLength).toBe(16);
    expect(properties.given_name.maxLength).toBe(100);
    expect(properties.suffix.maxLength).toBe(16);
    expect(properties.account_number.maxLength).toBe(100);
    expect(properties.bill_address.properties).toHaveProperty("line1");
    expect(properties.bill_address.properties).toHaveProperty("postal_code");
    expect(properties.draft.type).toBe("boolean");
  });

  it("exposes every explicit Vendor clear directive on edit", () => {
    const properties = getDefinition("edit_vendor").inputSchema.properties;
    for (const name of [
      "clear_email",
      "clear_phone",
      "clear_mobile",
      "clear_fax",
      "clear_web_address",
      "clear_bill_address",
      "clear_terms",
      "clear_account_number",
    ]) {
      expect(properties[name].type, name).toBe("boolean");
    }
    expect(properties.active.type).toBe("boolean");
    expect(properties.draft.type).toBe("boolean");
  });
});

describe("toolDefinitions Attachable tools", () => {
  function getDefinition(name: string): TestToolDefinition {
    const definition = definitions.find((candidate) => candidate.name === name);
    expect(definition, name).toBeDefined();
    return definition!;
  }

  it("documents local file paths and enforces QBO metadata constraints", () => {
    const create = getDefinition("create_attachable");
    const properties = create.inputSchema.properties;

    expect(create.inputSchema.required).toEqual([]);
    expect(create.name).toBe("create_attachable");
    expect(properties.file_path.description).toContain("Absolute path");
    expect(create.inputSchema.properties.note.maxLength).toBe(2000);
    expect(properties.category.enum).toEqual([
      "Contact Photo", "Document", "Image", "Receipt", "Signature", "Sound", "Other",
    ]);
    expect(properties.entity_type.enum).toContain("Bill");
    expect(properties.entity_type.enum).toContain("Purchase");
  });

  it("uses the same metadata constraints for edit_attachable", () => {
    const properties = getDefinition("edit_attachable").inputSchema.properties;
    expect(properties.note.maxLength).toBe(2000);
    expect(properties.category.enum).toContain("Receipt");
    expect(properties.entity_type.enum).toContain("Bill");
  });
});