import type { MCPToolResult } from "../types/index.js";
import { filterTools } from "./crud-filter.js";

export type DeploymentMode = "local" | "remote";

interface ToolDefinition {
  name: string;
  description?: string;
  inputSchema: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
    [key: string]: unknown;
  };
}

type ToolExecutor = (
  name: string,
  args: Record<string, unknown>
) => Promise<MCPToolResult>;

const REMOTE_HIDDEN_TOOLS = new Set([
  "qbo_authenticate",
  "list_qbo_profiles",
  "switch_qbo_profile",
]);

function projectRemoteDefinition<T extends ToolDefinition>(definition: T): T {
  if (definition.name !== "create_attachable") return definition;

  const { file_path: _filePath, ...properties } = definition.inputSchema.properties ?? {};
  return {
    ...definition,
    description: "Create a QuickBooks note and optionally link it to a transaction or entity.",
    inputSchema: {
      ...definition.inputSchema,
      properties,
      anyOf: [{
        required: ["note"],
        properties: { note: { minLength: 1 } },
      }],
    },
  };
}

export function getToolDefinitions<T extends ToolDefinition>(
  definitions: T[],
  mode: DeploymentMode
): T[] {
  const enabledDefinitions = filterTools(definitions);
  if (mode === "local") return enabledDefinitions;

  return enabledDefinitions
    .filter((definition) => !REMOTE_HIDDEN_TOOLS.has(definition.name))
    .map(projectRemoteDefinition);
}

export function createToolExecutor(mode: DeploymentMode, execute: ToolExecutor): ToolExecutor {
  return async (name, args) => {
    if (mode === "remote" && REMOTE_HIDDEN_TOOLS.has(name)) {
      return disabledToolResult(name);
    }
    if (mode === "remote" && name === "create_attachable" && args.file_path !== undefined) {
      return disabledToolResult("create_attachable.file_path");
    }
    return execute(name, args);
  };
}

function disabledToolResult(name: string): MCPToolResult {
  return {
    content: [{ type: "text", text: `Capability "${name}" is unavailable in hosted mode.` }],
    isError: true,
  };
}