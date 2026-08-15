import { describe, expect, it } from "vitest";
import type { QBReport } from "../../types/index.js";
import {
  HTTP_REPORT_DETAIL_LIMIT,
  projectReportForHttp,
} from "../inline-output.js";

function dataRow(index: number): Record<string, unknown> {
  return {
    type: "Data",
    ColData: [{ value: `Account ${index}` }, { value: String(index) }],
  };
}

function countDataRows(value: unknown): number {
  if (Array.isArray(value)) {
    return value.reduce((total, item) => total + countDataRows(item), 0);
  }
  if (!value || typeof value !== "object") return 0;
  const record = value as Record<string, unknown>;
  return (record.type === "Data" ? 1 : 0)
    + Object.values(record).reduce<number>(
      (total, item) => total + countDataRows(item),
      0
    );
}

describe("projectReportForHttp", () => {
  it("preserves nested section summaries while capping detail rows", () => {
    const report = {
      Header: { ReportName: "ProfitAndLoss" },
      Columns: { Column: [{ ColTitle: "Account" }, { ColTitle: "Total" }] },
      Rows: {
        Row: [{
          type: "Section",
          group: "Income",
          Rows: { Row: Array.from({ length: 105 }, (_, index) => dataRow(index)) },
          Summary: { ColData: [{ value: "Total Income" }, { value: "5460" }] },
        }],
      },
    } as QBReport;

    const projection = projectReportForHttp(report);

    expect(projection.truncated).toBe(true);
    expect(projection.totalDetailRows).toBe(105);
    expect(projection.includedDetailRows).toBe(HTTP_REPORT_DETAIL_LIMIT);
    expect(countDataRows(projection.data)).toBe(HTTP_REPORT_DETAIL_LIMIT);
    expect(JSON.stringify(projection.data)).toContain("Total Income");
    expect(projection.data).toMatchObject({
      InlineOutput: {
        detailRowsReturned: HTTP_REPORT_DETAIL_LIMIT,
        totalDetailRows: 105,
        detailTruncatedAt: HTTP_REPORT_DETAIL_LIMIT,
      },
    });
    expect(countDataRows(report)).toBe(105);
  });

  it("returns the original report when detail fits", () => {
    const report = {
      Header: { ReportName: "TrialBalance" },
      Rows: { Row: [dataRow(1)] },
    } as QBReport;

    const projection = projectReportForHttp(report);

    expect(projection).toEqual({
      data: report,
      truncated: false,
      totalDetailRows: 1,
      includedDetailRows: 1,
    });
    expect(projection.data).toBe(report);
  });
});