import { createHash } from "node:crypto";

/** A short fingerprint of the exact approved text of one variant, printed on the approval annexure so a later change to the copy is visible. Not about a person. */
export function copyFingerprint(v: { format: string; fields: unknown; disclaimer: string }): string {
  return createHash("sha256").update(JSON.stringify({ format: v.format, fields: v.fields, disclaimer: v.disclaimer })).digest("hex").slice(0, 16);
}
