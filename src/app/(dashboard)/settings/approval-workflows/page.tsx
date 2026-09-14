import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { PageHeader } from "@/components/shared/page-header";
import { ApprovalQueue } from "./approval-queue";

export default async function ApprovalWorkflowsPage() {
  await requireRole(["ADMIN"]);

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
      <ApprovalQueue requests={requests} canDecide />
    </div>
  );
}
