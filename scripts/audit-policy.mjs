const exceptionPaths = {
  "intuit-oauth": "node_modules/intuit-oauth",
  "query-string": "node_modules/intuit-oauth/node_modules/query-string",
  "decode-uri-component": "node_modules/intuit-oauth/node_modules/decode-uri-component",
};

const exceptionAdvisories = new Set([
  "https://github.com/advisories/GHSA-vcc3-ghjq-m6fr",
  "https://github.com/advisories/GHSA-qr28-fpjm-wq7f",
]);

function isException(name, vulnerability) {
  if (
    !Object.hasOwn(exceptionPaths, name) ||
    vulnerability.fixAvailable !== false ||
    !Array.isArray(vulnerability.nodes) ||
    vulnerability.nodes.length !== 1 ||
    vulnerability.nodes[0] !== exceptionPaths[name] ||
    !Array.isArray(vulnerability.via) ||
    vulnerability.via.length === 0
  ) {
    return false;
  }
  if (name === "decode-uri-component") {
    return vulnerability.via.every(
      (advisory) =>
        typeof advisory === "object" &&
        advisory !== null &&
        advisory.name === name &&
        exceptionAdvisories.has(advisory.url),
    );
  }
  const expected = name === "intuit-oauth" ? "query-string" : "decode-uri-component";
  return vulnerability.via.every((dependency) => dependency === expected);
}

export function evaluateAudit(report) {
  if (
    report?.auditReportVersion !== 2 ||
    !report.vulnerabilities ||
    typeof report.vulnerabilities !== "object" ||
    !report.metadata?.vulnerabilities ||
    !Number.isInteger(report.metadata.vulnerabilities.high) ||
    !Number.isInteger(report.metadata.vulnerabilities.critical)
  ) {
    throw new Error("npm audit returned an invalid or unsupported report");
  }

  const blocked = [];
  const excepted = [];
  const intactExceptionChain = Object.keys(exceptionPaths).every((name) => {
    const vulnerability = report.vulnerabilities[name];
    return vulnerability?.severity === "high" && isException(name, vulnerability);
  });
  for (const [name, vulnerability] of Object.entries(report.vulnerabilities)) {
    if (!vulnerability || !["high", "critical"].includes(vulnerability.severity)) continue;
    if (intactExceptionChain && vulnerability.severity === "high" && isException(name, vulnerability)) {
      excepted.push(name);
    } else {
      blocked.push(name);
    }
  }
  if (blocked.length + excepted.length !==
      report.metadata.vulnerabilities.high + report.metadata.vulnerabilities.critical) {
    throw new Error("npm audit severity counts do not match its vulnerability entries");
  }
  return { blocked, excepted };
}
