"use client";

import Link from "next/link";
import { Download } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CountUp, motion, RailFact, ShowFirstBlock, StickyRail, useUrlTab, WorkspacePanel, WorkspaceShell, WorkspaceTabs } from "@/components/workspace";
import { MODE_LABEL, PURPOSE_LABEL, sourceLabel } from "@/lib/consent/view";
import { DND_PURPOSE, type ConsentPolicy } from "@/lib/consent/policy";
import type { PurposeCounts } from "@/lib/consent/stats";
import { cn } from "@/lib/utils";
import { CONSENT_TAB_KEYS, CONSENT_TABS, grantedPct, summariseConsent, type RecentWithdrawal } from "./consent-model";

export type { RecentWithdrawal };

const DAY = 24 * 60 * 60 * 1000;
const fmt = (d: Date) => d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });
const stagger = (i: number) => ({ ["--i" as string]: Math.min(i, 12) });

function Header() {
  return (
    <PageHeader
      title="Consent"
      description="Who has agreed to what, and who has asked not to be contacted."
      actions={
        <Button size="sm" variant="outline" render={<a href="/api/consent/export" download />}>
          <Download aria-hidden /> Export CSV
        </Button>
      }
    />
  );
}

/** A thin percentage bar that grows in once. The percentage is also printed, so colour is never the only signal. */
function Bar({ pct, i, label }: { pct: number; i: number; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted" role="img" aria-label={label}>
        <div className={cn("h-full rounded-full bg-primary", motion.growX)} style={{ width: `${pct}%`, ...stagger(i) }} />
      </div>
      <span aria-hidden className="w-10 text-right text-xs tabular-nums text-muted-foreground">
        {pct}%
      </span>
    </div>
  );
}

function OverviewSection({ counts, enforced }: { counts: PurposeCounts[]; enforced: boolean }) {
  const purposes = counts.filter((c) => c.purpose !== DND_PURPOSE);
  return (
    <>
      <Card className={motion.enter}>
        <CardContent className="flex flex-wrap items-center gap-3 py-1 text-sm">
          <Badge variant={enforced ? "success" : "outline"}>{enforced ? "Enforcement on" : "Enforcement off"}</Badge>
          <span className="text-muted-foreground">
            {enforced
              ? "Agents, journeys and the app-signal push check consent before they act."
              : "Consent is being recorded only. Nothing is blocked yet. Turn enforcement on when the policy has been reviewed."}
          </span>
        </CardContent>
      </Card>

      <ul aria-label="Share granted by purpose" className="grid gap-3 sm:grid-cols-2">
        {purposes.map((c, i) => (
          <li key={c.purpose}>
            <Card className={cn("h-full", motion.enter, motion.lift)} style={stagger(i + 1)}>
              <CardContent className="flex flex-col gap-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-medium">{PURPOSE_LABEL[c.purpose]}</span>
                  <span className="text-xs text-muted-foreground">
                    <CountUp value={c.granted + c.legacyGranted} /> granted
                  </span>
                </div>
                <Bar pct={grantedPct(c)} i={i} label={`${grantedPct(c)} percent granted`} />
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </>
  );
}

function LedgerSection({ counts }: { counts: PurposeCounts[] }) {
  return (
    <Card className={motion.enter}>
      <CardHeader>
        <CardTitle className="text-base">Where things stand</CardTitle>
        <p className="text-sm text-muted-foreground">Current entries per purpose: the latest record for each customer and channel. A customer whose only consent is the lead-form tick counts as granted from the lead form.</p>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-4">
          {counts.map((c, i) => {
            const isDnd = c.purpose === DND_PURPOSE;
            return (
              <li key={c.purpose} className="grid gap-1.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                  <span className="text-sm font-medium">{PURPOSE_LABEL[c.purpose]}</span>
                  <span className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
                    <span>
                      <strong className="font-heading text-foreground">
                        <CountUp value={isDnd ? c.granted : c.granted + c.legacyGranted} />
                      </strong>{" "}
                      {isDnd ? "in force" : "granted"}
                    </span>
                    {c.legacyGranted > 0 && (
                      <span>
                        (<CountUp value={c.legacyGranted} /> from the lead form)
                      </span>
                    )}
                    <span>
                      <strong className="font-heading text-foreground">
                        <CountUp value={c.withdrawn} />
                      </strong>{" "}
                      {isDnd ? "lifted" : "withdrawn"}
                    </span>
                    {!isDnd && (
                      <span>
                        <strong className="font-heading text-foreground">
                          <CountUp value={c.expired} />
                        </strong>{" "}
                        expired
                      </span>
                    )}
                    {!isDnd && (
                      <span>
                        <strong className="font-heading text-foreground">
                          <CountUp value={c.notRecorded} />
                        </strong>{" "}
                        not recorded
                      </span>
                    )}
                  </span>
                </div>
                {!isDnd && <Bar pct={grantedPct(c)} i={i} label={`${grantedPct(c)} percent granted`} />}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

function WithdrawalsSection({ recent, now }: { recent: RecentWithdrawal[]; now: Date }) {
  const table = (list: RecentWithdrawal[]) => (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When (IST)</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Purpose</TableHead>
                <TableHead className="max-lg:hidden">Channel</TableHead>
                <TableHead className="max-lg:hidden">Source</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody striped>
              {list.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-sm text-muted-foreground">
                    {now.getTime() - r.at.getTime() < DAY && (
                      <>
                        <span className={cn(motion.liveDot, "mr-1.5 inline-block size-1.5 rounded-full bg-destructive align-middle")} aria-hidden="true" />
                        <span className="sr-only">Last 24 hours. </span>
                      </>
                    )}
                    {fmt(r.at)}
                  </TableCell>
                  <TableCell className="text-sm">
                    <Link href={`/clients/${r.clientId}`} className="font-mono underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
                      {r.clientCode}
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm">{r.purpose === DND_PURPOSE ? "Do not contact (lifted)" : (PURPOSE_LABEL[r.purpose] ?? r.purpose)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground max-lg:hidden">{r.channel ?? "all channels"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground max-lg:hidden">{sourceLabel(r.source)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
  );
  return (
    <Card className={motion.enter}>
      <CardHeader>
        <CardTitle className="text-base">Withdrawals and do-not-contact</CardTitle>
        <p className="text-sm text-muted-foreground">Consents customers took back, and do-not-contact flags that were lifted.</p>
      </CardHeader>
      <CardContent>
        {recent.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No withdrawals recorded.</p>
        ) : (
          <ShowFirstBlock name="withdrawals" title="All withdrawals" noun="withdrawals" total={recent.length} preview={table(recent.slice(0, 5))} full={table(recent)} />
        )}
      </CardContent>
    </Card>
  );
}

function PolicySection({ policy }: { policy: ConsentPolicy }) {
  return (
    <>
      <Card className={motion.enter}>
        <CardHeader>
          <CardTitle className="text-base">Policy</CardTitle>
          <p className="text-sm text-muted-foreground">What each purpose needs. Edit src/lib/consent/policy.ts, or switch a purpose to record only with an environment setting.</p>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Purpose</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead>Do-not-contact applies</TableHead>
                <TableHead>What it covers</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody striped>
              {Object.entries(policy).map(([purpose, p]) => (
                <TableRow key={purpose}>
                  <TableCell className="text-sm font-medium">{p.label}</TableCell>
                  <TableCell>
                    <Badge variant={p.mode === "required" ? "secondary" : p.mode === "record_only" ? "warning" : "outline"}>{MODE_LABEL[p.mode]}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{p.honoursDoNotContact ? "Yes" : "No"}</TableCell>
                  <TableCell className="min-w-64 whitespace-normal text-sm text-muted-foreground">{p.summary}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className={motion.enter} style={stagger(1)}>
        <CardHeader>
          <CardTitle className="text-base">Export</CardTitle>
          <p className="text-sm text-muted-foreground">The whole ledger as a CSV, newest first, with the customer code only: no names, contact details or reasons. Each download is logged.</p>
        </CardHeader>
        <CardContent>
          <Button size="sm" variant="outline" render={<a href="/api/consent/export" download />}>
            <Download aria-hidden /> Export CSV
          </Button>
        </CardContent>
      </Card>
    </>
  );
}

/** The consent admin page as a tabbed workspace: Overview, Ledger, Withdrawals, Policy and export. Everything is already loaded, so tabs switch instantly. */
export function ConsentAdminView({ policy, counts, recent, enforced, now }: { policy: ConsentPolicy; counts: PurposeCounts[]; recent: RecentWithdrawal[]; enforced: boolean; now: Date }) {
  const { tab, select, hrefFor } = useUrlTab(CONSENT_TAB_KEYS, "overview");
  const sum = summariseConsent({ policy, counts, recent, now });
  const tabs = CONSENT_TABS.map((t) => ({ ...t, count: t.key === "withdrawals" ? recent.length : null }));

  const rail = (
    <StickyRail
      label="Consent key facts"
      facts={
        <>
          <RailFact label="Enforcement" tone={enforced ? "success" : "warning"} hint={enforced ? "Consent is checked before action" : "Recording only"} index={0}>
            {enforced ? "On" : "Off"}
          </RailFact>
          <RailFact label="Do not contact, in force" index={1}>
            <CountUp value={sum.dndInForce} />
          </RailFact>
          <RailFact label="Withdrawn, last 24 hours" live={sum.withdrawnLast24h > 0} index={2}>
            <CountUp value={sum.withdrawnLast24h} />
          </RailFact>
          <RailFact label="Purposes needing an opt-in" index={3}>
            <CountUp value={sum.optInPurposes} />
          </RailFact>
        </>
      }
    />
  );

  return (
    <WorkspaceShell header={<Header />} rail={rail} tabs={<WorkspaceTabs tabs={tabs} active={tab} idPrefix="consent" label="Consent sections" hrefFor={hrefFor} onSelect={select} />}>
      <WorkspacePanel tab={tab} idPrefix="consent">
        {tab === "overview" && <OverviewSection counts={counts} enforced={enforced} />}
        {tab === "ledger" && <LedgerSection counts={counts} />}
        {tab === "withdrawals" && <WithdrawalsSection recent={recent} now={now} />}
        {tab === "policy" && <PolicySection policy={policy} />}
      </WorkspacePanel>
    </WorkspaceShell>
  );
}
