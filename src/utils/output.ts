// Output mode utilities for stdio vs HTTP transport
// In stdio mode: write full data to temp files, return filepath reference
// In HTTP mode: return data inline (no filesystem access in Lambda)

import { writeReport } from "./files.js";
import type { OutputPolicy } from "../runtime/types.js";

export type OutputMode = "stdio" | "http";
export type ExecutionEnvironment = "local" | "lambda";
export const MAX_INLINE_JSON_CHARS = 100_000;

let currentOutputMode: OutputMode = "stdio";
let currentExecutionEnvironment: ExecutionEnvironment = "local";

export function setOutputMode(mode: OutputMode): void {
  currentOutputMode = mode;
}

export function isHttpMode(policy?: OutputPolicy): boolean {
  return (policy?.mode ?? currentOutputMode) === "http";
}

export function setExecutionEnvironment(environment: ExecutionEnvironment): void {
  currentExecutionEnvironment = environment;
}

export function isLambdaMode(policy?: OutputPolicy): boolean {
  return (policy?.executionEnvironment ?? currentExecutionEnvironment) === "lambda";
}

type ToolResult = { content: Array<{ type: string; text: string }> };

/**
 * Return report data in the appropriate format for the current transport.
 * - stdio: writes to temp file, appends filepath to summary
 * - http: returns summary + inline JSON data
 */
export function outputReport(
  reportType: string,
  data: unknown,
  summary: string,
  policy?: OutputPolicy
): ToolResult {
  if (isHttpMode(policy)) {
    const inlineJson = JSON.stringify(data);
    if (inlineJson.length > MAX_INLINE_JSON_CHARS) {
      const metadata = {
        inlineDataOmitted: true,
        serializedCharacters: inlineJson.length,
        limit: MAX_INLINE_JSON_CHARS,
        guidance: "Use narrower filters, a smaller date range, or paginated requests.",
      };
      return {
        content: [
          {
            type: "text",
            text: `${summary}\nWarning: Inline data omitted because it exceeds the ${MAX_INLINE_JSON_CHARS}-character context limit.`,
          },
          { type: "text", text: JSON.stringify(metadata) },
        ],
      };
    }
    return {
      content: [
        { type: "text", text: summary },
        { type: "text", text: inlineJson },
      ],
    };
  }

  const filepath = writeReport(reportType, data);
  return {
    content: [{ type: "text", text: `${summary}\n\nFull data: ${filepath}` }],
  };
}
