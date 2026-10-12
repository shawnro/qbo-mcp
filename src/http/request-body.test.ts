import { describe, expect, it } from "vitest";
import { readBoundedRequest, RequestBodyTooLargeError } from "./request-body.js";

describe("bounded HTTP request bodies", () => {
  it("accepts a body at the byte limit and preserves it", async () => {
    const request = new Request("https://mcp.example.com/qb/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "12345678",
    });

    const bounded = await readBoundedRequest(request, 8);

    expect(await bounded.text()).toBe("12345678");
    expect(bounded.headers.get("content-type")).toBe("application/json");
  });

  it("counts encoded bytes rather than JavaScript characters", async () => {
    const request = new Request("https://mcp.example.com/qb/mcp", {
      method: "POST",
      body: "éé",
    });

    await expect(readBoundedRequest(request, 3)).rejects.toBeInstanceOf(
      RequestBodyTooLargeError
    );
  });

  it("rejects declared oversized bodies before reading them", async () => {
    const request = new Request("https://mcp.example.com/qb/mcp", {
      method: "POST",
      headers: { "Content-Length": "100" },
      body: "short",
    });

    await expect(readBoundedRequest(request, 10)).rejects.toBeInstanceOf(
      RequestBodyTooLargeError
    );
  });
});