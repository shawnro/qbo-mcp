// MCP Server setup and handler registration

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { toolDefinitions, executeTool } from "./tools/index.js";
import { filterTools } from "./tools/crud-filter.js";

// Create MCP server
export const server = new Server(
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

// Define available tools (filtered by CRUD disable flags)
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: filterTools(toolDefinitions),
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  return executeTool(name, args as Record<string, unknown>);
});
