export class HttpDownloadError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "HttpDownloadError";
  }
}

export interface DownloadedContent {
  bytes: Buffer;
  contentType?: string;
}

export interface DownloadOptions {
  maxBytes: number;
  timeoutMs?: number;
  maxRedirects?: number;
}

function validateHttpsUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new HttpDownloadError("QBO returned an invalid attachment download URL");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new HttpDownloadError("QBO attachment download URL must use HTTPS without embedded credentials");
  }
  return url;
}

export async function downloadHttpsContent(
  initialUrl: string,
  options: DownloadOptions
): Promise<DownloadedContent> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxRedirects = options.maxRedirects ?? 3;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let url = validateHttpsUrl(initialUrl);
    for (let redirectCount = 0; ; redirectCount++) {
      let response: Response;
      try {
        response = await fetch(url, { redirect: "manual", signal: controller.signal });
      } catch (error) {
        if (controller.signal.aborted) {
          throw new HttpDownloadError(`Attachment download timed out after ${timeoutMs} ms`);
        }
        throw new HttpDownloadError(`Attachment download failed: ${(error as Error).message}`);
      }

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (redirectCount >= maxRedirects) {
          throw new HttpDownloadError(`Attachment download exceeded ${maxRedirects} redirects`);
        }
        const location = response.headers.get("location");
        if (!location) {
          throw new HttpDownloadError("Attachment download redirect omitted its location");
        }
        await response.body?.cancel();
        url = validateHttpsUrl(new URL(location, url).toString());
        continue;
      }

      if (!response.ok) {
        throw new HttpDownloadError(`Attachment download returned HTTP ${response.status}`, response.status);
      }

      const contentLength = response.headers.get("content-length");
      if (contentLength && Number(contentLength) > options.maxBytes) {
        throw new HttpDownloadError(
          `Attachment is too large to read (${contentLength} bytes; max ${options.maxBytes})`
        );
      }
      if (!response.body) {
        throw new HttpDownloadError("Attachment download returned no content");
      }

      const reader = response.body.getReader();
      const chunks: Buffer[] = [];
      let total = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > options.maxBytes) {
            await reader.cancel();
            throw new HttpDownloadError(
              `Attachment exceeded the ${options.maxBytes}-byte read limit`
            );
          }
          chunks.push(Buffer.from(value));
        }
      } catch (error) {
        if (error instanceof HttpDownloadError) throw error;
        if (controller.signal.aborted) {
          throw new HttpDownloadError(`Attachment download timed out after ${timeoutMs} ms`);
        }
        throw new HttpDownloadError(`Attachment content read failed: ${(error as Error).message}`);
      } finally {
        reader.releaseLock();
      }

      return {
        bytes: Buffer.concat(chunks, total),
        contentType: response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase(),
      };
    }
  } finally {
    clearTimeout(timeout);
  }
}
