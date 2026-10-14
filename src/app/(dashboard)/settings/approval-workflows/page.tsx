import { prisma } from "@/lib/db/prisma";
import { requireAccess } from "@/lib/auth/require-role";
import { PageHeader } from "@/components/shared/page-header";
import { ApprovalQueue } from "./approval-queue";
import { mobileChangeDisplay } from "@/lib/policy/approvals/definitions/client-mobile-change";

export const metadata = { title: "Approval Workflows" };

export default async function ApprovalWorkflowsPage() {
  await requireAccess("settings-approvals");

  const requests = await prisma.approvalRequest.findMany({
    where: { status: "PENDING" },
    include: { requestedBy: { select: { name: true } } },
    orderBy: { requestedAt: "asc" },
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Approval Workflows"
        description="Sensitive actions that require a second approver before they take effect."
      />
      <ApprovalQueue
        // A pending number change carries the raw new number; the browser only ever gets the masked form.
        requests={requests.map((r) => (r.actionType === "CLIENT_MOBILE_CHANGE" ? { ...r, payload: mobileChangeDisplay(r.payload) } : r))}
        canDecide
      />
    </div>
  );
}
