"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PhoneSheet } from "@/components/workspace";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CUTOVER_CHECKS, autoResult } from "@/lib/system/cutover-checks";
import type { IntegrationState, SystemStatus } from "@/lib/system/status";
import { setCutoverTickAction } from "./actions";

const STATE_LABEL: Record<IntegrationState, string> = { connected: "Connected", needs_setup: "Needs setup", mock: "Mock", flag_off: "Flag off" };
const STATE_VARIANT: Record<IntegrationState, "success" | "warning" | "outline"> = { connected: "success", needs_setup: "warning", mock: "outline", flag_off: "outline" };
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" });

function Fact({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <Card size="sm">
      <CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle></CardHeader>
      <CardContent>
        <p className="font-heading text-lg font-semibold">{value}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

export function OverviewPanel({ status }: { status: SystemStatus }) {
  const { app, database, migrations, flags, attention } = status;
  return (
    <div className="flex flex-col gap-4">
      <Card size="sm">
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2">
            {attention.length ? "Needs attention" : "Nothing needs attention"}
            <Badge variant={attention.length ? "warning" : "success"}>{attention.length}</Badge>
          </CardTitle>
        </CardHeader>
        {attention.length > 0 && (
          <CardContent>
            <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
              {attention.map((a) => (<li key={a}>{a}</li>))}
            </ul>
          </CardContent>
        )}
      </Card>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4 lg:gap-4">
        <Fact label="Version" value={app.shortCommit} sub={`${app.branch ?? "unknown branch"}, ${app.deployEnv}`} />
        <Fact label="Database" value={database.connected ? "Connected" : "Cannot be reached"} sub={database.connected ? `${database.name}, Postgres ${database.serverVersion}, ${database.latencyMs} ms` : "Check the connection settings"} />
        <Fact label="Migrations" value={migrations ? `${migrations.applied} applied` : "Unknown"} sub={migrations ? `${migrations.failed.length} failed, ${migrations.pending === null ? "pending count unavailable here" : `${migrations.pending} pending`}${migrations.latest ? `; latest ${migrations.latest}` : ""}` : "Could not be read"} />
        <Fact label="Flags on" value={`${flags.on.length} of ${flags.on.length + flags.off.length}`} sub="Exactly 1 means on" />
      </div>

      <PhoneSheet name="flags" title="Flags that are on" summary={`${flags.on.length} on${flags.settings.length ? `, ${flags.settings.length} settings` : ""}`}>
      <Card size="sm">
        <CardHeader>
          <CardTitle>Flags that are on</CardTitle>
          <CardDescription>A flag starting NEXT_PUBLIC_ is fixed when the app is built: changing it needs a redeploy.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {flags.on.length === 0 ? <p className="text-sm text-muted-foreground">No flag is on.</p> : (
            <ul className="flex flex-col divide-y divide-border text-sm">
              {flags.on.map((f) => (
                <li key={f.name} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                  <span><span className="font-mono text-xs">{f.name}</span> <span className="text-muted-foreground">{f.label}</span></span>
                  {f.buildTime && <Badge variant="outline">needs a redeploy to change</Badge>}
                </li>
              ))}
            </ul>
          )}
          {flags.settings.length > 0 && (
            <div>
              <p className="mb-1 text-sm font-medium">Settings</p>
              <ul className="flex flex-col gap-1 text-sm">
                {flags.settings.map((s) => (<li key={s.name}><span className="font-mono text-xs">{s.name}</span> = {s.value}</li>))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
      </PhoneSheet>
    </div>
  );
}

export function JobsPanel({ status }: { status: SystemStatus }) {
  const { cron, queues, integrations, env } = status;
  const tick = cron.tick;
  const attentionQueues = queues.filter((q) => q.level === "attention").length;
  const stateCount = (st: IntegrationState) => integrations.filter((i) => i.state === st).length;
  return (
    <div className="flex flex-col gap-4">
      <PhoneSheet name="scheduler" title="Scheduler" summary={tick.minutesAgo !== null ? `Last tick ${tick.minutesAgo} minutes ago, ${cron.jobs.length} jobs` : "No tick recorded"} badge={<Badge variant={tick.state === "ticking" ? "success" : "warning"}>{tick.state === "ticking" ? "Ticking" : "Check"}</Badge>}>
      <Card size="sm">
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2">
            Scheduler
            <Badge variant={tick.state === "ticking" ? "success" : "warning"}>{tick.state === "ticking" ? "Ticking" : tick.state === "stale" ? "Stale" : tick.state === "never" ? "Never ran" : "Unknown"}</Badge>
          </CardTitle>
          <CardDescription>{tick.minutesAgo !== null ? `Last tick ${tick.minutesAgo} minutes ago.` : "No tick recorded."} The scheduler should call the tick route about every 5 minutes.</CardDescription>
        </CardHeader>
        <CardContent>
          {cron.jobs.length === 0 ? <p className="text-sm text-muted-foreground">No scheduled job has recorded a run yet.</p> : (
            <Table>
              <TableHeader><TableRow><TableHead>Job</TableHead><TableHead>Last run (IST)</TableHead></TableRow></TableHeader>
              <TableBody>{cron.jobs.map((j) => (<TableRow key={j.name}><TableCell className="font-mono text-xs">{j.name}</TableCell><TableCell className="text-xs text-muted-foreground">{when(j.lastRunAt)}</TableCell></TableRow>))}</TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      </PhoneSheet>

      <PhoneSheet name="queues" title="Queues" summary={`${queues.length} queues, ${attentionQueues} need attention`}>
      <Card size="sm">
        <CardHeader><CardTitle>Queues</CardTitle><CardDescription>How much is waiting, and how long the oldest item has waited.</CardDescription></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Queue</TableHead><TableHead>Waiting</TableHead><TableHead>Oldest</TableHead></TableRow></TableHeader>
            <TableBody>
              {queues.map((q) => (
                <TableRow key={q.key}>
                  <TableCell className="text-sm">{q.label}</TableCell>
                  <TableCell><Badge variant={q.level === "attention" ? "warning" : "outline"}>{q.depth}</Badge></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{q.oldestMinutes === null ? "-" : `${q.oldestMinutes} minutes`}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      </PhoneSheet>

      <PhoneSheet name="integrations" title="Integrations" summary={`${stateCount("connected")} connected, ${stateCount("needs_setup")} need setup, ${stateCount("mock")} mock, ${stateCount("flag_off")} flag off`}>
      <Card size="sm">
        <CardHeader><CardTitle>Integrations</CardTitle><CardDescription>Connected means live, enabled and credentials saved. It does not test the connection.</CardDescription></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Integration</TableHead><TableHead>State</TableHead><TableHead>Detail</TableHead></TableRow></TableHeader>
            <TableBody>
              {integrations.map((i) => (
                <TableRow key={i.key}>
                  <TableCell className="text-sm">{i.label}</TableCell>
                  <TableCell><Badge variant={STATE_VARIANT[i.state]}>{STATE_LABEL[i.state]}</Badge></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{i.note}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      </PhoneSheet>

      <PhoneSheet name="settings-present" title="Settings present" summary={`${env.filter((e) => e.present).length} of ${env.length} set, ${env.filter((e) => e.required && !e.present).length} required missing`}>
      <Card size="sm">
        <CardHeader><CardTitle>Settings present</CardTitle><CardDescription>Names only: values are never shown.</CardDescription></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Variable</TableHead><TableHead>Needed</TableHead><TableHead>State</TableHead></TableRow></TableHeader>
            <TableBody>
              {env.map((e) => (
                <TableRow key={e.name}>
                  <TableCell><span className="font-mono text-xs">{e.name}</span><span className="block text-xs text-muted-foreground">{e.note}</span></TableCell>
                  <TableCell className="text-xs">{e.required ? "Yes" : "Optional"}</TableCell>
                  <TableCell><Badge variant={e.present ? "success" : e.required ? "destructive" : "outline"}>{e.present ? "Set" : "Not set"}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      </PhoneSheet>
    </div>
  );
}

type Tick = { done: boolean; note: string | null; byName: string | null; at: string | null };

function ManualCheck({ id, title, how, tick }: { id: string; title: string; how: string; tick?: Tick }) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState("");
  const done = tick?.done === true;
  const run = (next: boolean) =>
    start(async () => {
      try {
        const r = await setCutoverTickAction(id, next, next ? note : null);
        if (!r.ok) toast.error(r.error);
        else setNote("");
      } catch {
        toast.error("Could not save. Try again.");
      }
    });
  return (
    <li className="flex flex-col gap-1.5 py-2 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span>
          <span className="font-medium">{title}</span>
          <span className="block text-xs text-muted-foreground">{how}</span>
        </span>
        {done ? <Badge variant="success">Done</Badge> : <Badge variant="outline">Open</Badge>}
      </div>
      {done ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>Done by {tick?.byName ?? "an Admin"}{tick?.at ? `, ${tick.at}` : ""}{tick?.note ? `: ${tick.note}` : ""}</span>
          <Button size="xs" variant="outline" disabled={pending} onClick={() => run(false)}>Undo</Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="sr-only" htmlFor={`note-${id}`}>Note for {title}</label>
          <input id={`note-${id}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Optional note" className="h-8 w-full rounded-lg border border-input bg-background px-2 text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50" />
          <Button size="sm" disabled={pending} onClick={() => run(true)}>Mark done</Button>
        </div>
      )}
    </li>
  );
}

export function ChecksPanel({ status, ticks }: { status: SystemStatus; ticks: Record<string, Tick> }) {
  const manual = CUTOVER_CHECKS.filter((c) => !c.auto);
  const open = manual.filter((c) => !ticks[c.id]?.done).length;
  const groups = [...new Set(CUTOVER_CHECKS.map((c) => c.group))];
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{open} of {manual.length} manual checks still open. Automatic checks are computed from the live system and refresh when you reload.</p>
      {groups.map((g) => {
        const items = CUTOVER_CHECKS.filter((c) => c.group === g);
        const doneCount = items.filter((c) => (c.auto ? autoResult(c, status).ok : ticks[c.id]?.done === true)).length;
        return (
        <PhoneSheet key={g} name={`checks-${g.toLowerCase()}`} title={g} summary={`${doneCount} of ${items.length} done`} badge={<Badge variant={doneCount === items.length ? "success" : "outline"}>{doneCount}/{items.length}</Badge>}>
        <Card size="sm">
          <CardHeader><CardTitle>{g}</CardTitle></CardHeader>
          <CardContent>
            <ul className="flex flex-col divide-y divide-border">
              {CUTOVER_CHECKS.filter((c) => c.group === g).map((c) => {
                if (c.auto) {
                  const r = autoResult(c, status);
                  return (
                    <li key={c.id} className="flex flex-wrap items-start justify-between gap-2 py-2 text-sm">
                      <span><span className="font-medium">{c.title}</span><span className="block text-xs text-muted-foreground">{r.note}</span></span>
                      <Badge variant={r.ok ? "success" : "destructive"}>{r.ok ? "Pass" : "Fail"}</Badge>
                    </li>
                  );
                }
                return <ManualCheck key={c.id} id={c.id} title={c.title} how={c.how} tick={ticks[c.id]} />;
              })}
            </ul>
          </CardContent>
        </Card>
        </PhoneSheet>
        );
      })}
    </div>
  );
}
