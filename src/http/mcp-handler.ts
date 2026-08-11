import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "../server.js";

export async function handleMcpRequest(request: Request): Promise<Response> {
  const server = createMcpServer({ deploymentMode: "remote" });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  try {
    await server.connect(transport);
    return await transport.handleRequest(request);
  } finally {
    await Promise.allSettled([transport.close(), server.close()]);
  }
}