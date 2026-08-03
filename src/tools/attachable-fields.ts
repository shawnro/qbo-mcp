export const ATTACHABLE_CATEGORIES = [
  "Contact Photo",
  "Document",
  "Image",
  "Receipt",
  "Signature",
  "Sound",
  "Other",
] as const;

export const ATTACHABLE_ENTITY_TYPES = [
  "Bill",
  "BillPayment",
  "Customer",
  "Deposit",
  "Invoice",
  "Item",
  "JournalEntry",
  "Purchase",
  "SalesReceipt",
  "Vendor",
  "VendorCredit",
] as const;

export function canonicalizeAttachableEntityType(entityType: string): string {
  const canonical = ATTACHABLE_ENTITY_TYPES.find(
    (candidate) => candidate.toLowerCase() === entityType.toLowerCase()
  );
  if (!canonical) {
    throw new Error(
      `Unsupported entity_type "${entityType}". Supported types: ${ATTACHABLE_ENTITY_TYPES.join(", ")}`
    );
  }
  return canonical;
}

export function validateQboEntityId(entityId: string): void {
  if (!/^\d+$/.test(entityId)) {
    throw new Error("entity_id must be a numeric QBO entity ID");
  }
}
