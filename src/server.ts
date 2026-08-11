// MCP Server setup and handler registration

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { toolDefinitions, executeTool } from "./tools/index.js";
import { createToolExecutor, getToolDefinitions } from "./tools/capabilities.js";
import type { DeploymentMode } from "./tools/capabilities.js";

export interface McpServerOptions {
  deploymentMode?: DeploymentMode;
}

export function createMcpServer(options: McpServerOptions = {}): Server {
  const deploymentMode = options.deploymentMode ?? "local";
  const definitions = getToolDefinitions(toolDefinitions, deploymentMode);
  const invokeTool = createToolExecutor(deploymentMode, executeTool);
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
