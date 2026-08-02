import { describe, it, expect, beforeEach, vi } from "vitest";
import { getCrudCategory, isToolDisabled, filterTools } from "../../tools/crud-filter.js";

describe("getCrudCategory", () => {
  it("categorizes create_ tools as create", () => {
    expect(getCrudCategory("create_bill")).toBe("create");
    expect(getCrudCategory("create_journal_entry")).toBe("create");
    expect(getCrudCategory("create_customer")).toBe("create");
  });

  it("categorizes edit_ tools as update", () => {
    expect(getCrudCategory("edit_bill")).toBe("update");
    expect(getCrudCategory("edit_journal_entry")).toBe("update");
    expect(getCrudCategory("edit_customer")).toBe("update");
  });

  it("categorizes deactivate_ tools as update", () => {
    expect(getCrudCategory("deactivate_vendor")).toBe("update");
  });

  it("categorizes delete_ tools as delete", () => {
    expect(getCrudCategory("delete_entity")).toBe("delete");
  });

  it("categorizes everything else as read", () => {
    expect(getCrudCategory("query")).toBe("read");
    expect(getCrudCategory("get_bill")).toBe("read");
    expect(getCrudCategory("get_company_info")).toBe("read");
    expect(getCrudCategory("list_accounts")).toBe("read");
    expect(getCrudCategory("get_profit_loss")).toBe("read");
    expect(getCrudCategory("qbo_authenticate")).toBe("read");
    expect(getCrudCategory("list_qbo_profiles")).toBe("read");
    expect(getCrudCategory("account_period_summary")).toBe("read");
  });
});

describe("isToolDisabled", () => {
  beforeEach(() => {
    delete process.env.QBO_DISABLE_CREATE;
    delete process.env.QBO_DISABLE_UPDATE;
    delete process.env.QBO_DISABLE_DELETE;
  });

  it("returns false for read tools regardless of env", () => {
    process.env.QBO_DISABLE_CREATE = "true";
    process.env.QBO_DISABLE_UPDATE = "true";
    process.env.QBO_DISABLE_DELETE = "true";

    expect(isToolDisabled("query")).toBe(false);
    expect(isToolDisabled("get_bill")).toBe(false);
    expect(isToolDisabled("list_accounts")).toBe(false);
    expect(isToolDisabled("get_profit_loss")).toBe(false);
  });

  it("disables create tools when QBO_DISABLE_CREATE=true", () => {
    process.env.QBO_DISABLE_CREATE = "true";

    expect(isToolDisabled("create_bill")).toBe(true);
    expect(isToolDisabled("create_journal_entry")).toBe(true);
  });

  it("disables edit tools when QBO_DISABLE_UPDATE=true", () => {
    process.env.QBO_DISABLE_UPDATE = "true";

    expect(isToolDisabled("edit_bill")).toBe(true);
    expect(isToolDisabled("edit_expense")).toBe(true);
    expect(isToolDisabled("deactivate_vendor")).toBe(true);
  });

  it("disables delete tools when QBO_DISABLE_DELETE=true", () => {
    process.env.QBO_DISABLE_DELETE = "true";

    expect(isToolDisabled("delete_entity")).toBe(true);
  });

  it("does not disable when env var is absent", () => {
    expect(isToolDisabled("create_bill")).toBe(false);
    expect(isToolDisabled("edit_bill")).toBe(false);
    expect(isToolDisabled("delete_entity")).toBe(false);
  });

  it("does not disable when env var is not 'true'", () => {
    process.env.QBO_DISABLE_CREATE = "false";
    process.env.QBO_DISABLE_UPDATE = "1";
    process.env.QBO_DISABLE_DELETE = "yes";

    expect(isToolDisabled("create_bill")).toBe(false);
    expect(isToolDisabled("edit_bill")).toBe(false);
    expect(isToolDisabled("delete_entity")).toBe(false);
  });
});

describe("filterTools", () => {
  const allTools = [
    { name: "query" },
    { name: "get_bill" },
    { name: "create_bill" },
    { name: "edit_bill" },
    { name: "delete_entity" },
    { name: "list_accounts" },
    { name: "create_invoice" },
    { name: "edit_invoice" },
    { name: "deactivate_vendor" },
  ];

  beforeEach(() => {
    delete process.env.QBO_DISABLE_CREATE;
    delete process.env.QBO_DISABLE_UPDATE;
    delete process.env.QBO_DISABLE_DELETE;
  });

  it("returns all tools when nothing is disabled", () => {
    expect(filterTools(allTools)).toEqual(allTools);
  });

  it("removes create tools when disabled", () => {
    process.env.QBO_DISABLE_CREATE = "true";

    const result = filterTools(allTools);
    const names = result.map((t) => t.name);

    expect(names).not.toContain("create_bill");
    expect(names).not.toContain("create_invoice");
    expect(names).toContain("query");
    expect(names).toContain("edit_bill");
    expect(names).toContain("delete_entity");
  });

  it("removes edit and delete tools when both disabled", () => {
    process.env.QBO_DISABLE_UPDATE = "true";
    process.env.QBO_DISABLE_DELETE = "true";

    const result = filterTools(allTools);
    const names = result.map((t) => t.name);

    expect(names).not.toContain("edit_bill");
    expect(names).not.toContain("edit_invoice");
    expect(names).not.toContain("deactivate_vendor");
    expect(names).not.toContain("delete_entity");
    expect(names).toContain("create_bill");
    expect(names).toContain("query");
    expect(names).toContain("get_bill");
  });

  it("removes all write tools in full read-only mode", () => {
    process.env.QBO_DISABLE_CREATE = "true";
    process.env.QBO_DISABLE_UPDATE = "true";
    process.env.QBO_DISABLE_DELETE = "true";

    const result = filterTools(allTools);
    const names = result.map((t) => t.name);

    expect(names).toEqual(["query", "get_bill", "list_accounts"]);
  });
});
