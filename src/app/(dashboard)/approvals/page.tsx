import { ListChecks } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { CountUp, KpiStrip, KpiTile, TabbedWorkspace, WorkspaceHeading, lazyPanels } from "@/components/workspace";
import type { Role } from "@/generated/prisma/client";
import { requireAccess } from "@/lib/auth/require-role";
import { approverKinds, visibleKinds } from "@/lib/policy/approvals/canonical/definitions";
import { definitionOf, mayRequest } from "@/lib/policy/approvals/canonical/definitions";
import { approvalsInboxEnabled } from "@/lib/policy/approvals/canonical/flag";
import { approvalService } from "@/lib/policy/approvals/canonical/wiring";

import { Inbox, KindFilter } from "./inbox";
import { ageLabel, inboxTabs, kindChips, parseKind, parseTab } from "./view-model";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ tab?: string | string[]; kind?: string | string[] }> }) {
  const session = await requireAccess("approvals");
  if (!approvalsInboxEnabled()) {
    return (
      <Card>
        <CardContent>
          <EmptyState icon={ListChecks} title="The approvals inbox is not switched on" description="Ask an administrator to enable it. Every approval still works from its own screen." />
        </CardContent>
      </Card>
    );
  }

  const actor = { id: session.user.id, role: session.user.role as Role, name: session.user.name ?? null };
  const sp = await searchParams;
  const canRequest = visibleKinds(actor.role).some((k) => mayRequest(actor.role, k));
  const tab = parseTab(sp.tab, canRequest);
  const kind = parseKind(sp.kind, tab === "awaiting" ? approverKinds(actor.role) : visibleKinds(actor.role));
  const now = new Date();
  const svc = approvalService();

  const [awaiting, mine] = await Promise.all([svc.listFor(actor, { tab: "awaiting" }), canRequest ? svc.listFor(actor, { tab: "mine" }) : Promise.resolve({ items: [], counts: {} })]);
  const shown = tab === "awaiting" ? awaiting : mine;
  const items = kind ? shown.items.filter((i) => i.kind === kind) : shown.items;
  const oldest = awaiting.items[0];
  const tabDefs = inboxTabs({ awaiting: awaiting.items.length, mine: mine.items.length, canRequest });

  return (
    <TabbedWorkspace
      idPrefix="approvals"
      label="Approval lists"
      lazy
      tabs={tabDefs.map((t) => ({ key: t.key, label: t.label, count: t.count }))}
      panels={lazyPanels(
        tabDefs.map((t) => t.key),
        sp.tab,
        "awaiting",
        Object.fromEntries(
          (["awaiting", "mine"] as const).map((key) => [
            key,
            () => (
              <div className="flex min-h-0 flex-1 flex-col gap-3">
                <KindFilter chips={kindChips(shown.counts, kind, key)} />
                <Inbox items={items} tab={key} now={now} filtered={!!kind} />
              </div>
            ),
          ]),
        ),
      )}
      header={
        <>
          <WorkspaceHeading title="Approvals" description="Everything waiting for a decision from you. Nothing reaches a customer until a person approves it." />
          <KpiStrip label="Approval figures">
            <KpiTile label="Awaiting you" index={0} tone={awaiting.items.length > 0 ? "warning" : "default"}><CountUp value={awaiting.items.length} /></KpiTile>
            <KpiTile label="Longest wait" index={1} hint={oldest ? definitionOf(oldest.kind).label : undefined}><span>{oldest ? ageLabel(oldest.requestedAt, now).replace(" ago", "") : "None"}</span></KpiTile>
            {canRequest && <KpiTile label="Your requests" index={2}><CountUp value={mine.items.length} /></KpiTile>}
          </KpiStrip>
        </>
      }
    />
  );
}
