export function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function configurationError(): Response {
  return jsonResponse(503, {
    error: "configuration_error",
    error_description: "The hosted service is not configured correctly.",
  });
}

export function notFound(): Response {
  return jsonResponse(404, { error: "not_found" });
}

export function methodNotAllowed(methods: string[]): Response {
  const response = jsonResponse(405, { error: "method_not_allowed" });
  response.headers.set("Allow", methods.join(", "));
  return response;
}

export function payloadTooLarge(): Response {
  return jsonResponse(413, {
    error: "payload_too_large",
    error_description: "The request body exceeds the configured limit.",
  });
}