import { describe, it, expect } from "vitest";
import {
  toCents,
  toDollars,
  validateAmount,
  sumCents,
  validateBalance,
  formatDollars,
} from "../money.js";

describe("toCents", () => {
  it("converts whole dollars", () => {
    expect(toCents(10)).toBe(1000);
    expect(toCents(0)).toBe(0);
    expect(toCents(1)).toBe(100);
  });

  it("converts dollars with cents", () => {
    expect(toCents(10.5)).toBe(1050);
    expect(toCents(10.99)).toBe(1099);
    expect(toCents(0.01)).toBe(1);
  });

  it("handles negative amounts", () => {
    expect(toCents(-5.25)).toBe(-525);
  });

  it("rounds to avoid floating-point drift", () => {
    // 0.1 + 0.2 = 0.30000000000000004 in JS
    expect(toCents(0.1 + 0.2)).toBe(30);
  });

  it("handles large amounts", () => {
    expect(toCents(999999.99)).toBe(99999999);
  });
});

describe("toDollars", () => {
  it("converts cents to dollars", () => {
    expect(toDollars(1000)).toBe(10);
    expect(toDollars(1050)).toBe(10.5);
    expect(toDollars(1)).toBe(0.01);
    expect(toDollars(0)).toBe(0);
  });

  it("handles negative cents", () => {
    expect(toDollars(-525)).toBe(-5.25);
  });
});

describe("validateAmount", () => {
  it("accepts whole dollars and returns cents", () => {
    expect(validateAmount(10)).toBe(1000);
    expect(validateAmount(0)).toBe(0);
  });

  it("accepts amounts with 1-2 decimal places", () => {
    expect(validateAmount(10.5)).toBe(1050);
    expect(validateAmount(10.99)).toBe(1099);
    expect(validateAmount(0.01)).toBe(1);
  });

  it("rejects amounts with more than 2 decimal places", () => {
    expect(() => validateAmount(10.001)).toThrow("decimal places");
    expect(() => validateAmount(5.999)).toThrow("decimal places");
    expect(() => validateAmount(1.123)).toThrow("decimal places");
  });

  it("includes field name in error message", () => {
    expect(() => validateAmount(10.001, "Line 1")).toThrow("Line 1");
  });

  it("uses default field name when not provided", () => {
    expect(() => validateAmount(10.001)).toThrow("Amount");
  });

  it("handles negative amounts with valid precision", () => {
    expect(validateAmount(-5.25)).toBe(-525);
  });

  it("rejects negative amounts with invalid precision", () => {
    expect(() => validateAmount(-5.999)).toThrow("decimal places");
  });

  it("tolerates tiny floating-point errors", () => {
    // 10.00 might internally be 10.000000000001
    expect(validateAmount(10.0)).toBe(1000);
  });
});

describe("sumCents", () => {
  it("sums an array of cent amounts", () => {
    expect(sumCents([1050, 2000, 350])).toBe(3400);
  });

  it("returns 0 for empty array", () => {
    expect(sumCents([])).toBe(0);
  });

  it("handles single element", () => {
    expect(sumCents([500])).toBe(500);
  });

  it("handles negative amounts", () => {
    expect(sumCents([1000, -500, 250])).toBe(750);
  });

  it("maintains exact precision unlike float addition", () => {
    // If these were dollars: 0.1 + 0.2 + 0.3 = 0.6000000000000001
    // But as cents (10 + 20 + 30) = 60 exactly
    expect(sumCents([10, 20, 30])).toBe(60);
  });
});

describe("validateBalance", () => {
  it("passes when debits equal credits", () => {
    expect(() => validateBalance(5000, 5000)).not.toThrow();
    expect(() => validateBalance(0, 0)).not.toThrow();
  });

  it("throws when debits don't equal credits", () => {
    expect(() => validateBalance(5000, 4999)).toThrow("Debits");
    expect(() => validateBalance(5000, 4999)).toThrow("Difference: $0.01");
  });

  it("includes dollar amounts in error message", () => {
    expect(() => validateBalance(10000, 5000)).toThrow("$100.00");
    expect(() => validateBalance(10000, 5000)).toThrow("$50.00");
  });
});

describe("formatDollars", () => {
  it("formats cents as dollar string with 2 decimal places", () => {
    expect(formatDollars(1050)).toBe("10.50");
    expect(formatDollars(1000)).toBe("10.00");
    expect(formatDollars(1)).toBe("0.01");
    expect(formatDollars(0)).toBe("0.00");
  });

  it("handles large amounts", () => {
    expect(formatDollars(99999999)).toBe("999999.99");
  });

  it("handles negative amounts", () => {
    expect(formatDollars(-525)).toBe("-5.25");
  });
});
