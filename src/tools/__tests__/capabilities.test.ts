import { describe, expect, it, vi } from "vitest";
import type { MCPToolResult } from "../../types/index.js";
import { createToolExecutor, getToolDefinitions } from "../capabilities.js";

interface TestToolDefinition {
  name: string;
  description?: string;
  inputSchema: {
    type: string;
    properties: Record<string, unknown>;
    [key: string]: unknown;
  };
}

const definitions: TestToolDefinition[] = [
  { name: "query", inputSchema: { type: "object", properties: {} } },
  { name: "qbo_authenticate", inputSchema: { type: "object", properties: {} } },
  { name: "list_qbo_profiles", inputSchema: { type: "object", properties: {} } },
  { name: "switch_qbo_profile", inputSchema: { type: "object", properties: {} } },
  {
    name: "create_attachable",
    description: "Local attachment tool",
    inputSchema: {
      type: "object",
      properties: { file_path: { type: "string" }, note: { type: "string" } },
    },
  },
];

describe("deployment capabilities", () => {
  it("preserves local definitions", () => {
    expect(getToolDefinitions(definitions, "local")).toEqual(definitions);
  });

  it("hides process-mutating tools and local paths remotely", () => {
    const remote = getToolDefinitions(definitions, "remote");
    expect(remote.map((tool) => tool.name)).toEqual(["query", "create_attachable"]);
    expect(remote[1].inputSchema.properties).toEqual({ note: { type: "string" } });
    expect(remote[1].inputSchema.anyOf).toEqual([{
      required: ["note"],
      properties: { note: { minLength: 1 } },
    }]);
    expect(definitions[4].inputSchema.properties).toHaveProperty("file_path");
  });

  it("rejects direct remote calls that bypass discovery", async () => {
    const result: MCPToolResult = { content: [{ type: "text", text: "ok" }] };
    const execute = vi.fn(async () => result);
    const invoke = createToolExecutor("remote", execute);

    expect((await invoke("switch_qbo_profile", { profile: "other" })).isError).toBe(true);
    expect((await invoke("create_attachable", { file_path: "C:\\secret.pdf" })).isError).toBe(true);
    expect(execute).not.toHaveBeenCalled();

    await invoke("create_attachable", { note: "Hosted note" });
    expect(execute).toHaveBeenCalledWith("create_attachable", { note: "Hosted note" });
  });

  it("does not restrict local invocation", async () => {
    const result: MCPToolResult = { content: [{ type: "text", text: "ok" }] };
    const execute = vi.fn(async () => result);
    const invoke = createToolExecutor("local", execute);

    await invoke("switch_qbo_profile", { profile: "other" });
    await invoke("create_attachable", { file_path: "C:\\receipt.pdf" });
    expect(execute).toHaveBeenCalledTimes(2);
  });
});