import { prisma } from "@/lib/db/prisma";
import { phoneKey } from "@/lib/clients/identity-keys";
import { maskMobile } from "@/lib/privacy/contact-mask";
import { ApprovalBlockedError } from "../service";
import { registerApproval } from "../registry";

export type ClientMobileChangePayload = { clientId: string; newMobile: string };

/**
 * An RM (or Manager) cannot change a customer's number on their own: they ask, and an Admin approves. The number sits in the payload
 * only until it is applied; every screen that lists approvals shows the masked form (see mobileChangeDisplay).
 */
registerApproval<ClientMobileChangePayload>({
  actionType: "CLIENT_MOBILE_CHANGE",
  entity: "Client",
  canRequest: (actor) => actor.role === "RM" || actor.role === "MANAGER",
  canDecide: (actor) => actor.role === "ADMIN",
  precheck: async (payload) => {
    const key = phoneKey(payload.newMobile);
    if (!key) throw new ApprovalBlockedError("The new number is not valid", ["The new number is not a valid mobile number."]);
    const clash = await prisma.client.findFirst({ where: { mobileKey: key, id: { not: payload.clientId }, mergedIntoId: null, isDeleted: false }, select: { id: true } });
    if (clash) throw new ApprovalBlockedError("That number belongs to another customer", ["Another customer already has this number. Merge the customers instead."]);
  },
  apply: async (payload, ctx) => {
    const existing = await prisma.client.findUniqueOrThrow({ where: { id: payload.clientId }, select: { mobile: true } });
    if (existing.mobile === payload.newMobile) return; // idempotent
    await prisma.client.update({ where: { id: payload.clientId }, data: { mobile: payload.newMobile } });
    await prisma.auditLog.create({
      data: {
        userId: ctx.decidedById,
        entity: "Client",
        entityId: payload.clientId,
        action: "mobile_changed",
        reason: `Approved request ${ctx.approvalRequestId}`,
        oldValue: { mobile: maskMobile(existing.mobile) },
        newValue: { mobile: maskMobile(payload.newMobile) },
      },
    });
  },
});

/** What a list may show of a pending number change: never the number itself. */
export function mobileChangeDisplay(payload: unknown): { newMobileMasked: string | null } {
  const v = (payload as Partial<ClientMobileChangePayload> | null)?.newMobile;
  return { newMobileMasked: maskMobile(v) };
}
