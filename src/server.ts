// MCP Server setup and handler registration

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { toolDefinitions, executeTool } from "./tools/index.js";
import { createToolExecutor, getToolDefinitions } from "./tools/capabilities.js";
import type { DeploymentMode } from "./tools/capabilities.js";
import type { QboRequestContext } from "./runtime/types.js";

export type McpServerOptions =
  | { deploymentMode?: "local"; context?: never }
  | { deploymentMode: "remote"; context: QboRequestContext };

export function createMcpServer(options: McpServerOptions = {}): Server {
  const deploymentMode = options.deploymentMode ?? "local";
  if (deploymentMode === "remote" && !options.context) {
    throw new Error("Remote MCP server requires a request context");
  }
  const definitions = getToolDefinitions(toolDefinitions, deploymentMode);
  const invokeTool = createToolExecutor(
    deploymentMode,
    (name, args) => executeTool(name, args, options.context)
  );
  const server = new Server(
    {
      name: "qbo-mcp",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: definitions }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return invokeTool(name, args as Record<string, unknown>);
  });

  return server;
}

export const server = createMcpServer();
