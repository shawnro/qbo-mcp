import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export type MCPToolContent = CallToolResult["content"][number];

export interface InternalToolContent {
	type: string;
	text?: string;
	data?: string;
	mimeType?: string;
	resource?: {
		uri: string;
		mimeType?: string;
		text?: string;
		blob?: string;
	};
	[key: string]: unknown;
}

export interface InternalToolResult {
	content: InternalToolContent[];
	isError?: boolean;
}

export type MCPToolResult = CallToolResult & InternalToolResult;

export function asMCPToolResult(result: InternalToolResult): MCPToolResult {
	return result as unknown as MCPToolResult;
}
