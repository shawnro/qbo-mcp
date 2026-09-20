import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LocalOperationQueueTimeoutError,
  runLocalOperation,
} from "./local-operation-coordinator.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("runLocalOperation", () => {
  it("does not begin profile activation until the in-flight call finishes", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const order: string[] = [];

    const call = runLocalOperation(async () => {
      order.push("call-start");
      await gate;
      order.push("call-end");
    });
    const profileActivation = runLocalOperation(async () => {
      order.push("profile-active");
    });

    await vi.waitFor(() => expect(order).toEqual(["call-start"]));
    release();
    await Promise.all([call, profileActivation]);
    expect(order).toEqual(["call-start", "call-end", "profile-active"]);
  });

  it("expires queued work without starting it later", async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const blocked = runLocalOperation(() => gate, { waitTimeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(0);

    const operation = vi.fn(async () => "completed");
    const queued = runLocalOperation(operation, { waitTimeoutMs: 25 });
    const rejection = expect(queued).rejects.toEqual(
      new LocalOperationQueueTimeoutError(25)
    );

    await vi.advanceTimersByTimeAsync(25);
    await rejection;
    release();
    await blocked;
    await vi.advanceTimersByTimeAsync(0);

    expect(operation).not.toHaveBeenCalled();
  });
});