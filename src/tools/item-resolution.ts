import QuickBooks from "node-quickbooks";
import { resolveItem, type QboLookupCache } from "../client/index.js";

export interface ItemRef {
  value: string;
  name?: string;
}

export async function resolveItemReference(
  client: QuickBooks,
  input: { item_name?: string; item_id?: string },
  lookupCache?: QboLookupCache
): Promise<ItemRef> {
  const name = input.item_name?.trim();
  const id = input.item_id?.trim();
  if (name && id) {
    throw new Error("Provide only one of item_name or item_id per line");
  }
  if (id) return { value: id };
  if (name) return resolveItem(client, name, lookupCache);
  throw new Error("Each line must have either item_name or item_id");
}