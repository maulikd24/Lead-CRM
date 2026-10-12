"use client";

import { useState, useTransition } from "react";
import { Plus, Target } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CountUp, motion } from "@/components/workspace";
import { archiveGoalAction, updateGoalAction } from "@/app/(dashboard)/clients/[id]/360/outcomes-actions";
import { formatInr } from "@/lib/outcomes/format";
import { STATIC_COPY } from "@/lib/outcomes/copy";
import type { GoalCardModel, OutcomesViewModel } from "@/lib/outcomes/view-model";
import { cn } from "@/lib/utils";

import { GoalDialog } from "./goal-dialog";

const STATUS_VARIANT = { achieved: "success", ahead: "success", on_track: "secondary", behind: "warning" } as const;
const BAR_TONE = { achieved: "bg-success", ahead: "bg-success", on_track: "bg-primary", behind: "bg-warning" } as const;
const PRIORITY_LABEL: Record<string, string> = { HIGH: "High priority", MEDIUM: "Medium priority", LOW: "Low priority" };

/** One goal: progress, the assumptions it rests on (editable by the RM), the holdings it reads from, and its actions. */
export function GoalCard({ goal: g, index, canEdit, clientId, dialogProps }: { goal: GoalCardModel; index: number; canEdit: boolean; clientId: string; dialogProps: { clientId: string; holdingOptions: OutcomesViewModel["holdingOptions"]; accountOptions: OutcomesViewModel["accountOptions"] } }) {
  const [rate, setRate] = useState(g.rateIsDefault ? "" : String(g.rate));
  const [monthly, setMonthly] = useState(g.plannedMonthly === null ? "" : String(g.plannedMonthly));
  const [pending, start] = useTransition();

  const dirty = rate !== (g.rateIsDefault ? "" : String(g.rate)) || monthly !== (g.plannedMonthly === null ? "" : String(g.plannedMonthly));
  const recalc = () =>
    start(async () => {
      const r = await updateGoalAction(clientId, g.id, { ...g.form, annualRatePct: rate, plannedMonthly: monthly });
      if (r.ok) toast.success("Assumptions updated");
      else toast.error(r.fieldErrors?.annualRatePct ?? r.fieldErrors?.plannedMonthly ?? r.error);
    });
  const archive = () =>
    start(async () => {
      const r = await archiveGoalAction(clientId, g.id);
      if (r.ok) toast.success(r.message ?? "Goal archived");
      else toast.error(r.error);
    });

  const barId = `goal-${g.id}-bar`;
  return (
    <Card className={cn(motion.enter)} style={{ ["--i" as string]: index + 2 }}>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <CardTitle className="truncate text-base">{g.name}</CardTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">{PRIORITY_LABEL[g.priority] ?? g.priority} · target {g.targetAmountText} by {g.targetDateText}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline">{STATIC_COPY.illustrativeBadge}</Badge>
          <Badge variant={STATUS_VARIANT[g.progressStatus]}>{g.statusLabel}</Badge>
          {g.status !== "ACTIVE" && <Badge variant="secondary">{g.status.toLowerCase()}</Badge>}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-end justify-between gap-2 text-sm">
            <span className="font-heading text-2xl font-semibold leading-none">
              <CountUp value={g.currentValue} format={formatInr} label="Linked holdings are worth" />
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">{g.progressPct}% of the target held today</span>
          </div>
          <div id={barId} role="progressbar" aria-label={`${g.name}: share of the target held today`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(g.progressPct)} className="h-2 overflow-hidden rounded-full bg-muted">
            <div className={cn("h-full rounded-full", BAR_TONE[g.progressStatus], motion.growX)} style={{ width: `${Math.max(g.progressPct, g.progressPct > 0 ? 2 : 0)}%` }} />
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Figure label={STATIC_COPY.figureHoldings} value={g.currentValueText} />
          <Figure label={STATIC_COPY.figureTarget} value={g.targetAmountText} />
          <Figure label={STATIC_COPY.figureMonthlyNeeded} value={g.requiredMonthlyText ?? "Date passed"} />
          <Figure label={STATIC_COPY.figureIfLower} value={g.requiredLowerText ?? "Date passed"} />
        </dl>

        <p className="text-sm text-muted-foreground">{g.sentence}</p>

        <div className="rounded-md border border-border p-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{STATIC_COPY.assumptionsHeading}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{g.assumptionsLine}{g.rateIsDefault ? ` ${STATIC_COPY.defaultRateNote}` : ""}</p>
          {canEdit && (
            <div className="mt-2 flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <label htmlFor={`${barId}-rate`} className="text-xs font-medium">{STATIC_COPY.assumedRateLabel} (%)</label>
                <Input id={`${barId}-rate`} className="h-8 w-28" type="number" inputMode="decimal" min={0} max={20} step="0.1" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="Default" />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor={`${barId}-monthly`} className="text-xs font-medium">{STATIC_COPY.plannedMonthlyLabel} (₹)</label>
                <Input id={`${barId}-monthly`} className="h-8 w-32" type="number" inputMode="decimal" min={0} step="any" value={monthly} onChange={(e) => setMonthly(e.target.value)} placeholder="Optional" />
              </div>
              <Button size="sm" variant="outline" onClick={recalc} disabled={!dirty || pending}>{pending ? "Saving" : "Recalculate"}</Button>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Linked holdings</h3>
          {g.linked.length === 0 ? (
            <p className="text-xs text-muted-foreground">{g.hasLinks ? "The linked holdings are no longer held." : STATIC_COPY.noHoldingsLinked}</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {g.linked.map((h) => (
                <li key={`${h.label}-${h.detail}`} className="rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs">
                  {h.label} <span className="text-muted-foreground">{h.detail} · {h.valueText}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {g.notes && <p className="text-xs text-muted-foreground">Note: {g.notes}</p>}
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <GoalDialog {...dialogProps} goal={g} trigger={<Button size="sm" variant="outline">Edit goal</Button>} />
            <Button size="sm" variant="ghost" onClick={archive} disabled={pending}>Archive</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}
