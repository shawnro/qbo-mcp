import { describe, expect, it } from "vitest";
import {
  assertHostedQueryEntitySupported,
  HOSTED_QUERY_ENTITIES,
  projectQueryEntities,
} from "../query-output.js";

describe("hosted generic-query projections", () => {
  it("keeps every advertised entity connected to a reviewed projection", () => {
    for (const entity of HOSTED_QUERY_ENTITIES) {
      expect(() => assertHostedQueryEntitySupported(entity)).not.toThrow();
    }
  });

  it("drops unexpected object shapes from scalar fields", () => {
    expect(projectQueryEntities("Customer", [{
      Id: "1",
      DisplayName: { FutureSensitiveField: "drop" },
      Balance: 25,
    }], "hosted")).toEqual([{ Id: "1", Balance: 25 }]);
  });

  it("rejects unreviewed entities without returning raw records", () => {
    expect(() => projectQueryEntities(
      "Employee",
      [{ Id: "1", SSN: "sensitive" }],
      "hosted"
    )).toThrow("does not have a reviewed privacy projection");
  });
});