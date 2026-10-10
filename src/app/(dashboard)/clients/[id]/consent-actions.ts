"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { logActivity } from "@/lib/activities/log-activity";
import { changeConsent, type ChangeInput, type ChangeResult } from "@/lib/consent/change";
import { prismaConsentStore } from "@/lib/consent/store-prisma";
import { PURPOSE_LABEL } from "@/lib/consent/view";

/**
 * Record or withdraw a customer's consent. Authorisation is decided in changeConsent (admin, manager in hierarchy, or the
 * assigned RM); the actor and the source come from the session, never from the browser. Hidden unless NEXT_PUBLIC_CONSENT=1.
 */
export async function changeConsentAction(input: ChangeInput): Promise<ChangeResult> {
  const session = await requireUser();
  const user = { id: session.user.id, role: session.user.role };
  const result = await changeConsent(
    {
      flagOn: () => process.env.NEXT_PUBLIC_CONSENT === "1",
      user,
      loadClient: (id) => prisma.client.findFirst({ where: { id, isDeleted: false }, select: { id: true, assignedToId: true } }),
      visibleUserIds: (u) => getVisibleUserIds(u.id, u.role as typeof session.user.role),
      store: prismaConsentStore,
      now: () => new Date(),
      afterWrite: async (row, client) => {
        const what = `${PURPOSE_LABEL[row.purpose] ?? row.purpose}${row.channel ? ` (${row.channel})` : ""}`;
        await logActivity({
          clientId: client.id,
          userId: user.id,
          type: "NOTE",
          payload: { message: `Consent ${row.status === "GRANTED" ? "recorded" : "withdrawn"}: ${what}`, reason: row.reason },
        });
      },
    },
    input,
  );
  if (result.ok) {
    revalidatePath(`/clients/${String(input.clientId)}`);
    revalidatePath("/settings/consent");
  }
  return result;
}
