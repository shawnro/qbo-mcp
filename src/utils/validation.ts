const DOC_NUMBER_MAX_LENGTH = 21;
const QBO_ENTITY_ID_PATTERN = /^[1-9]\d*$/;

/** Validate an existing Journal Entry ID returned by QuickBooks. */
export function validateJournalEntryId(id: string): string {
  if (!QBO_ENTITY_ID_PATTERN.test(id)) {
    throw new Error("id must be a positive numeric QBO journal entry ID obtained from QuickBooks");
  }
  return id;
}

/** Validate QBO transaction document numbers without altering the supplied value. */
export function validateDocNumber(docNumber: string | undefined): string | undefined {
  if (docNumber !== undefined && docNumber.length > DOC_NUMBER_MAX_LENGTH) {
    throw new Error(`doc_number must be ${DOC_NUMBER_MAX_LENGTH} characters or fewer`);
  }
  return docNumber;
}