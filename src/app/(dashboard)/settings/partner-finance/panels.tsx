"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { motion } from "@/components/workspace";
import { cn } from "@/lib/utils";
import type { WorkspaceSettings } from "@/lib/partners/settings";
import { decideRuleChangeAction, generateOverridesAction, saveSettingAction } from "./actions";
import type { buildPendingRows, overrideRuleRows, taxRuleRows } from "./model";
import { OverrideRuleDialog, TaxRuleDialog } from "./rule-dialogs";

const SELECT = "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";
const STATUS_VARIANT = { Active: "success", Scheduled: "warning", Ended: "outline" } as const;

export function TaxPanel({ rows }: { rows: ReturnType<typeof taxRuleRows> }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">Rules Finance configures for TDS and GST on partner statements. A rule applies to the partner types, PAN status and GST registration you choose, between its dates. Every change is proposed here and approved by a <strong>different</strong> person. Each statement prints the exact rule it used.</p>
        <TaxRuleDialog mode={{ op: "create" }} label="Add a rule" />
      </div>
      {rows.length === 0 ? (
        <Card className={motion.enter}>
          <CardContent className="flex flex-col gap-2">
            <p className="font-heading text-base font-semibold">No tax rules are configured</p>
            <p className="text-sm text-muted-foreground">Until a rule is added and approved, statements deduct nothing and say so in words. There are no default rates, sections or thresholds: every value is typed by Finance.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="px-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Rule</TableHead>
                    <TableHead>Rate</TableHead>
                    <TableHead className="max-lg:hidden">Threshold</TableHead>
                    <TableHead className="max-lg:hidden">Applies to</TableHead>
                    <TableHead className="max-lg:hidden">Dates</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="pr-4"><span className="sr-only">Change</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="pl-4"><span className="font-medium">{r.label}</span><p className="text-xs text-muted-foreground">{r.kind}{r.treatment ? `, ${r.treatment.toLowerCase()}` : ""}</p>
                        <p className="mt-1 whitespace-normal text-xs text-muted-foreground lg:hidden">Threshold {r.threshold}. {r.reach}. {r.from}, {r.to}.</p></TableCell>
                      <TableCell className="tabular-nums">{r.rate}</TableCell>
                      <TableCell className="tabular-nums max-lg:hidden">{r.threshold}</TableCell>
                      <TableCell className="max-w-56 whitespace-normal text-muted-foreground max-lg:hidden">{r.reach}</TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground max-lg:hidden">{r.from}<br />{r.to}</TableCell>
                      <TableCell><Badge variant={STATUS_VARIANT[r.status]}>{r.status}</Badge></TableCell>
                      <TableCell className="pr-4">
                        {r.canChange && (
                          <span className="flex justify-end gap-1 max-lg:flex-col max-lg:items-end">
                            <TaxRuleDialog mode={{ op: "replace", rule: r.rule }} label="Replace" variant="ghost" />
                            <TaxRuleDialog mode={{ op: "retire", rule: r.rule }} label="End" variant="ghost" />
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
      <p className="text-xs text-muted-foreground">Where TDS has a threshold, tax applies to the whole financial-year total once it passes the threshold, and each statement carries the difference from the one before. Dates are India dates; a rule ends the moment its end date begins. Rules are read as of the end of the statement&apos;s period.</p>
    </div>
  );
}

export function OverridesPanel({ rows }: { rows: ReturnType<typeof overrideRuleRows> }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">An optional share of a sub-partner&apos;s commission, paid to the partner above them. One rule per level at a time, with an optional cap per accrual. None exist by default. They produce their own accrual lines and never change how ordinary accruals are worked out.</p>
        <span className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={pending || rows.length === 0}
            onClick={() => start(async () => { const r = await generateOverridesAction(); toast.success(`Override accruals: ${r.created} created, ${r.updated} updated, ${r.unchanged} unchanged.`); })}
          >
            Calculate now
          </Button>
          <OverrideRuleDialog mode={{ op: "create" }} label="Add a rule" />
        </span>
      </div>
      {rows.length === 0 ? (
        <Card className={motion.enter}><CardContent className="flex flex-col gap-2"><p className="font-heading text-base font-semibold">No override rules</p><p className="text-sm text-muted-foreground">Partners earn commission only on their own clients until an override rule is added and approved.</p></CardContent></Card>
      ) : (
        <Card>
          <CardContent className="px-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead className="pl-4">Level</TableHead><TableHead>Rate</TableHead><TableHead className="max-lg:hidden">Cap per accrual</TableHead><TableHead className="max-lg:hidden">Dates</TableHead><TableHead>Status</TableHead><TableHead className="pr-4"><span className="sr-only">Change</span></TableHead></TableRow></TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="pl-4 font-medium">Level {r.level}<p className="whitespace-normal text-xs font-normal text-muted-foreground lg:hidden">Cap {r.cap}. {r.from}, {r.to}.</p></TableCell>
                      <TableCell className="tabular-nums">{r.rate}</TableCell>
                      <TableCell className="tabular-nums max-lg:hidden">{r.cap}</TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground max-lg:hidden">{r.from}<br />{r.to}</TableCell>
                      <TableCell><Badge variant={STATUS_VARIANT[r.status]}>{r.status}</Badge></TableCell>
                      <TableCell className="pr-4">
                        {r.canChange && (
                          <span className="flex justify-end gap-1 max-lg:flex-col max-lg:items-end">
                            <OverrideRuleDialog mode={{ op: "replace", rule: r.rule }} label="Replace" variant="ghost" />
                            <OverrideRuleDialog mode={{ op: "retire", rule: r.rule }} label="End" variant="ghost" />
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
      <p className="text-xs text-muted-foreground">Override accruals are calculated after every accrual recompute, and on request. A terminated ancestor earns nothing; a suspended one still accrues and is held at payout. An override line is dated like the commission accrual it comes from.</p>
    </div>
  );
}

function SaveButton({ pending }: { pending: boolean }) {
  return <Button type="submit" size="sm" disabled={pending}>Save</Button>;
}

function useSave(settingKey: string, build: () => Record<string, unknown>) {
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    setErrors([]);
    start(async () => {
      const r = await saveSettingAction(settingKey, build());
      if (r.ok) toast.success("Saved");
      else setErrors(r.errors);
    });
  };
  return { errors, pending, save };
}

export function StatementsPanel({ settings }: { settings: WorkspaceSettings }) {
  const [lines, setLines] = useState(settings.letterhead.lines.join("\n"));
  const [reg, setReg] = useState(settings.registration.text);
  const a = useSave("letterhead", () => ({ lines: lines.split("\n") }));
  const b = useSave("registration", () => ({ text: reg }));
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card className={motion.enter}>
        <CardHeader><CardTitle className="text-base">Letterhead</CardTitle><CardDescription>Printed at the top of every statement export, one line each (at most six). Kept in the database, never in the code.</CardDescription></CardHeader>
        <CardContent>
          <form onSubmit={a.save} className="flex flex-col gap-3">
            <Label htmlFor="lh" className="sr-only">Letterhead lines</Label>
            <Textarea id="lh" rows={6} value={lines} onChange={(e) => setLines(e.target.value)} placeholder={"Firm name\nAddress line\nCity"} />
            {a.errors.map((e) => <p key={e} role="alert" className="text-sm text-destructive">{e}</p>)}
            <div><SaveButton pending={a.pending} /></div>
          </form>
        </CardContent>
      </Card>
      <Card className={motion.enter} style={{ "--i": 1 } as React.CSSProperties}>
        <CardHeader><CardTitle className="text-base">Registration details</CardTitle><CardDescription>Registration and licence text printed under the letterhead (at most 400 characters).</CardDescription></CardHeader>
        <CardContent>
          <form onSubmit={b.save} className="flex flex-col gap-3">
            <Label htmlFor="reg" className="sr-only">Registration text</Label>
            <Textarea id="reg" rows={6} value={reg} onChange={(e) => setReg(e.target.value)} maxLength={400} />
            {b.errors.map((e) => <p key={e} role="alert" className="text-sm text-destructive">{e}</p>)}
            <div><SaveButton pending={b.pending} /></div>
          </form>
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground lg:col-span-2">Every statement export (CSV or print) is recorded in the audit log with who took it, the period and the number of lines, never the amounts or names. Audit rows are append-only and kept for the life of the audit log (the same retention as every other audit entry); see docs/partner-workspace.md.</p>
    </div>
  );
}

export function ReferralsPanel({ settings, assignees }: { settings: WorkspaceSettings; assignees: { id: string; name: string; role: string }[] }) {
  const [base, setBase] = useState(settings.referral.linkBase ?? "");
  const [days, setDays] = useState(String(settings.referral.lapseDays));
  const [who, setWho] = useState(settings.queries.assigneeUserId ?? "");
  const r = useSave("referral", () => ({ linkBase: base, lapseDays: days }));
  const q = useSave("queries", () => ({ assigneeUserId: who }));
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card className={motion.enter}>
        <CardHeader><CardTitle className="text-base">Referral link and lapse window</CardTitle><CardDescription>A partner&apos;s link adds <code>?ref=&lt;their code&gt;</code> to your public form address. The first touch wins; it lapses after the window if the person has not opened an account.</CardDescription></CardHeader>
        <CardContent>
          <form onSubmit={r.save} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rb">Public form address (https)</Label>
              <Input id="rb" value={base} onChange={(e) => setBase(e.target.value)} placeholder="https://example.com/join" inputMode="url" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rd">Lapse window, in days (1 to 730)</Label>
              <Input id="rd" value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric" className="w-32" />
            </div>
            {r.errors.map((e) => <p key={e} role="alert" className="text-sm text-destructive">{e}</p>)}
            <div><SaveButton pending={r.pending} /></div>
          </form>
        </CardContent>
      </Card>
      <Card className={motion.enter} style={{ "--i": 1 } as React.CSSProperties}>
        <CardHeader><CardTitle className="text-base">Statement queries</CardTitle><CardDescription>When a partner raises a query on a statement line it becomes a task. Choose who receives them; leave blank for the first active Finance user, then the first active Admin.</CardDescription></CardHeader>
        <CardContent>
          <form onSubmit={q.save} className="flex flex-col gap-3">
            <Label htmlFor="qa" className="sr-only">Receives statement queries</Label>
            <select id="qa" className={SELECT} value={who} onChange={(e) => setWho(e.target.value)}>
              <option value="">First active Finance user</option>
              {assignees.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role.toLowerCase()})</option>)}
            </select>
            {q.errors.map((e) => <p key={e} role="alert" className="text-sm text-destructive">{e}</p>)}
            <div><SaveButton pending={q.pending} /></div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export function ApprovePanel({ rows }: { rows: ReturnType<typeof buildPendingRows> }) {
  const [pending, start] = useTransition();
  function decide(id: string, decision: "APPROVED" | "REJECTED") {
    start(async () => {
      const r = await decideRuleChangeAction(id, decision);
      if (r.ok) toast.success(decision === "APPROVED" ? "Approved. The rule now applies." : "Rejected.");
      else toast.error(r.error);
    });
  }
  if (rows.length === 0) return <Card className={motion.enter}><CardContent><p className="text-sm text-muted-foreground">Nothing is waiting for a second person.</p></CardContent></Card>;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">Proposed rule changes wait here until a person other than the one who proposed them approves or rejects them.</p>
      <ul className="flex flex-col gap-3">
        {rows.map((r) => (
          <li key={r.id}>
            <Card className={motion.enter}>
              <CardContent className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">{r.kind}</p>
                  <p className="text-sm font-medium">{r.summary}</p>
                  <p className="text-xs text-muted-foreground">Proposed by {r.by} on {r.when}</p>
                  {r.blockedReason && <p className="mt-1 text-xs text-warning">{r.blockedReason}</p>}
                </div>
                <span className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={pending || !r.canDecide} onClick={() => decide(r.id, "REJECTED")}>Reject</Button>
                  <Button size="sm" disabled={pending || !r.canDecide} onClick={() => decide(r.id, "APPROVED")} className={cn(!r.canDecide && "opacity-60")}>Approve</Button>
                </span>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
