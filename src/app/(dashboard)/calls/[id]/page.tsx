import { notFound } from "next/navigation";

import { requireRole } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { CallWorkspace } from "@/components/calls/call-workspace";
import { callsReviewEnabled } from "@/lib/calls/flag";
import { loadCallDetail } from "@/lib/calls/queries";

export default async function CallDetailPage({ params }: { params: Promise<{ id: string }> }) {
  if (!callsReviewEnabled()) notFound();
  const session = await requireRole(["ADMIN", "MANAGER", "RM"]);
  const { id } = await params;
  const scope = await getVisibleUserIds(session.user.id, session.user.role);
  const call = await loadCallDetail(id, scope, new Date());
  if (!call) notFound(); // missing and not-yours look the same
  const isManager = session.user.role === "ADMIN" || session.user.role === "MANAGER";

  return <CallWorkspace call={call} isManager={isManager} />;
}
