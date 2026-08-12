import { describe, expect, it, vi } from "vitest";
import { createLookupCache } from "../client/cache.js";
import { handleListAccounts } from "../tools/handlers/accounts.js";
import { companyKey } from "./types.js";
import type { QboRequestContext } from "./types.js";

function context(name: string): QboRequestContext {
  return {
    requestId: name,
    principal: { kind: "authenticated", id: "test" },
    transport: "http",
    output: { mode: "http", executionEnvironment: "node" },
    runtime: {
      companyKey: companyKey(name),
      companyId: name,
      lookupCache: createLookupCache(),
      createClientAttempt: vi.fn(),
      refreshAfterAuthError: vi.fn(),
      clearCaches: vi.fn(),
    },
  };
}

function client(id: string, name: string) {
  return {
    findAccounts: vi.fn((_criteria, callback) => callback(null, {
      QueryResponse: { Account: [{ Id: id, Name: name, Active: true }] },
    })),
  };
}

describe("company runtime handler isolation", () => {
  it("does not share account lookups between company runtimes", async () => {
    const companyA = context("company-a");
    const companyB = context("company-b");
    const clientA = client("1", "Company A Checking");
    const clientB = client("2", "Company B Checking");

    const resultA = await handleListAccounts(clientA as never, {}, companyA);
    const resultB = await handleListAccounts(clientB as never, {}, companyB);

    expect(resultA.content[1].text).toContain("Company A Checking");
    expect(resultA.content[1].text).not.toContain("Company B Checking");
    expect(resultB.content[1].text).toContain("Company B Checking");
    expect(resultB.content[1].text).not.toContain("Company A Checking");
    expect(clientA.findAccounts).toHaveBeenCalledOnce();
    expect(clientB.findAccounts).toHaveBeenCalledOnce();
  });
});