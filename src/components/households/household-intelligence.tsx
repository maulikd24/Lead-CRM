import { Lock, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { HOUSEHOLD_POLICY, FACETS } from "@/lib/households/privacy/policy";
import { loadHouseholdSummary } from "@/lib/households/privacy/load";
import { ageLabel } from "@/lib/freshness/stale";
import { prisma } from "@/lib/db/prisma";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { canViewClient } from "@/lib/clients/access";
import { formatNumber } from "@/lib/utils/format";

import { HouseholdConsentForm } from "./household-consent-form";

/**
 * The household summary behind the privacy wall. A member who is another RM's customer shows as "Another household member" with
 * only the fact that the relationship exists, unless they consented to share more (see src/lib/households/privacy/policy.ts).
 * Rendered only for ADMIN and MANAGER (registry area household-intelligence), and only when HOUSEHOLD_INTELLIGENCE_ENABLED=1.
 */
export async function HouseholdIntelligence({ householdId, viewer }: { householdId: string; viewer: { userId: string; role: string } }) {
  const now = new Date();
  const summary = await loadHouseholdSummary(viewer, householdId, now);
  if (!summary) return null;

  // The members whose consent this viewer may record: those they look after themselves.
  const [rows, visible] = await Promise.all([
    prisma.householdMember.findMany({ where: { householdId, client: { isDeleted: false, mergedIntoId: null } }, select: { clientId: true, client: { select: { name: true, clientCode: true, assignedToId: true, isDeleted: true, mergedIntoId: true } } } }),
    getVisibleUserIds(viewer.userId, viewer.role as Parameters<typeof getVisibleUserIds>[1]),
  ]);
  const ownMembers = rows.filter((r) => canViewClient(viewer.role, visible, r.client)).map((r) => ({ id: r.clientId, label: `${r.client.name} (${r.client.clientCode})` }));

  return (
    <Card role="region" aria-labelledby="hh-intel">
      <CardHeader>
        <CardTitle id="hh-intel" className="flex items-center gap-2 text-base"><ShieldCheck className="size-4 text-muted-foreground" aria-hidden /> Household view</CardTitle>
        <CardDescription>
          {summary.memberCount} member{summary.memberCount === 1 ? "" : "s"}.{summary.asOf ? ` Portfolio figures as of ${ageLabel(summary.asOf, now)}.` : ""} {summary.wall.note}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="overflow-x-auto" role="region" aria-label="Household members and what you may see of each" tabIndex={0}>
          <table className="w-full min-w-[34rem] text-sm">
            <caption className="sr-only">Household members and what you may see of each</caption>
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th scope="col" className="py-1.5 pr-3 font-medium">Member</th>
                <th scope="col" className="py-1.5 pr-3 font-medium">Relationship</th>
                <th scope="col" className="py-1.5 pr-3 font-medium">Portfolio</th>
                <th scope="col" className="py-1.5 font-medium">Service</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {summary.members.map((m) => (
                <tr key={m.key}>
                  <th scope="row" className="py-2 pr-3 text-left font-medium">
                    {m.identity.visible ? m.identity.value.name : <span className="inline-flex items-center gap-1.5 text-muted-foreground"><Lock className="size-3.5" aria-hidden /> Another household member</span>}
                    {m.identity.visible && <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">{m.identity.value.clientCode}</span>}
                  </th>
                  <td className="py-2 pr-3">{m.relationshipType.visible ? (m.relationshipType.value.type ?? "Member") : <span className="text-muted-foreground">Shown only with consent</span>}</td>
                  <td className="py-2 pr-3">
                    {m.portfolio.visible ? (m.portfolio.value.aum !== null ? `₹${formatNumber(m.portfolio.value.aum)}` : `${m.portfolio.value.band}`) : <span className="text-muted-foreground">Not shared</span>}
                    {m.portfolio.visible && <span className="ml-1 text-xs text-muted-foreground">{m.portfolio.value.accountCount} account{m.portfolio.value.accountCount === 1 ? "" : "s"}</span>}
                  </td>
                  <td className="py-2">
                    {m.service.visible ? (m.service.value.openComplaints + m.service.value.overdueCommitments === 0 ? "Nothing open" : `${m.service.value.openComplaints} open complaint${m.service.value.openComplaints === 1 ? "" : "s"}, ${m.service.value.overdueCommitments} overdue promise${m.service.value.overdueCommitments === 1 ? "" : "s"}`) : <span className="text-muted-foreground">Not shared</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {summary.aggregate.aum !== null && (
          <p className="text-sm">
            Combined portfolio of the members you look after: <strong>₹{formatNumber(summary.aggregate.aum)}</strong>
            {summary.aggregate.partial && <Badge variant="outline" className="ml-2">Partial: other members are not included</Badge>}
          </p>
        )}
        <details className="text-sm">
          <summary className="cursor-pointer font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">What each member can see of the others</summary>
          <p className="mt-2 text-xs text-muted-foreground">Default deny. For a member who is another relationship manager&apos;s customer, only that the relationship exists is visible, unless that member has consented to more.</p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {FACETS.map((f) => (
              <li key={f} className="flex flex-wrap items-center gap-2">
                <Badge variant={HOUSEHOLD_POLICY[f].crossScope === "always" ? "secondary" : HOUSEHOLD_POLICY[f].crossScope === "consent" ? "warning" : "destructive"}>{HOUSEHOLD_POLICY[f].crossScope === "always" ? "Always" : HOUSEHOLD_POLICY[f].crossScope === "consent" ? "With consent" : "Never"}</Badge>
                <span>{HOUSEHOLD_POLICY[f].label}</span>
              </li>
            ))}
          </ul>
        </details>
        {ownMembers.length > 0 && <HouseholdConsentForm householdId={householdId} subjects={ownMembers} others={summary.members.length > 1 ? rows.map((r) => ({ id: r.clientId, label: `${r.client.name} (${r.client.clientCode})`, own: ownMembers.some((o) => o.id === r.clientId) })) : []} />}
      </CardContent>
    </Card>
  );
}
