import { maskEmail, maskMobile, maskPan as sharedMaskPan } from "@/lib/privacy/contact-mask";
import { prisma } from "@/lib/db/prisma";
import type { Role } from "@/generated/prisma/client";

type MaskRule<T> = {
  fields: (keyof T)[];
  /** true = show unmasked */
  allow: (actor: { role: Role }) => boolean;
  maskWith: (value: unknown) => unknown;
};

export const maskPan = (v: unknown) => (typeof v === "string" ? sharedMaskPan(v) ?? "••••" : "••••");
export const maskTail4 = (v: unknown) => (typeof v === "string" && v.length > 4 ? `••••${v.slice(-4)}` : "••••");

/** Nobody gets a raw PAN, mobile or email through this rule set: the only way to a raw value is the audited reveal on the customer page. */
export const CLIENT_MASK_RULES: MaskRule<{ pan: string | null; mobile: string | null; email: string | null }>[] = [
  { fields: ["pan"], allow: () => false, maskWith: (v) => sharedMaskPan(typeof v === "string" ? v : null) ?? "••••" },
  { fields: ["mobile"], allow: () => false, maskWith: (v) => maskMobile(typeof v === "string" ? v : null) },
  { fields: ["email"], allow: () => false, maskWith: (v) => maskEmail(typeof v === "string" ? v : null) },
];

/** Fire-and-forget access-log write — never blocks or fails the render. */
async function logDataAccess(input: { userId: string; entity: string; entityId: string; fieldName: string }) {
  try {
    await prisma.dataAccessLog.create({ data: input });
  } catch (error) {
    console.error("Failed to write DataAccessLog", error);
  }
}

/**
 * Applied at the query-result boundary, right before rendering/returning. Every field left
 * UNMASKED (the actor was allowed to see it) is logged to DataAccessLog — masking a field is
 * silent, but showing a sensitive one to someone entitled to see it is recorded.
 */
export function applyMasking<T extends Record<string, unknown>>(
  obj: T,
  actor: { id: string; role: Role },
  rules: MaskRule<T>[],
  context: { entity: string; entityId: string },
): T {
  const out: T = { ...obj };
  for (const rule of rules) {
    if (rule.allow(actor)) {
      for (const field of rule.fields) {
        if (field in out) {
          void logDataAccess({ userId: actor.id, entity: context.entity, entityId: context.entityId, fieldName: String(field) });
        }
      }
      continue;
    }
    for (const field of rule.fields) {
      if (field in out) (out as Record<string, unknown>)[field as string] = rule.maskWith(out[field as string]);
    }
  }
  return out;
}
