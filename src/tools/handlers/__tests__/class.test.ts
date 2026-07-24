import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createMockClient,
  mockSuccess,
  mockError,
  resetMockClient,
  mockPromisify,
} from "../../../__mocks__/mock-client.js";

vi.mock("../../../client/index.js", () => ({
  promisify: mockPromisify,
  getClient: vi.fn(),
  clearCredentialsCache: vi.fn(),
  refreshTokens: vi.fn(),
  isAuthError: vi.fn(),
  clearLookupCache: vi.fn(),
  getCompanyIdValue: vi.fn(),
}));

vi.mock("../../../utils/index.js", async () => {
  const actual = await vi.importActual<typeof import("../../../utils/index.js")>(
    "../../../utils/index.js"
  );
  return { ...actual };
});

import { handleCreateClass, handleGetClass, handleEditClass } from "../class.js";

describe("handleCreateClass", () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
    resetMockClient(client);
    vi.clearAllMocks();
  });

  it("returns preview in draft mode", async () => {
    const result = await handleCreateClass(client as never, {
      name: "Retail",
    });

    expect(result.content[0].text).toContain("DRAFT");
    expect(result.content[0].text).toContain("Retail");
    expect(client.createClass).not.toHaveBeenCalled();
  });

  it("creates class when draft=false", async () => {
    mockSuccess(client.createClass, { Id: "100", Name: "Retail" });

    const result = await handleCreateClass(client as never, {
      name: "Retail",
      draft: false,
    });

    expect(client.createClass).toHaveBeenCalledOnce();
    expect(result.content[0].text).toContain("Class Created");
    expect(result.content[0].text).toContain("100");
  });

  it("resolves parent by name for sub-class", async () => {
    mockSuccess(client.findClasses, {
      QueryResponse: { Class: [{ Id: "10", Name: "Operations" }] },
    });
    mockSuccess(client.createClass, {
      Id: "101",
      Name: "West Coast",
      FullyQualifiedName: "Operations:West Coast",
    });

    const result = await handleCreateClass(client as never, {
      name: "West Coast",
      parent_name: "Operations",
      draft: false,
    });

    const payload = client.createClass.mock.calls[0][0];
    expect(payload.ParentRef).toEqual({ value: "10", name: "Operations" });
    expect(payload.SubClass).toBeUndefined();
    expect(result.content[0].text).toContain("West Coast");
  });

  it("resolves parent by ID", async () => {
    mockSuccess(client.getClass, { Id: "10", Name: "Operations" });
    mockSuccess(client.createClass, { Id: "102", Name: "East Coast" });

    await handleCreateClass(client as never, {
      name: "East Coast",
      parent_id: "10",
      draft: false,
    });

    const payload = client.createClass.mock.calls[0][0];
    expect(payload.ParentRef).toEqual({ value: "10", name: "Operations" });
  });

  it("throws when parent class not found", async () => {
    mockSuccess(client.findClasses, {
      QueryResponse: { Class: [{ Id: "1", Name: "Retail" }] },
    });

    await expect(
      handleCreateClass(client as never, {
        name: "SubClass",
        parent_name: "NonExistent",
        draft: false,
      })
    ).rejects.toThrow("Parent class not found");
  });

  it("shows parent in draft preview", async () => {
    mockSuccess(client.findClasses, {
      QueryResponse: { Class: [{ Id: "10", Name: "Operations" }] },
    });

    const result = await handleCreateClass(client as never, {
      name: "West Coast",
      parent_name: "Operations",
    });

    expect(result.content[0].text).toContain("Parent: Operations");
  });
});

describe("handleGetClass", () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
    resetMockClient(client);
  });

  it("returns class details", async () => {
    mockSuccess(client.getClass, {
      Id: "100",
      SyncToken: "0",
      Name: "Retail",
      Active: true,
      MetaData: { CreateTime: "2024-01-01", LastUpdatedTime: "2024-06-01" },
    });

    const result = await handleGetClass(client as never, { id: "100" });

    expect(result.content[0].text).toContain("Retail");
    expect(result.content[0].text).toContain("SyncToken: 0");
    expect(result.content[0].text).toContain("Active: true");
  });

  it("shows hierarchy for sub-class", async () => {
    mockSuccess(client.getClass, {
      Id: "101",
      SyncToken: "1",
      Name: "West Coast",
      FullyQualifiedName: "Operations:West Coast",
      SubClass: true,
      ParentRef: { value: "10", name: "Operations" },
      Active: true,
    });

    const result = await handleGetClass(client as never, { id: "101" });

    expect(result.content[0].text).toContain("Fully Qualified Name: Operations:West Coast");
    expect(result.content[0].text).toContain("Sub-class: true");
    expect(result.content[0].text).toContain("Parent: Operations");
  });
});

describe("handleEditClass", () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
    resetMockClient(client);
    vi.clearAllMocks();
  });

  it("returns preview in draft mode", async () => {
    mockSuccess(client.getClass, {
      Id: "100",
      SyncToken: "0",
      Name: "Retail",
      Active: true,
    });

    const result = await handleEditClass(client as never, {
      id: "100",
      name: "Wholesale",
    });

    expect(result.content[0].text).toContain("DRAFT");
    expect(result.content[0].text).toContain("Retail → Wholesale");
    expect(client.updateClass).not.toHaveBeenCalled();
  });

  it("applies sparse update when draft=false", async () => {
    mockSuccess(client.getClass, {
      Id: "100",
      SyncToken: "2",
      Name: "Retail",
      Active: true,
    });
    mockSuccess(client.updateClass, {
      Id: "100",
      Name: "Wholesale",
      Active: true,
    });

    const result = await handleEditClass(client as never, {
      id: "100",
      name: "Wholesale",
      draft: false,
    });

    const payload = client.updateClass.mock.calls[0][0];
    expect(payload.Id).toBe("100");
    expect(payload.SyncToken).toBe("2");
    expect(payload.Name).toBe("Wholesale");
    expect(payload.sparse).toBe(true);
    expect(result.content[0].text).toContain("Class Updated");
  });

  it("deactivates class via active=false", async () => {
    mockSuccess(client.getClass, {
      Id: "100",
      SyncToken: "0",
      Name: "Retail",
      Active: true,
    });
    mockSuccess(client.updateClass, {
      Id: "100",
      Name: "Retail",
      Active: false,
    });

    await handleEditClass(client as never, {
      id: "100",
      active: false,
      draft: false,
    });

    const payload = client.updateClass.mock.calls[0][0];
    expect(payload.Active).toBe(false);
  });

  it("clears parent with empty string", async () => {
    mockSuccess(client.getClass, {
      Id: "101",
      SyncToken: "0",
      Name: "West Coast",
      ParentRef: { value: "10", name: "Operations" },
      SubClass: true,
    });
    mockSuccess(client.updateClass, {
      Id: "101",
      Name: "West Coast",
      Active: true,
    });

    await handleEditClass(client as never, {
      id: "101",
      parent_name: "",
      draft: false,
    });

    const payload = client.updateClass.mock.calls[0][0];
    expect(payload.ParentRef).toBeNull();
    expect(payload.SubClass).toBeUndefined();
  });
});
