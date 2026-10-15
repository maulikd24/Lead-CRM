/** The per-document checklist is part of the KYC pipeline only: at New Lead once collection has started (submitForKyc blocks until mandatory documents are verified) and while the KYC is submitted. */
export const showDocumentChecklist = (stageName: string, startedDocs: boolean): boolean =>
  stageName === "Submitted for KYC" || (stageName === "New Lead" && startedDocs);
