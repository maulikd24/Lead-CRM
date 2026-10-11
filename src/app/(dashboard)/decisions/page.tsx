import Link from "next/link";
import { notFound } from "next/navigation";

import { DecisionSheet } from "@/components/decision/decision-sheet";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { TabbedWorkspace, lazyPanels, motion } from "@/components/workspace";
import { requireAccess } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { drawerFlagOn } from "@/lib/intelligence/decision/enabled";
import { listDisagreements, listLatestDecisions, loadDecisionViewFor, type ReviewRow } from "@/lib/intelligence/decision/review-db";
import { ABSTAIN_LABEL, RESULT_LABEL } from "@/lib/intelligence/decision/view";
import { actionHeadline, shortDate } from "@/components/decision/labels";
import { ListChecks } from "lucide-react";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "decisions", label: "Decisions" },
  { key: "differences", label: "Where it differs" },
] as const;
const KEYS = TABS.map((t) => t.key);
const FILTERS = [
  { key: "", label: "All" },
  { key: "RECOMMEND", label: "Recommendations" },
  { key: "NO_ACTION", label: "No action" },
  { key: "ABSTAIN", label: "Abstained" },
] as const;

type Params = { tab?: string | string[]; result?: string | string[] };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function Row({ r, index }: { r: ReviewRow; index: number }) {
  const href = `/decisions?${new URLSearchParams({ sheet: "decision", decision: r.decisionId }).toString()}`;
  const material = r.disagreement?.severity === "material";
  return (
    <li className={motion.enter} style={{ ["--i" as string]: Math.min(index, 8) }}>
      <Card size="sm" className="gap-0 py-2">
        <CardContent className="flex flex-col gap-1.5 px-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="min-w-0 truncate text-sm font-medium">
              <Link href={`/clients/${r.clientId}`} className="hover:underline">{r.clientName}</Link>
              <span className="ml-2 text-xs font-normal text-muted-foreground">{r.clientCode}{r.rmName ? ` · ${r.rmName}` : ""}</span>
            </p>
            <div className="flex items-center gap-1.5">
              {r.disagreement && <Badge variant={material ? "destructive" : "outline"}>{material ? "Material difference" : r.disagreement.severity === "minor" ? "Differs" : "Holds back"}</Badge>}
              <Badge variant={r.result === "RECOMMEND" ? "secondary" : "outline"}>{RESULT_LABEL[r.result as keyof typeof RESULT_LABEL] ?? r.result}</Badge>
            </div>
          </div>
          <p className="text-sm">{actionHeadline(r)}{r.abstainReason ? ` · ${ABSTAIN_LABEL[r.abstainReason] ?? r.abstainReason}` : ""}</p>
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{r.owner} · {shortDate(r.createdAt)}{r.result === "RECOMMEND" ? ` · score ${r.priorityScore} (heuristic)` : ""}</span>
            <Link href={href} scroll={false} className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
              Why?
            </Link>
          </div>
          {r.disagreement && <p className="text-xs text-muted-foreground">{r.disagreement.summary}</p>}
        </CardContent>
      </Card>
    </li>
  );
}

function List({ rows, empty }: { rows: ReviewRow[]; empty: string }) {
  if (rows.length === 0) return <EmptyState icon={ListChecks} title="Nothing here yet" description={empty} />;
  return (
    <ul className="grid gap-2 @container lg:grid-cols-2">
      {rows.map((r, i) => (
        <Row key={r.decisionId} r={r} index={i} />
      ))}
    </ul>
  );
}

export default async function DecisionReviewPage({ searchParams }: { searchParams: Promise<Params & { sheet?: string; decision?: string }> }) {
  const session = await requireAccess("decision-review");
  if (!drawerFlagOn()) notFound();
  const sp = await searchParams;
  const viewer = { id: session.user.id, role: session.user.role };
  const visibleUserIds = await getVisibleUserIds(session.user.id, session.user.role);
  const result = FILTERS.some((f) => f.key === one(sp.result)) ? (one(sp.result) ?? "") : "";

  const [rows, diffs] = await Promise.all([listLatestDecisions(viewer, visibleUserIds, { result: result || undefined, take: 60 }), listDisagreements(viewer, visibleUserIds, 60)]);
  const material = diffs.filter((d) => d.disagreement?.severity === "material").length;
  const sheetId = typeof sp.decision === "string" ? sp.decision.slice(0, 64) : null;
  const opened = sheetId ? await loadDecisionViewFor(viewer, visibleUserIds, sheetId) : null;

  const panels = lazyPanels(KEYS, sp.tab, "decisions", {
    decisions: () => (
      <div className="flex flex-col gap-3">
        <nav aria-label="Filter decisions" className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <Link key={f.key} href={f.key ? `/decisions?result=${f.key}` : "/decisions"} aria-current={result === f.key ? "page" : undefined} className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${result === f.key ? "border-transparent bg-foreground text-background" : "border-border text-muted-foreground hover:bg-muted"}`}>
              {f.label}
            </Link>
          ))}
        </nav>
        <List rows={rows} empty="No decisions have been stored yet. They appear once the engine is on and has refreshed some customers." />
      </div>
    ),
    differences: () => <List rows={diffs} empty="The current engine and the Decision Engine agree on every stored decision." />,
  });

  return (
    <>
      <TabbedWorkspace
        lazy
        idPrefix="decisions"
        label="Decision review sections"
        tabs={TABS.map((t) => ({ ...t, ...(t.key === "differences" && diffs.length ? { count: diffs.length } : {}) }))}
        panels={panels}
        header={
          <PageHeader
            title="Decision review"
            description={`Shadow mode: the new engine's decisions for your customers, compared with the current next best action. RMs do not see these. ${material ? `${material} material difference${material === 1 ? "" : "s"} to look at.` : ""}`}
          />
        }
      />
      {opened && <DecisionSheet view={opened.view} title={`${opened.clientName} · ${opened.clientCode}`} canAct={opened.canAct} now={new Date().toISOString()} />}
    </>
  );
}
