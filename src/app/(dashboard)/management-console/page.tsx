import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { getVisibleScope } from "@/lib/policy/visibility";
import { PartnerWorkspaceLink } from "@/components/partners/workspace-link";
import { ShowFirst, TabbedWorkspace, WorkspaceHeading, KpiStrip, KpiTile } from "@/components/workspace";
import { Badge } from "@/components/ui/badge";
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

  const memberRows = users.map((u) => (
    <div key={u.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
      <span className="min-w-0 truncate">{u.name}</span>
      <div className="flex flex-none gap-2">
        <Badge variant="outline">{u.role}</Badge>
        <Badge variant={u.isActive ? "success" : "destructive"}>{u.isActive ? "Active" : "Inactive"}</Badge>
      </div>
    </div>
  ));
  const partnerRows = partners.map((p) => (
    <div key={p.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
      <span className="min-w-0 truncate">{p.user.name}</span>
      <div className="flex flex-none items-center gap-2">
        <span className="text-xs text-muted-foreground max-lg:hidden">₹{formatNumber(Math.round(accrualTotalByPartner.get(p.id) ?? 0))} accrued</span>
        <Badge variant="outline">{p.partnerType}</Badge>
        <Badge variant="outline">{p.tier}</Badge>
      </div>
    </div>
  ));

  return (
    <TabbedWorkspace
      idPrefix="mc"
      label="Management Console sections"
      tabs={[
        { key: "team", label: "Team", count: users.length },
        { key: "partners", label: "Partners", count: partners.length },
      ]}
      header={
        <>
          <WorkspaceHeading title="Management Console" description={`Welcome, ${session.user.name}.`} actions={<PartnerWorkspaceLink />} />
          <KpiStrip label="Team figures">
            <KpiTile label="Team members" index={0}>{users.length}</KpiTile>
            <KpiTile label="Partners" index={1}>{partners.length}</KpiTile>
            <KpiTile label="Commission accrued" index={2} hint="lifetime, all statuses">₹{formatNumber(Math.round(totalRevenue))}</KpiTile>
          </KpiStrip>
        </>
      }
      panels={{
        team: (
          <div className="flex flex-col gap-3">
            {memberRows.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No team members assigned yet.</p> : <ShowFirst name="team" title="Team members" noun="people" items={memberRows} as="div" />}
          </div>
        ),
        partners: (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground max-lg:hidden">Commission figures are lifetime accruals (all statuses) for partners in your scope. Targets and period-over-period trends are not built here.</p>
            {partnerRows.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No partners assigned yet.</p> : <ShowFirst name="partners" title="Partners" noun="partners" items={partnerRows} as="div" />}
          </div>
        ),
      }}
    />
  );
}
