import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_QBO_REQUEST_TIMEOUT_MS,
  QboOperationTimeoutError,
  getQboRequestTimeoutMs,
  promisify,
} from "../promisify.js";

afterEach(() => {
  vi.useRealTimers();
  delete process.env.QBO_REQUEST_TIMEOUT_MS;
});

describe("promisify callback deadline", () => {
  it("uses a 60 second default deadline", async () => {
    vi.useFakeTimers();
    const promise = promisify<string>(() => {});
    const rejection = expect(promise).rejects.toMatchObject({
      name: "QboOperationTimeoutError",
      code: "ETIMEDOUT",
      timeoutMs: DEFAULT_QBO_REQUEST_TIMEOUT_MS,
    });

    await vi.advanceTimersByTimeAsync(DEFAULT_QBO_REQUEST_TIMEOUT_MS - 1);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await rejection;
  });

  it("clears the deadline after callback success", async () => {
    vi.useFakeTimers();
    const result = await promisify<string>((callback) => callback(null, "ok"), { timeoutMs: 25 });

    expect(result).toBe("ok");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the deadline after callback failure", async () => {
    vi.useFakeTimers();
    await expect(promisify<string>((callback) => callback(new Error("QBO failed"), ""), {
      timeoutMs: 25,
    })).rejects.toThrow("QBO failed");

    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the deadline when callback registration throws", async () => {
    vi.useFakeTimers();
    await expect(promisify<string>(() => {
      throw new Error("Registration failed");
    }, { timeoutMs: 25 })).rejects.toThrow("Registration failed");

    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores a callback that arrives after the deadline", async () => {
    vi.useFakeTimers();
    let callback!: (error: Error | null, result: string) => void;
    const promise = promisify<string>((received) => {
      callback = received;
    }, { timeoutMs: 25 });
    const rejection = expect(promise).rejects.toBeInstanceOf(QboOperationTimeoutError);

    await vi.advanceTimersByTimeAsync(25);
    await rejection;
    callback(null, "late success");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses a valid QBO_REQUEST_TIMEOUT_MS override", () => {
    process.env.QBO_REQUEST_TIMEOUT_MS = "1250";
    expect(getQboRequestTimeoutMs()).toBe(1250);
  });

  it.each(["0", "-1", "1.5", "abc", "600001"])(
    "rejects invalid QBO_REQUEST_TIMEOUT_MS=%s",
    (value) => {
      process.env.QBO_REQUEST_TIMEOUT_MS = value;
      expect(getQboRequestTimeoutMs).toThrow(
        "QBO_REQUEST_TIMEOUT_MS must be an integer from 1 to 600000"
      );
    }
  );

  it("rejects invalid configuration before invoking QBO", async () => {
    process.env.QBO_REQUEST_TIMEOUT_MS = "disabled";
    const operation = vi.fn();

    await expect(promisify(operation)).rejects.toThrow("QBO_REQUEST_TIMEOUT_MS");
    expect(operation).not.toHaveBeenCalled();
  });
});