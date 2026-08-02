const DOC_NUMBER_MAX_LENGTH = 21;

/** Validate QBO transaction document numbers without altering the supplied value. */
export function validateDocNumber(docNumber: string | undefined): string | undefined {
  if (docNumber !== undefined && docNumber.length > DOC_NUMBER_MAX_LENGTH) {
    throw new Error(`doc_number must be ${DOC_NUMBER_MAX_LENGTH} characters or fewer`);
  }
  return docNumber;
}