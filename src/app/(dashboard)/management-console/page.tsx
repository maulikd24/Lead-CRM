import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { getVisibleScope } from "@/lib/policy/visibility";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/shared/stat-card";
import { formatNumber } from "@/lib/utils/format";

export default async function ManagementConsolePage() {
  const session = await requireRole(["TEAM_MANAGER"]);
  const scope = await getVisibleScope(session.user.id, session.user.role);

  const [users, partners] = await Promise.all([
    scope.userIds && scope.userIds.length > 1
      ? prisma.user.findMany({ where: { id: { in: scope.userIds.filter((id) => id !== session.user.id) } }, select: { id: true, name: true, role: true, isActive: true } })
      : [],
    scope.partnerProfileIds && scope.partnerProfileIds.length > 0
      ? prisma.partnerProfile.findMany({
          where: { id: { in: scope.partnerProfileIds } },
          include: { user: { select: { name: true } } },
        })
      : [],
  ]);

  const accrualTotalByPartner = new Map<string, number>();
  if (scope.partnerProfileIds && scope.partnerProfileIds.length > 0) {
    const accruals = await prisma.commissionAccrual.groupBy({
      by: ["partnerProfileId"],
      where: { partnerProfileId: { in: scope.partnerProfileIds } },
      _sum: { accrualAmount: true },
    });
    for (const a of accruals) accrualTotalByPartner.set(a.partnerProfileId, Number(a._sum.accrualAmount ?? 0));
  }
  const totalRevenue = Array.from(accrualTotalByPartner.values()).reduce((sum, v) => sum + v, 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Management Console" description={`Welcome, ${session.user.name}.`} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Team Members" value={users.length} />
        <StatCard label="Partners" value={partners.length} />
        <StatCard label="Total Commission Accrued" value={`₹${formatNumber(totalRevenue)}`} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Team Roster</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Commission figures are lifetime accruals (all statuses) for partners in your scope —
            targets and period-over-period trends are a reasonable next addition, not built here.
          </p>
          <div className="flex flex-col gap-2">
            {users.map((u) => (
              <div key={u.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                <span>{u.name}</span>
                <div className="flex gap-2">
                  <Badge variant="outline">{u.role}</Badge>
                  <Badge variant={u.isActive ? "success" : "destructive"}>{u.isActive ? "Active" : "Inactive"}</Badge>
                </div>
              </div>
            ))}
            {partners.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                <span>{p.user.name}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">₹{formatNumber(accrualTotalByPartner.get(p.id) ?? 0)} accrued</span>
                  <Badge variant="outline">{p.partnerType}</Badge>
                  <Badge variant="outline">{p.tier}</Badge>
                </div>
              </div>
            ))}
            {users.length === 0 && partners.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">No team members assigned yet.</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
