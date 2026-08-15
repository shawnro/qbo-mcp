import { describe, expect, it } from "vitest";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { toolDefinitions } from "../definitions.js";

interface TestToolDefinition {
  name: string;
  inputSchema: SchemaNode & { properties: Record<string, SchemaNode> };
}

interface SchemaNode {
  type?: string;
  maxLength?: number;
  description?: string;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  minItems?: number;
  minLength?: number;
  items?: SchemaNode;
  required?: string[];
  properties?: Record<string, SchemaNode>;
  allOf?: SchemaNode[];
  anyOf?: SchemaNode[];
  oneOf?: SchemaNode[];
  not?: SchemaNode;
  if?: SchemaNode;
  then?: SchemaNode;
  else?: SchemaNode;
  const?: unknown;
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

  it("defines safe transaction listing and content reading tools", () => {
    const list = getDefinition("list_transaction_attachables");
    expect(list.inputSchema.required).toEqual(["entity_type", "entity_id"]);
    expect(list.inputSchema.properties.entity_type.enum).toContain("Bill");
    expect(list.inputSchema.properties.limit.minimum).toBe(1);
    expect(list.inputSchema.properties.limit.maximum).toBe(100);

    const read = getDefinition("read_attachable_content");
    expect(read.inputSchema.required).toEqual(["id"]);
    expect(read.inputSchema.properties.id.type).toBe("string");
  });
});

describe("toolDefinitions account ledger tools", () => {
  function getDefinition(name: string): TestToolDefinition {
    const definition = definitions.find((candidate) => candidate.name === name);
    expect(definition, name).toBeDefined();
    return definition!;
  }

  it("advertises authoritative posting detail and Cash/Accrual filtering", () => {
    const transactions = getDefinition("query_account_transactions");
    expect(transactions.inputSchema.required).toEqual(["account"]);
    expect(transactions.inputSchema.properties.accounting_method.enum)
      .toEqual(["Accrual", "Cash"]);

    const summary = getDefinition("account_period_summary");
    expect(summary.inputSchema.properties.accounting_method.enum)
      .toEqual(["Accrual", "Cash"]);
  });
});

describe("toolDefinitions cross-field contracts", () => {
  function getDefinition(name: string): TestToolDefinition {
    const definition = definitions.find((candidate) => candidate.name === name);
    expect(definition, name).toBeDefined();
    return definition!;
  }

  function expectRequiredChoice(
    schema: SchemaNode,
    keyword: "anyOf" | "oneOf",
    choices: string[][]
  ): void {
    expect(schema[keyword]?.map((branch) => branch.required)).toEqual(choices);
  }

  it("requires exactly one invoice customer and at most one sales receipt customer", () => {
    expectRequiredChoice(
      getDefinition("create_invoice").inputSchema,
      "oneOf",
      [["customer_name"], ["customer_id"]]
    );
    expect(getDefinition("create_sales_receipt").inputSchema.not?.required)
      .toEqual(["customer_name", "customer_id"]);
  });

  it.each([
    ["create_bill", ["vendor_name"], ["vendor_id"]],
    ["create_vendor_credit", ["vendor_name"], ["vendor_id"]],
    ["create_bill_payment", ["vendor_name"], ["vendor_id"]],
  ])("requires a name or ID for %s", (toolName, nameChoice, idChoice) => {
    expectRequiredChoice(
      getDefinition(toolName as string).inputSchema,
      "anyOf",
      [nameChoice as string[], idChoice as string[]]
    );
  });

  it.each([
    "create_journal_entry",
    "create_bill",
    "create_expense",
    "create_sales_receipt",
    "create_invoice",
    "create_deposit",
    "create_vendor_credit",
    "create_bill_payment",
  ])("requires at least one line or bill for %s", (toolName) => {
    const property = toolName === "create_bill_payment" ? "bills" : "lines";
    expect(getDefinition(toolName).inputSchema.properties[property].minItems).toBe(1);
  });

  it("expresses invoice line identity and amount alternatives", () => {
    const line = getDefinition("create_invoice").inputSchema.properties.lines.items!;
    expectRequiredChoice(line, "anyOf", [["item_name"], ["item_id"]]);
    expect(line.allOf?.[0].anyOf?.map((branch) => branch.required)).toEqual([
      ["amount"],
      ["qty", "unit_price"],
    ]);
  });

  it("rejects conflicting customer directives on account-based lines", () => {
    const createLine = getDefinition("create_bill").inputSchema.properties.lines.items!;
    expect(createLine.not?.required).toEqual(["customer_name", "customer_id"]);

    const editLine = getDefinition("edit_bill").inputSchema.properties.lines.items!;
    expect(editLine.allOf?.[0].not?.required).toEqual(["customer_name", "customer_id"]);
    expect(editLine.allOf?.[1].not).toMatchObject({
      required: ["clear_customer"],
      properties: { clear_customer: { const: true } },
    });
  });

  it("pairs attachable entity fields and requires a meaningful operation", () => {
    const create = getDefinition("create_attachable").inputSchema;
    expectRequiredChoice(create, "anyOf", [["file_path"], ["note"]]);
    expect(create.allOf).toContainEqual({
      oneOf: [
        {
          required: ["entity_type", "entity_id"],
          properties: {
            entity_type: { minLength: 1 },
            entity_id: { minLength: 1 },
          },
        },
        {
          not: {
            anyOf: [
              { required: ["entity_type"] },
              { required: ["entity_id"] },
              { required: ["include_on_send"] },
            ],
          },
        },
      ],
    });

    const edit = getDefinition("edit_attachable").inputSchema;
    expect(edit.anyOf?.map((branch) => branch.required)).toEqual([
      ["note"],
      ["category"],
      ["entity_type", "entity_id"],
    ]);
  });

  it("rejects each Vendor value with its true clear directive", () => {
    const schema = getDefinition("edit_vendor").inputSchema;
    expect(schema.allOf).toContainEqual({
      not: {
        required: ["email", "clear_email"],
        properties: { clear_email: { const: true } },
      },
    });
    expect(schema.allOf).toHaveLength(8);
  });
});

describe("toolDefinitions semantic validation", () => {
  const provider = new AjvJsonSchemaValidator();

  function validate(name: string, input: unknown): boolean {
    const definition = definitions.find((candidate) => candidate.name === name);
    expect(definition, name).toBeDefined();
    return provider.getValidator(definition!.inputSchema as never)(input).valid;
  }

  it("compiles every tool schema with the MCP SDK validator", () => {
    for (const definition of definitions) {
      expect(() => provider.getValidator(definition.inputSchema as never), definition.name)
        .not.toThrow();
    }
  });

  it("enforces invoice customer, line identity, amount, and non-empty lines", () => {
    const base = {
      txn_date: "2026-08-14",
      customer_name: "Customer",
      lines: [{ item_name: "Services", amount: 10 }],
    };
    expect(validate("create_invoice", base)).toBe(true);
    expect(validate("create_invoice", { ...base, customer_name: undefined })).toBe(false);
    expect(validate("create_invoice", { ...base, customer_name: "" })).toBe(false);
    expect(validate("create_invoice", { ...base, customer_id: "1" })).toBe(false);
    expect(validate("create_invoice", { ...base, lines: [] })).toBe(false);
    expect(validate("create_invoice", { ...base, lines: [{ amount: 10 }] })).toBe(false);
    expect(validate("create_invoice", {
      ...base,
      lines: [{ item_id: "2", qty: 2, unit_price: 5 }],
    })).toBe(true);
    expect(validate("create_invoice", {
      ...base,
      lines: [{ item_id: "2", qty: 2 }],
    })).toBe(false);
  });

  it("allows an optional sales receipt customer but rejects both forms", () => {
    const base = {
      txn_date: "2026-08-14",
      lines: [{ item_name: "Services", amount: 10 }],
    };
    expect(validate("create_sales_receipt", base)).toBe(true);
    expect(validate("create_sales_receipt", {
      ...base,
      customer_name: "Customer",
      customer_id: "1",
    })).toBe(false);
    expect(validate("create_sales_receipt", {
      ...base,
      customer_name: "",
      customer_id: "1",
    })).toBe(true);
  });

  it("enforces account-based identity and customer directive conflicts", () => {
    const bill = {
      vendor_name: "Vendor",
      txn_date: "2026-08-14",
      lines: [{ account_name: "Expense", amount: 10 }],
    };
    expect(validate("create_bill", bill)).toBe(true);
    expect(validate("create_bill", { ...bill, vendor_name: undefined })).toBe(false);
    expect(validate("create_bill", { ...bill, lines: [] })).toBe(false);
    expect(validate("create_bill", {
      ...bill,
      lines: [{ account_name: "Expense", amount: 10, customer_name: "A", customer_id: "1" }],
    })).toBe(false);

    expect(validate("edit_bill", {
      id: "1",
      lines: [{ line_id: "2", customer_name: "A", clear_customer: false }],
    })).toBe(true);
    expect(validate("edit_bill", {
      id: "1",
      lines: [{ line_id: "2", customer_name: "A", clear_customer: true }],
    })).toBe(false);
    expect(validate("edit_bill", {
      id: "1",
      lines: [{ line_id: "2", delete: true, customer_id: "1" }],
    })).toBe(false);
  });

  it("enforces attachable operation and entity-link dependencies", () => {
    expect(validate("create_attachable", { note: "Receipt" })).toBe(true);
    expect(validate("create_attachable", {})).toBe(false);
    expect(validate("create_attachable", { note: "" })).toBe(false);
    expect(validate("create_attachable", { note: "Receipt", entity_type: "Bill" })).toBe(false);
    expect(validate("create_attachable", { note: "Receipt", include_on_send: false })).toBe(false);
    expect(validate("create_attachable", {
      note: "Receipt",
      entity_type: "Bill",
      entity_id: "1",
      include_on_send: false,
    })).toBe(true);

    expect(validate("edit_attachable", { id: "1" })).toBe(false);
    expect(validate("edit_attachable", { id: "1", category: "Receipt" })).toBe(true);
  });

  it("rejects Vendor values only when the matching clear directive is true", () => {
    expect(validate("edit_vendor", { id: "1", email: "a@example.com", clear_email: false }))
      .toBe(true);
    expect(validate("edit_vendor", { id: "1", email: "a@example.com", clear_email: true }))
      .toBe(false);
    expect(validate("edit_vendor", { id: "1", clear_email: true })).toBe(true);
  });

  it("requires realm_id only for a non-empty OAuth authorization code", () => {
    expect(validate("qbo_authenticate", {})).toBe(true);
    expect(validate("qbo_authenticate", { realm_id: "123" })).toBe(true);
    expect(validate("qbo_authenticate", { authorization_code: "" })).toBe(true);
    expect(validate("qbo_authenticate", { authorization_code: "code" })).toBe(false);
    expect(validate("qbo_authenticate", {
      authorization_code: "code",
      realm_id: "123",
    })).toBe(true);
  });

  it("requires edit_vendor to contain a real change", () => {
    expect(validate("edit_vendor", { id: "1" })).toBe(false);
    expect(validate("edit_vendor", { id: "1", draft: false })).toBe(false);
    expect(validate("edit_vendor", { id: "1", clear_email: false })).toBe(false);
    expect(validate("edit_vendor", { id: "1", active: false })).toBe(true);
    expect(validate("edit_vendor", { id: "1", clear_email: true })).toBe(true);
  });

  it("requires identity and amount inputs only for newly added transaction lines", () => {
    for (const name of ["edit_bill", "edit_expense", "edit_vendor_credit"]) {
      expect(validate(name, { id: "1", lines: [{ line_id: "2", amount: 5 }] })).toBe(true);
      expect(validate(name, { id: "1", lines: [{ amount: 5 }] })).toBe(false);
      expect(validate(name, {
        id: "1",
        lines: [{ account_name: "Expense", amount: 5 }],
      })).toBe(true);
      expect(validate(name, {
        id: "1",
        lines: [{ account_name: "Expense", amount: 5, clear_customer: true }],
      })).toBe(false);
    }

    for (const name of ["edit_invoice", "edit_sales_receipt"]) {
      expect(validate(name, { id: "1", lines: [{ line_id: "2", description: "Updated" }] }))
        .toBe(true);
      expect(validate(name, { id: "1", lines: [{ amount: 5 }] })).toBe(false);
      expect(validate(name, { id: "1", lines: [{ item_id: "3" }] })).toBe(false);
      expect(validate(name, { id: "1", lines: [{ item_id: "3", amount: 5 }] })).toBe(true);
    }

    expect(validate("edit_journal_entry", {
      id: "1",
      lines: [{ line_id: "2", amount: 5 }],
    })).toBe(true);
    expect(validate("edit_journal_entry", { id: "1", lines: [{ amount: 5 }] })).toBe(false);
    expect(validate("edit_journal_entry", {
      id: "1",
      lines: [{ account_name: "Checking", amount: 5, posting_type: "Debit" }],
    })).toBe(true);
  });
});