import type { QBReport } from "../types/index.js";

export const HTTP_REPORT_DETAIL_LIMIT = 100;

interface InlineOutputMetadata {
  detailRowsReturned: number;
  totalDetailRows: number;
  detailTruncatedAt: number;
}

export interface HttpReportProjection {
  data: QBReport & { InlineOutput?: InlineOutputMetadata };
  truncated: boolean;
  totalDetailRows: number;
  includedDetailRows: number;
}

const OMIT = Symbol("omit-report-detail");

function countDetailRows(value: unknown): number {
  if (Array.isArray(value)) {
    return value.reduce((total, item) => total + countDetailRows(item), 0);
  }
  if (!value || typeof value !== "object") return 0;

  const record = value as Record<string, unknown>;
  return (record.type === "Data" ? 1 : 0)
    + Object.values(record).reduce<number>(
      (total, item) => total + countDetailRows(item),
      0
    );
}

function projectValue(
  value: unknown,
  state: { included: number },
  limit: number
): unknown | typeof OMIT {
  if (Array.isArray(value)) {
    const projected: unknown[] = [];
    for (const item of value) {
      const next = projectValue(item, state, limit);
      if (next !== OMIT) projected.push(next);
    }
    return projected;
  }
  if (!value || typeof value !== "object") return value;

  const record = value as Record<string, unknown>;
  if (record.type === "Data") {
    if (state.included >= limit) return OMIT;
    state.included++;
  }

  const projected: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(record)) {
    const next = projectValue(item, state, limit);
    if (next !== OMIT) projected[key] = next;
  }
  return projected;
}

export function projectReportForHttp(
  report: QBReport,
  limit = HTTP_REPORT_DETAIL_LIMIT
): HttpReportProjection {
  const totalDetailRows = countDetailRows(report.Rows?.Row);
  if (totalDetailRows <= limit) {
    return {
      data: report,
      truncated: false,
      totalDetailRows,
      includedDetailRows: totalDetailRows,
    };
  }

  const state = { included: 0 };
  const projected = projectValue(report, state, limit) as QBReport;
  return {
    data: {
      ...projected,
      InlineOutput: {
        detailRowsReturned: state.included,
        totalDetailRows,
        detailTruncatedAt: limit,
      },
    },
    truncated: true,
    totalDetailRows,
    includedDetailRows: state.included,
  };
}