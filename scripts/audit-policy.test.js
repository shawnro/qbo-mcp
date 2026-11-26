import { describe, expect, it } from "vitest";
import { evaluateAudit } from "./audit-policy.mjs";

function report() {
  return {
    auditReportVersion: 2,
    metadata: { vulnerabilities: { high: 3, critical: 0 } },
    vulnerabilities: {
      "intuit-oauth": {
        severity: "high", fixAvailable: false,
        nodes: ["node_modules/intuit-oauth"], via: ["query-string"],
      },
      "query-string": {
        severity: "high", fixAvailable: false,
        nodes: ["node_modules/intuit-oauth/node_modules/query-string"], via: ["decode-uri-component"],
      },
      "decode-uri-component": {
        severity: "high", fixAvailable: false,
        nodes: ["node_modules/intuit-oauth/node_modules/decode-uri-component"],
        via: [
          { name: "decode-uri-component", url: "https://github.com/advisories/GHSA-vcc3-ghjq-m6fr" },
          { name: "decode-uri-component", url: "https://github.com/advisories/GHSA-qr28-fpjm-wq7f" },
        ],
      },
    },
  };
}

describe("production audit exception", () => {
  it("reports the exact unresolved Intuit chain", () => {
    expect(evaluateAudit(report())).toEqual({
      blocked: [],
      excepted: ["intuit-oauth", "query-string", "decode-uri-component"],
    });
  });

  it("blocks new high-severity findings", () => {
    const data = report();
    data.metadata.vulnerabilities.high++;
    data.vulnerabilities.other = { severity: "high" };
    expect(evaluateAudit(data).blocked).toEqual(["other"]);
  });

  it("blocks critical findings even in an excepted dependency", () => {
    const data = report();
    data.metadata.vulnerabilities.high--;
    data.metadata.vulnerabilities.critical++;
    data.vulnerabilities["decode-uri-component"].severity = "critical";
    expect(evaluateAudit(data).blocked).toContain("decode-uri-component");
  });

  it("blocks a new advisory or a second installation of the decoder", () => {
    const data = report();
    data.vulnerabilities["decode-uri-component"].via.push({
      name: "decode-uri-component", url: "https://github.com/advisories/GHSA-new",
    });
    expect(evaluateAudit(data).blocked).toContain("decode-uri-component");
    const other = report();
    other.vulnerabilities["decode-uri-component"].nodes.push("node_modules/decode-uri-component");
    expect(evaluateAudit(other).blocked).toContain("decode-uri-component");
  });

  it("blocks the exception if a fix appears or the chain changes", () => {
    const fixed = report();
    fixed.vulnerabilities["query-string"].fixAvailable = true;
    expect(evaluateAudit(fixed).blocked).toHaveLength(3);
    const incomplete = report();
    delete incomplete.vulnerabilities["decode-uri-component"];
    incomplete.metadata.vulnerabilities.high--;
    expect(evaluateAudit(incomplete).blocked).toHaveLength(2);
  });

  it("fails closed for malformed reports and severity mismatches", () => {
    expect(() => evaluateAudit({})).toThrow();
    const data = report();
    data.metadata.vulnerabilities.critical = 1;
    expect(() => evaluateAudit(data)).toThrow();
  });
});
