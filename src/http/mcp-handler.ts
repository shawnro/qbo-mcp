import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "../server.js";
import type { QboRequestContext } from "../runtime/types.js";

export async function handleMcpRequest(
  request: Request,
  context: QboRequestContext
): Promise<Response> {
  const server = createMcpServer({ deploymentMode: "remote", context });
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