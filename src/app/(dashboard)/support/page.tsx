import { notFound } from "next/navigation";

import { PageHeader } from "@/components/shared/page-header";
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

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Support SLA" description="Hand-offs from the support assistant: who is waiting, and which clocks are slipping." />
      <SupportView rows={rows} now={now} />
    </div>
  );
}
