import type { QBAttachable } from "../types/index.js";

export const ATTACHABLE_CATEGORIES = [
  "Contact Photo",
  "Document",
  "Image",
  "Receipt",
  "Signature",
  "Sound",
  "Other",
] as const;

export interface SafeAttachableMetadata {
  id: string;
  syncToken: string;
  fileName?: string;
  contentType?: string;
  size?: number;
  note?: string;
  category?: string;
  linkedEntities: Array<{
    type?: string;
    id: string;
    name?: string;
    includeOnSend?: boolean;
  }>;
  createdAt?: string;
  updatedAt?: string;
}

export function safeAttachableMetadata(attachable: QBAttachable): SafeAttachableMetadata {
  return {
    id: attachable.Id,
    syncToken: attachable.SyncToken,
    fileName: attachable.FileName,
    contentType: attachable.ContentType,
    size: attachable.Size,
    note: attachable.Note,
    category: attachable.Category,
    linkedEntities: (attachable.AttachableRef ?? [])
      .filter((ref) => ref.EntityRef?.value)
      .map((ref) => ({
        type: ref.EntityRef?.type,
        id: ref.EntityRef!.value,
        name: ref.EntityRef?.name,
        includeOnSend: ref.IncludeOnSend,
      })),
    createdAt: attachable.MetaData?.CreateTime,
    updatedAt: attachable.MetaData?.LastUpdatedTime,
  };
}

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
