import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../client/index.js", () => ({
  resolveItem: vi.fn(),
}));

import { resolveItem } from "../../client/index.js";
import { resolveItemReferences } from "../item-resolution.js";

const mockResolveItem = vi.mocked(resolveItem);

describe("resolveItemReferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveItem.mockImplementation(async (_client, name) => ({
      value: `id-${name.toLowerCase()}`,
      name,
    }));
  });

  it("coalesces normalized item names and preserves input order", async () => {
    const refs = await resolveItemReferences({} as never, [
      { item_name: "Widget" },
      { item_id: "42" },
      { item_name: " widget " },
    ]);

    expect(refs).toEqual([
      { value: "id-widget", name: "Widget" },
      { value: "42" },
      { value: "id-widget", name: "Widget" },
    ]);
    expect(mockResolveItem).toHaveBeenCalledOnce();
  });

  it("bounds concurrent item-name lookups", async () => {
    let active = 0;
    let maximumActive = 0;
    mockResolveItem.mockImplementation(async (_client, name) => {
      active++;
      maximumActive = Math.max(maximumActive, active);
      await new Promise<void>((resolve) => queueMicrotask(resolve));
      active--;
      return { value: `id-${name}`, name };
    });

    const refs = await resolveItemReferences(
      {} as never,
      Array.from({ length: 10 }, (_, index) => ({ item_name: `Item ${index}` }))
    );

    expect(maximumActive).toBe(4);
    expect(mockResolveItem).toHaveBeenCalledTimes(10);
    expect(refs.map((ref) => ref.name)).toEqual(
      Array.from({ length: 10 }, (_, index) => `Item ${index}`)
    );
  });

  it("rejects invalid identities before starting any lookup", async () => {
    await expect(resolveItemReferences({} as never, [
      { item_name: "Widget" },
      { item_name: "Service", item_id: "7" },
    ])).rejects.toThrow("Provide only one of item_name or item_id per line");
    expect(mockResolveItem).not.toHaveBeenCalled();
  });

  it("propagates an item lookup failure from a multi-item batch", async () => {
    mockResolveItem.mockImplementation(async (_client, name) => {
      if (name === "Missing") throw new Error("Item not found: Missing");
      return { value: `id-${name}`, name };
    });

    await expect(resolveItemReferences({} as never, [
      { item_name: "Existing" },
      { item_name: "Missing" },
    ])).rejects.toThrow("Item not found: Missing");
  });
});