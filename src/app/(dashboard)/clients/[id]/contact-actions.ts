"use server";

import { prisma } from "@/lib/db/prisma";
import { requireAccess } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { canViewClient } from "@/lib/clients/access";
import { revealContactField } from "@/lib/privacy/contact-reveal";

/**
 * The only way a raw mobile, email or CKYC reference reaches the browser. Admin or the assigned RM only; each reveal is written to
 * DataAccessLog (who, which field, when) before the value is returned.
 */
export async function revealClientContactAction(clientId: string, field: string): Promise<{ value: string | null }> {
  const session = await requireAccess("clients");
  const [client, visibleUserIds] = await Promise.all([
    prisma.client.findUnique({ where: { id: clientId }, select: { id: true, assignedToId: true, mobile: true, email: true, ckycRef: true, isDeleted: true } }),
    getVisibleUserIds(session.user.id, session.user.role),
  ]);
  if (!client || !canViewClient(session.user.role, visibleUserIds, client)) throw new Error("Client not found");
  return revealContactField(
    { actor: { id: session.user.id, role: session.user.role }, client, field },
    { log: (data) => prisma.dataAccessLog.create({ data }) },
  );
}
