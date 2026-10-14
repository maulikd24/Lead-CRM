import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown, Sparkles } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge, type badgeVariants } from "@/components/ui/badge";
import { CopilotQuickActions } from "@/components/copilot/quick-actions";
import { EmptyState } from "@/components/shared/empty-state";
import { InfoTip } from "@/components/shared/info-tip";
import { TableRowSkeleton } from "@/components/shared/skeletons";
import { cn } from "@/lib/utils";
import type { VariantProps } from "class-variance-authority";
import type { WorklistEntry } from "@/lib/copilot/worklist";
import { DEFINITIONS } from "@/lib/copilot/definitions";
import { applyCopilotView, OWNERS, parseSort, PRIORITIES, TIMINGS, type CopilotQuery, type CopilotRow, type SortKey } from "@/lib/copilot/list-view";
import { stageLabel } from "@/lib/stage-engine/stage-label";

const HEALTH_VARIANT: Record<string, NonNullable<VariantProps<typeof badgeVariants>["variant"]>> = { HEALTHY: "success", AT_RISK: "warning", CRITICAL: "destructive" };
const PRIORITY_VARIANT = { High: "destructive", Medium: "secondary", Low: "outline" } as const;

function href(q: CopilotQuery, patch: Partial<CopilotQuery>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...q, page: undefined, ...patch })) if (value) params.set(key, value);
  const query = params.toString();
  return query ? `/copilot?${query}` : "/copilot";
}

function Chip({ label, link, active }: { label: string; link: string; active: boolean }) {
  return (
    <Link href={link} aria-current={active ? "true" : undefined} className={cn("rounded-md border px-2 py-0.5 text-xs", active ? "bg-primary text-primary-foreground" : "hover:bg-muted")}>
      {label}
    </Link>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="w-14 text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function SortHead({ label, k, q, info, className }: { label: string; k: SortKey; q: CopilotQuery; info?: React.ReactNode; className?: string }) {
  const cur = parseSort(q);
  const active = cur.key === k;
  const next = active && cur.dir === "asc" ? "desc" : "asc";
  const Icon = !active ? ArrowUpDown : cur.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead aria-sort={active ? (cur.dir === "asc" ? "ascending" : "descending") : "none"} className={className}>
      <Link href={href(q, { sort: k, dir: next })} className="inline-flex items-center gap-1 hover:text-foreground">
        {label}
        <Icon className="size-3" aria-hidden />
      </Link>
      {info}
    </TableHead>
  );
}

/** The one Co-pilot table: every customer who needs attention, with filters, sortable columns and numbered pages. */
export function CopilotList({
  rows,
  entries,
  users,
  query,
  stages,
  showRm,
}: {
  rows: CopilotRow[];
  entries: Map<string, WorklistEntry>;
  users: { id: string; name: string }[];
  query: CopilotQuery;
  stages: string[];
  showRm: boolean;
}) {
  const view = applyCopilotView(rows, query);
  const rms = [...new Set(rows.map((r) => r.rm).filter((n): n is string => !!n))].sort();
  const cols = showRm ? 10 : 9;
  return (
    <Card>
      <CardHeader className="gap-1.5">
        <CardTitle className="text-base">Customers to act on</CardTitle>
        <div className="flex flex-col gap-1">
          <FilterRow label="Priority">
            <Chip label="All" link={href(query, { priority: undefined })} active={!query.priority} />
            {PRIORITIES.map((p) => <Chip key={p} label={p} link={href(query, { priority: p })} active={query.priority === p} />)}
            <Chip label="Critical only" link={href(query, { critical: query.critical === "1" ? undefined : "1" })} active={query.critical === "1"} />
            <InfoTip label="Critical">{DEFINITIONS.critical}</InfoTip>
          </FilterRow>
          <FilterRow label="Stage">
            <Chip label="All" link={href(query, { stage: undefined })} active={!query.stage} />
            {stages.map((s) => <Chip key={s} label={stageLabel(s)} link={href(query, { stage: s })} active={query.stage === s} />)}
          </FilterRow>
          <FilterRow label="Owner">
            <Chip label="Any" link={href(query, { owner: undefined })} active={!query.owner} />
            {OWNERS.map((o) => <Chip key={o} label={o} link={href(query, { owner: o })} active={query.owner === o} />)}
            <InfoTip label="Owner">{DEFINITIONS.owner}</InfoTip>
          </FilterRow>
          <FilterRow label="When">
            <Chip label="Any" link={href(query, { timing: undefined })} active={!query.timing} />
            {TIMINGS.map((t) => <Chip key={t} label={t} link={href(query, { timing: t })} active={query.timing === t} />)}
            <InfoTip label="When">{DEFINITIONS.when}</InfoTip>
          </FilterRow>
          {showRm && rms.length > 0 && (
            <FilterRow label="RM">
              <Chip label="Any" link={href(query, { rm: undefined })} active={!query.rm} />
              {rms.map((n) => <Chip key={n} label={n} link={href(query, { rm: n })} active={query.rm === n} />)}
            </FilterRow>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <Table scrollLabel="Customers to act on" className="text-xs [&_td]:px-2 [&_td]:py-1.5 [&_th]:h-8 [&_th]:px-2">
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">#</TableHead>
              <SortHead label="Client" k="client" q={query} />
              <SortHead label="Stage" k="stage" q={query} info={<InfoTip label="Value unlock">{DEFINITIONS.valueUnlock}</InfoTip>} />
              <TableHead>Health<InfoTip label="SLA">{DEFINITIONS.sla}</InfoTip></TableHead>
              <SortHead label="Priority" k="priority" q={query} />
              <SortHead label="Score" k="score" q={query} info={<InfoTip label="Score">{DEFINITIONS.score}</InfoTip>} />
              <TableHead>Next best action</TableHead>
              <SortHead label="Owner" k="owner" q={query} />
              <SortHead label="When" k="when" q={query} />
              {showRm && <TableHead>RM</TableHead>}
              <TableHead><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody striped>
            {view.rows.map((row, i) => {
              const entry = entries.get(row.clientId);
              return (
                <TableRow key={row.clientId}>
                  <TableCell className="tabular-nums text-muted-foreground">{view.start + i + 1}</TableCell>
                  <TableCell>
                    <Link href={`/clients/${row.clientId}`} className="font-medium hover:underline">{row.name}</Link>
                    <p className="font-mono text-muted-foreground">{row.code}</p>
                  </TableCell>
                  <TableCell>{stageLabel(row.stage)}</TableCell>
                  <TableCell>{row.health ? <Badge variant={HEALTH_VARIANT[row.health]}>{row.health.replace("_", " ")}</Badge> : <span className="text-muted-foreground">—</span>}
                    {row.reason && <p className="mt-0.5 max-w-40 whitespace-normal text-muted-foreground">{row.reason}</p>}
                  </TableCell>
                  <TableCell>{row.priority ? <Badge variant={PRIORITY_VARIANT[row.priority]}>{row.priority}</Badge> : <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="font-semibold tabular-nums">{row.score ?? "—"}</TableCell>
                  <TableCell className="max-w-64 whitespace-normal">
                    <p>{row.action}</p>
                    <p className="text-muted-foreground">{row.why}</p>
                  </TableCell>
                  <TableCell>{row.owner ?? "—"}</TableCell>
                  <TableCell>{row.when ?? "—"}</TableCell>
                  {showRm && <TableCell>{row.rm ?? "Unassigned"}</TableCell>}
                  <TableCell>
                    {entry && (
                      <CopilotQuickActions clientId={entry.client.id} clientName={entry.client.name} assignedToId={entry.client.assignedToId} suggestedFollowUp={entry.suggestedFollowUp} messageSuggestion={entry.messageSuggestion} users={users} />
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {view.rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={cols + 1}>
                  <EmptyState icon={Sparkles} title="No customers match" description="Clear a filter to see more." />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
          <p>{view.total === 0 ? "0 customers" : `${view.start + 1}–${view.start + view.rows.length} of ${view.total}`}</p>
          <nav aria-label="Pages" className="flex gap-1.5">
            {view.page > 1 ? <Link className="rounded-md border px-2 py-0.5 hover:bg-muted" href={href(query, { page: String(view.page - 1) })}>Previous</Link> : <span className="rounded-md border px-2 py-0.5 opacity-50">Previous</span>}
            <span className="px-1 py-0.5">Page {view.page} of {view.pages}</span>
            {view.page < view.pages ? <Link className="rounded-md border px-2 py-0.5 hover:bg-muted" href={href(query, { page: String(view.page + 1) })}>Next</Link> : <span className="rounded-md border px-2 py-0.5 opacity-50">Next</span>}
          </nav>
        </div>
      </CardContent>
    </Card>
  );
}

export function CopilotWorklistSkeleton() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Customers to act on</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableBody>
            {Array.from({ length: 6 }).map((_, i) => (
              <TableRowSkeleton key={i} columns={8} />
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
