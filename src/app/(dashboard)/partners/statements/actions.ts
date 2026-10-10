"use server";

import { prisma } from "@/lib/db/prisma";
import { requireNativePartnerWorkspace } from "@/lib/partners/access";
import { raiseStatementQuery, type QueryDb, type RaiseResult } from "@/lib/partners/statement-query";

const str = (v: unknown, max: number) => (typeof v === "string" && v.length <= max ? v : null);

/**
 * "Raise a query" on a statement line. Gated like the workspace itself; the scope that decides which lines may be queried is
 * the one the session gives, never anything from the request. The data layer refuses a line the viewer may not see.
 */
export async function raiseStatementQueryAction(input: { partnerId: string; period: string; lineRef: string; message: string }): Promise<RaiseResult> {
  const access = await requireNativePartnerWorkspace();
  const partnerId = str(input?.partnerId, 64);
  const period = str(input?.period, 64);
  const lineRef = str(input?.lineRef, 80);
  const message = str(input?.message, 2000);
  if (!partnerId || !period || !lineRef || message === null) return { ok: false, code: "invalid", error: "That query could not be read." };
  return raiseStatementQuery(prisma as unknown as QueryDb, { id: access.session.user.id, role: access.role }, access.scope, { partnerId, period, lineRef, message }, new Date());
}
