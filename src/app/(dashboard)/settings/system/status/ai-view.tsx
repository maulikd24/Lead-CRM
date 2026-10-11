"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { KpiStrip, KpiTile, PhoneSheet, motion } from "@/components/workspace";
import { LEVEL_LABEL, type AutonomyLevel } from "@/lib/agents/autonomy";
import type { AgentRow, AiPanel, BudgetState, PurposeRow } from "@/lib/ai/gateway/panel";

import { setAgentEnabledAction } from "../../../agents/actions";

const pct = (r: number | null) => (r === null ? "n/a" : `${(r * 100).toFixed(r > 0 && r < 0.1 ? 1 : 0)}%`);
const usd = (n: number) => (n < 0.01 && n > 0 ? "<$0.01" : `$${n.toFixed(2)}`);
const ms = (n: number | null) => (n === null ? "n/a" : n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${Math.round(n)} ms`);
const BUDGET_LABEL: Record<BudgetState, string> = { ok: "Within budget", near: "Near the cap", over: "Cap reached", unset: "No budget set" };
const BUDGET_VARIANT: Record<BudgetState, "success" | "warning" | "destructive" | "outline"> = { ok: "success", near: "warning", over: "destructive", unset: "outline" };

function BudgetCell({ p }: { p: PurposeRow }) {
  return (
    <div className="flex flex-col items-end gap-0.5 text-right">
      <span className="tabular-nums">{p.budgetUsd === null ? `${usd(p.costTodayUsd)} today` : `${usd(p.costTodayUsd)} of ${usd(p.budgetUsd)}`}</span>
      {p.budgetPct !== null && (
        <span className="block h-1 w-16 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${Math.min(100, Math.round(p.budgetPct))}% of today's budget used`}>
          <span className={`block h-full ${p.budgetState === "over" ? "bg-destructive" : p.budgetState === "near" ? "bg-warning" : "bg-success"}`} style={{ width: `${Math.min(100, p.budgetPct)}%` }} />
        </span>
      )}
      <Badge variant={BUDGET_VARIANT[p.budgetState]}>{BUDGET_LABEL[p.budgetState]}</Badge>
    </div>
  );
}

function Ladder({ level, ceiling }: { level: AutonomyLevel; ceiling: AutonomyLevel }) {
  return (
    <span className="flex items-center gap-0.5" aria-hidden>
      {([0, 1, 2, 3, 4, 5] as const).map((l) => (
        <span key={l} className={`h-2 w-3 rounded-sm ${l <= level ? "bg-primary" : l <= ceiling ? "bg-muted" : "border border-dashed border-muted-foreground/40"}`} />
      ))}
    </span>
  );
}

function KillSwitch({ agent }: { agent: AgentRow }) {
  const ks = agent.killSwitch;
  const [rowOn, setRowOn] = useState(ks.kind === "flag_and_setting" ? ks.rowOn : false);
  const [pending, start] = useTransition();
  if (ks.kind === "global_only") return <p className="text-xs text-muted-foreground">Kill switch: {ks.note}</p>;
  const running = ks.envOn && rowOn;
  const toggle = () =>
    start(async () => {
      const next = !rowOn;
      try {
        const res = await setAgentEnabledAction(agent.key, next);
        if (res.ok) { setRowOn(next); toast.success(next ? "Kill switch off: the agent may run" : "Kill switch on: the agent is stopped"); } else toast.error("Could not change the switch");
      } catch { toast.error("Could not change the switch"); }
    });
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <Badge variant={running ? "success" : "outline"}>{running ? "Running" : "Stopped"}</Badge>
      <span className="text-muted-foreground">Runs only when both are on: environment flag <span className="font-mono">{ks.envFlag}</span> ({ks.envOn ? "on" : "off"}) and the agent setting ({rowOn ? "on" : "off"}).</span>
      <Button type="button" size="sm" variant="outline" onClick={toggle} disabled={pending} aria-pressed={rowOn}>
        {rowOn ? "Turn setting off" : "Turn setting on"}
      </Button>
    </div>
  );
}

function AgentCard({ agent, index }: { agent: AgentRow; index: number }) {
  return (
    <PhoneSheet name={`ai-${agent.key}`} title={agent.key} summary={agent.actions.map((a) => LEVEL_LABEL[a.level]).join(", ")} badge={<Badge variant="outline">{agent.runs} runs</Badge>}>
      <Card size="sm" className={motion.enter} style={{ ["--i" as string]: index }}>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2">
            <span className="font-mono text-sm">{agent.key}</span>
            <span className="text-xs font-normal text-muted-foreground">{agent.runs === 0 ? "No runs in this window" : `${agent.runs} runs, ${pct(agent.failureRate)} failed, ${pct(agent.abstainRate)} abstained`}</span>
          </CardTitle>
          <CardDescription>{agent.purpose}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <ul className="flex flex-col gap-1.5" aria-label={`${agent.key} autonomy levels`}>
            {agent.actions.map((a) => (
              <li key={a.actionType} className="flex flex-wrap items-center justify-between gap-2">
                <span>{a.label}</span>
                <span className="flex items-center gap-2">
                  <Ladder level={a.level} ceiling={a.ceiling} />
                  <span className="text-xs tabular-nums">{LEVEL_LABEL[a.level]}</span>
                  <span className="text-xs text-muted-foreground">ceiling L{a.ceiling}</span>
                </span>
              </li>
            ))}
          </ul>
          <KillSwitch agent={agent} />
          <p className="text-xs text-muted-foreground">Approval: {agent.approval}. If it fails: {agent.fallback}</p>
          {agent.evalSuite && <p className="text-xs text-muted-foreground">A level can only be raised while its eval gate is green ({agent.evalSuite}).</p>}
        </CardContent>
      </Card>
    </PhoneSheet>
  );
}

export function AiPanelView({ data }: { data: AiPanel }) {
  const s = data.summary;
  return (
    <div className="flex flex-col gap-4">
      {data.globalKill && (
        <Card size="sm" role="alert">
          <CardHeader><CardTitle className="flex items-center gap-2">AI is switched off <Badge variant="destructive">AI_KILL_SWITCH=1</Badge></CardTitle><CardDescription>The gateway refuses every model call. Unset the flag to turn AI back on.</CardDescription></CardHeader>
        </Card>
      )}

      <KpiStrip label={`AI figures, last ${data.windowDays} days`}>
        <KpiTile label={`Runs, ${data.windowDays} days`} index={0} hint={`${s.ok} answered`}>{s.runs}</KpiTile>
        <KpiTile label="Failed" index={1} tone={s.failureRate !== null && s.failureRate > 0.05 ? "destructive" : "default"} hint={`${s.failed} runs`}>{pct(s.failureRate)}</KpiTile>
        <KpiTile label="Abstained" index={2} hint={`${s.abstained} runs`}>{pct(s.abstainRate)}</KpiTile>
        <KpiTile label="Blocked" index={3} hint={`${s.blocked} runs`}>{pct(s.blockedRate)}</KpiTile>
        <KpiTile label="Cost today (estimate)" index={4} hint={`${usd(s.costWindowUsd)} over ${data.windowDays} days`}>{usd(s.costTodayUsd)}</KpiTile>
        <KpiTile label="Slowest p95" index={5} hint="worst purpose">{ms(s.p95Ms)}</KpiTile>
      </KpiStrip>

      <PhoneSheet name="ai-purposes" title="Purposes" summary={`${data.purposes.length} registered, cost against budget`} badge={<Badge variant="outline">{data.purposes.filter((p) => p.budgetState === "unset").length} no budget</Badge>}>
        <Card size="sm" className={motion.enter}>
          <CardHeader>
            <CardTitle>Runs, cost and budget by purpose</CardTitle>
            <CardDescription>Every model call names a registered purpose. Cost is an estimate from token counts. A purpose with no budget is refused in production.</CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Purpose</TableHead>
                  <TableHead className="text-right">Runs</TableHead>
                  <TableHead className="text-right">Failed / abstained</TableHead>
                  <TableHead className="hidden text-right md:table-cell">Blocked</TableHead>
                  <TableHead className="hidden text-right md:table-cell">p50 / p95</TableHead>
                  <TableHead className="text-right">Today / daily budget</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.purposes.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <div className="font-mono text-xs">{p.id}</div>
                      <div className="text-xs text-muted-foreground">{p.label}</div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{p.runs}</TableCell>
                    <TableCell className="text-right tabular-nums">{pct(p.failureRate)} / {pct(p.abstainRate)}</TableCell>
                    <TableCell className="hidden text-right tabular-nums md:table-cell">{p.blocked}</TableCell>
                    <TableCell className="hidden text-right tabular-nums md:table-cell">{ms(p.p50Ms)} / {ms(p.p95Ms)}</TableCell>
                    <TableCell className="text-right"><BudgetCell p={p} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </PhoneSheet>

      <div className="flex flex-col gap-2">
        <h3 className="px-1 text-sm font-medium">Agents, autonomy levels and kill switches</h3>
        {data.agents.map((a, i) => (<AgentCard key={a.key} agent={a} index={i} />))}
      </div>

      <p className="px-1 text-xs text-muted-foreground">
        Detail rows are kept {data.retention.days} days{data.retention.oldestRun ? ` (oldest ${new Date(data.retention.oldestRun).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })})` : ""}, then folded into daily totals. No prompt, answer or customer text is stored. Raising an autonomy level is an audited Admin action that needs the agent&apos;s eval gate to be green.
      </p>
    </div>
  );
}
