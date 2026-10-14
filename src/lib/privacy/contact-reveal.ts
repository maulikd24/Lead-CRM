import type { Role } from "@/generated/prisma/client";
import { MASKED_FIELDS, type MaskedField } from "./contact-mask";

/** Only an Admin, or the RM the customer is assigned to, may ask to see a masked contact value. Managers see the masked form. */
export function canRevealContact(actor: { id: string; role: Role }, client: { assignedToId: string | null }): boolean {
  return actor.role === "ADMIN" || (actor.role === "RM" && client.assignedToId === actor.id);
}

export const isMaskedField = (v: unknown): v is MaskedField => typeof v === "string" && (MASKED_FIELDS as readonly string[]).includes(v);

type Deps = {
  log: (entry: { userId: string; entity: "Client"; entityId: string; fieldName: MaskedField; reason: string }) => Promise<unknown>;
};

/**
 * The audited reveal: the access is written down (who, which field, when) BEFORE the raw value is returned. If the log write fails
 * nothing is returned, so a reveal can never happen without a record.
 */
export async function revealContactField(
  input: { actor: { id: string; role: Role }; client: { id: string; assignedToId: string | null; mobile: string | null; email: string | null; ckycRef: string | null }; field: unknown },
  deps: Deps,
): Promise<{ value: string | null }> {
  if (!isMaskedField(input.field)) throw new Error("Unknown field");
  if (!canRevealContact(input.actor, input.client)) throw new Error("Only an Admin or the assigned RM can reveal this");
  await deps.log({ userId: input.actor.id, entity: "Client", entityId: input.client.id, fieldName: input.field, reason: "reveal" });
  return { value: input.client[input.field] };
}
