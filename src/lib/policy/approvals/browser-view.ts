import { prisma } from "@/lib/db/prisma";
import { maskMobile } from "@/lib/privacy/contact-mask";

type Row = { actionType: string; entityId: string; payload: unknown };

/**
 * Every page that lists approvals passes its rows through here before they reach a client component. A pending number change carries
 * the raw new number; the browser gets only the customer's name and code plus the old and new number masked, so an approver can decide.
 */
export async function toBrowserApprovals<T extends Row>(rows: T[]): Promise<T[]> {
  const ids = [...new Set(rows.filter((r) => r.actionType === "CLIENT_MOBILE_CHANGE").map((r) => r.entityId))];
  const clients = ids.length ? await prisma.client.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, clientCode: true, mobile: true } }) : [];
  const byId = new Map(clients.map((c) => [c.id, c]));
  return rows.map((r) => {
    if (r.actionType !== "CLIENT_MOBILE_CHANGE") return r;
    const c = byId.get(r.entityId);
    const newMobile = (r.payload as { newMobile?: string } | null)?.newMobile;
    return {
      ...r,
      payload: { newMobileMasked: maskMobile(newMobile), oldMobileMasked: maskMobile(c?.mobile), clientName: c?.name ?? null, clientCode: c?.clientCode ?? null },
    };
  });
}
