import { describe, expect, it, vi } from "vitest";
import { runLocalOperation } from "./local-operation-coordinator.js";

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
});