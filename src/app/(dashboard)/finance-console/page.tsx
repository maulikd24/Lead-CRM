import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ApprovalQueue } from "../settings/approval-workflows/approval-queue";

export default async function FinanceConsolePage() {
  const session = await requireRole(["FINANCE", "ADMIN"]);

  const requests = await prisma.approvalRequest.findMany({
    where: { status: "PENDING" },
    include: { requestedBy: { select: { name: true } } },
    orderBy: { requestedAt: "asc" },
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Finance Console" description={`Welcome, ${session.user.name}.`} />

      <Card className="border-primary/30 bg-primary/5">
        <CardHeader>
          <CardTitle className="text-base">Revenue Reconciliation</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Not available yet — reconciliation against commission accruals and payouts needs the
            Earnings Engine (Workstream 3), which hasn&apos;t been built. This section will show
            real numbers once that lands.
          </p>
        </CardContent>
      </Card>

      {/* Same component as Settings &gt; Approval Workflows, view-only here (an Admin decides;
          Finance can only monitor via canDecide={session.user.role === "ADMIN"}). */}
      <ApprovalQueue requests={requests} canDecide={session.user.role === "ADMIN"} />
    </div>
  );
}
