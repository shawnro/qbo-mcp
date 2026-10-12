import QuickBooks from "node-quickbooks";
import { resolveItem, type QboLookupCache } from "../client/index.js";

export interface ItemRef {
  value: string;
  name?: string;
}

const ITEM_LOOKUP_CONCURRENCY = 4;

interface NamedItemLookup {
  name: string;
  indexes: number[];
}

export async function resolveItemReference(
  client: QuickBooks,
  input: { item_name?: string; item_id?: string },
  lookupCache?: QboLookupCache
): Promise<ItemRef> {
  return (await resolveItemReferences(client, [input], lookupCache))[0];
}

export async function resolveItemReferences(
  client: QuickBooks,
  inputs: Array<{ item_name?: string; item_id?: string }>,
  lookupCache?: QboLookupCache
): Promise<ItemRef[]> {
  const results = new Array<ItemRef>(inputs.length);
  const namedLookups = new Map<string, NamedItemLookup>();

  inputs.forEach((input, index) => {
    const name = input.item_name?.trim();
    const id = input.item_id?.trim();
    if (name && id) throw new Error("Provide only one of item_name or item_id per line");
    if (id) {
      results[index] = { value: id };
      return;
    }
    if (!name) throw new Error("Each line must have either item_name or item_id");

    const key = name.toLowerCase();
    const pending = namedLookups.get(key);
    if (pending) {
      pending.indexes.push(index);
    } else {
      namedLookups.set(key, { name, indexes: [index] });
    }
  });

  const lookups = [...namedLookups.values()];
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (nextIndex < lookups.length) {
      const lookup = lookups[nextIndex++];
      const itemRef = await resolveItem(client, lookup.name, lookupCache);
      for (const index of lookup.indexes) results[index] = itemRef;
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(ITEM_LOOKUP_CONCURRENCY, lookups.length) },
      () => worker()
    )
  );
  return results;
}