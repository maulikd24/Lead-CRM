import Link from "next/link";
import { notFound } from "next/navigation";
import { Search } from "lucide-react";

import { LedgerList } from "@/components/ledger/ledger-list";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { WorkspaceHeading, WorkspacePanel, WorkspaceShell, WorkspaceTabs } from "@/components/workspace";
import { requireAccess } from "@/lib/auth/require-role";
import { actionLedgerInvestigateEnabled } from "@/lib/ledger/flag";
import { INVESTIGATE_BY, cleanId, parseBy, type InvestigateBy } from "@/lib/ledger/params";
import { getActionLedger } from "@/lib/ledger/read";
import type { LedgerSubject } from "@/lib/ledger/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Investigate an action" };

const PREFIX = "investigate";
const MODES: Record<InvestigateBy, { label: string; hint: string; placeholder: string }> = {
  correlation: { label: "Correlation id", hint: "Every record that carries this id, with the chain around it.", placeholder: "A correlation id from an event, a decision, a model run or an approval" },
  customer: { label: "Customer", hint: "Every action for one customer, whoever the assigned person is. Use the customer id.", placeholder: "The customer id (from the client page address)" },
  run: { label: "Agent run", hint: "The action a model run belongs to. Matched by id where the run names its approval, otherwise by customer and time (marked inferred).", placeholder: "An agent run id (from System status, AI tab)" },
  approval: { label: "Approval", hint: "An approval request id, or a canonical reference such as agent-proposal:<id>.", placeholder: "An approval request id or agent-proposal:<id>" },
};

/**
 * Investigate an action: the audit and debugging tool for "why did the platform do this?". ADMIN only (registry area action-ledger-investigate), read only, a plain GET form
 * (no server action). It answers from the same Action Ledger as the Why tab and shows how the answer was built (statements issued, rows read).
 */
export default async function InvestigatePage({ searchParams }: { searchParams: Promise<{ by?: string; q?: string }> }) {
  const session = await requireAccess("action-ledger-investigate");
  if (!actionLedgerInvestigateEnabled()) notFound();
  const sp = await searchParams;
  const by = parseBy(sp.by);
  const q = cleanId(sp.q);
  const asked = typeof sp.q === "string" && sp.q.trim() !== "";

  let result: Awaited<ReturnType<typeof getActionLedger>> | null = null;
  if (q) {
    const subject: LedgerSubject = by === "customer" ? { type: "client", id: q } : by === "run" ? { type: "agentRun", id: q } : by === "approval" ? { type: "approval", id: q } : { type: "correlation", id: q };
    try {
      result = await getActionLedger(subject, { viewer: { id: session.user.id, role: session.user.role }, limit: 50 });
    } catch (error) {
      console.error("Investigate: ledger failed", error instanceof Error ? error.name : "unknown");
    }
  }

  const tabs = INVESTIGATE_BY.map((k) => ({ key: k, label: MODES[k].label, href: `/settings/control-plane/investigate?by=${k}` }));
  return (
    <WorkspaceShell
      fill={false}
      header={
        <WorkspaceHeading
          title="Investigate an action"
          description="Why did the platform do this? Search by correlation id, customer, agent run or approval."
          actions={<Button size="sm" variant="outline" render={<Link href="/settings/control-plane" />}>Back to control plane</Button>}
        />
      }
      tabs={<WorkspaceTabs tabs={tabs} active={by} idPrefix={PREFIX} label="Search by" />}
    >
      <WorkspacePanel tab={by} idPrefix={PREFIX}>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Search by {MODES[by].label.toLowerCase()}</CardTitle>
            <CardDescription>{MODES[by].hint}</CardDescription>
          </CardHeader>
          <CardContent>
            <form method="get" className="flex flex-wrap items-end gap-2" role="search" aria-label={`Search by ${MODES[by].label.toLowerCase()}`}>
              <input type="hidden" name="by" value={by} />
              <div className="grid min-w-0 flex-1 gap-1.5">
                <label htmlFor="investigate-q" className="text-sm font-medium">{MODES[by].label}</label>
                <Input id="investigate-q" name="q" defaultValue={sp.q ?? ""} maxLength={200} placeholder={MODES[by].placeholder} autoComplete="off" spellCheck={false} className="font-mono" />
              </div>
              <Button type="submit"><Search className="size-4" aria-hidden /> Investigate</Button>
            </form>
          </CardContent>
        </Card>

        {asked && !q && <p role="alert" className="text-sm text-destructive">That does not look like an id. Use letters, digits, colons, dots, dashes or underscores, up to 200 characters.</p>}
        {q && !result && <p role="alert" className="text-sm text-destructive">The search failed. Nothing was changed. Try again; if it keeps failing, check System status.</p>}
        {q && result && !result.ok && <p role="status" className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">Nothing found for that {MODES[by].label.toLowerCase()}. It may not exist, or it may have been erased.</p>}
        {q && result?.ok && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{result.entries.length === 0 ? "Found, but no action entry includes it" : `${result.entries.length} action${result.entries.length === 1 ? "" : "s"}${result.olderNotShown ? " (more not shown)" : ""}`}</CardTitle>
              <CardDescription>Read model, nothing stored. Built with {result.stats.queries} database statements reading {result.stats.rowsRead} rows. A link guessed from customer and time is marked inferred.</CardDescription>
            </CardHeader>
            <CardContent>
              <LedgerList params={{ by, q }} apiBase="/api/action-ledger/investigate" initial={{ entries: result.entries, nextCursor: result.nextCursor }} counts={result.counts} expandAll={result.entries.length === 1} />
            </CardContent>
          </Card>
        )}
      </WorkspacePanel>
    </WorkspaceShell>
  );
}
