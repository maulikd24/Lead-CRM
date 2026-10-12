import type { PartnerReadErrorKind } from "./sample-port";

const COPY: Record<PartnerReadErrorKind, { title: string; description: string }> = {
  not_configured: { title: "Sample data is switched off", description: "Made-up data is only shown outside production. Use the CRM's own data instead." },
  not_found: { title: "Not found", description: "That record is not in the partner programme any more." },
  server: { title: "The partner data could not be read", description: "Nothing is wrong with your data. Try again in a moment." },
};

export const errorCopy = (kind: PartnerReadErrorKind) => COPY[kind];
