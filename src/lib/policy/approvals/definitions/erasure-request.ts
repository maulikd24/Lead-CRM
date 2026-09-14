import { prisma } from "@/lib/db/prisma";
import { registerApproval } from "../registry";

type ErasureRequestPayload = { erasureRequestId: string };

/**
 * Deliberately conservative: approving only flips the ErasureRequest to APPROVED — it does NOT
 * automatically anonymize/delete the underlying Client/PartnerProfile data. Actually executing a
 * data erasure is a distinct, separately-reviewed administrative action, not something that should
 * happen as an automatic side effect of a single approval click on production data.
 */
registerApproval<ErasureRequestPayload>({
  actionType: "ERASURE_REQUEST",
  entity: "ErasureRequest",
  canRequest: (actor) => actor.role === "ADMIN" || actor.role === "FINANCE",
  canDecide: (actor) => actor.role === "ADMIN",
  apply: async (payload) => {
    await prisma.erasureRequest.update({
      where: { id: payload.erasureRequestId },
      data: { status: "APPROVED" },
    });
  },
});
