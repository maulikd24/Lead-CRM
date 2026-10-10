import { notFound } from "next/navigation";

import { requireRole } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { supportSlaEnabled } from "@/lib/integrations/freshdesk/flags";
import { loadSupportRows } from "@/lib/integrations/freshdesk/support-data";
import { SupportView } from "./support-view";

export const dynamic = "force-dynamic";

export default async function SupportPage() {
  if (!supportSlaEnabled()) notFound();
  const session = await requireRole(["ADMIN", "MANAGER"]);
  const { id, role } = session.user;
  const now = new Date();
  const visible = role === "ADMIN" ? null : await getVisibleUserIds(id, role);
  const rows = await loadSupportRows(visible, now);

  return <SupportView rows={rows} now={now} />;
}
