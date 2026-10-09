import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CountUp } from "@/components/consent/count-up";
import styles from "@/components/consent/consent.module.css";
import { MODE_LABEL, PURPOSE_LABEL, sourceLabel } from "@/lib/consent/view";
import { DND_PURPOSE, type ConsentPolicy } from "@/lib/consent/policy";
import type { PurposeCounts } from "@/lib/consent/stats";

export type RecentWithdrawal = { id: string; purpose: string; channel: string | null; source: string; at: Date; clientId: string; clientCode: string };

const DAY = 24 * 60 * 60 * 1000;
const fmt = (d: Date) => d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });

export function ConsentAdminView({ policy, counts, recent, enforced, now }: { policy: ConsentPolicy; counts: PurposeCounts[]; recent: RecentWithdrawal[]; enforced: boolean; now: Date }) {
  return (
    <div className="flex flex-col gap-6">
      <Card className={styles.rise}>
        <CardContent className="flex flex-wrap items-center gap-3 py-1 text-sm">
          <Badge variant={enforced ? "success" : "outline"}>{enforced ? "Enforcement on" : "Enforcement off"}</Badge>
          <span className="text-muted-foreground">
            {enforced
              ? "Agents, journeys and the app-signal push check consent before they act."
              : "Consent is being recorded only. Nothing is blocked yet. Turn enforcement on when the policy below has been reviewed."}
          </span>
        </CardContent>
      </Card>

      <Card className={styles.rise} style={{ ["--i" as string]: 1 }}>
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
                  <TableCell><Badge variant={p.mode === "required" ? "secondary" : p.mode === "record_only" ? "warning" : "outline"}>{MODE_LABEL[p.mode]}</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground">{p.honoursDoNotContact ? "Yes" : "No"}</TableCell>
                  <TableCell className="min-w-64 whitespace-normal text-sm text-muted-foreground">{p.summary}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className={styles.rise} style={{ ["--i" as string]: 2 }}>
        <CardHeader>
          <CardTitle className="text-base">Where things stand</CardTitle>
          <p className="text-sm text-muted-foreground">Current entries per purpose: the latest record for each customer and channel. A customer whose only consent is the lead-form tick counts as granted from the lead form.</p>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-4">
            {counts.map((c, i) => {
              const total = c.granted + c.legacyGranted + c.withdrawn + c.expired + c.notRecorded;
              const pct = total === 0 ? 0 : ((c.granted + c.legacyGranted) / total) * 100;
              const isDnd = c.purpose === DND_PURPOSE;
              return (
                <li key={c.purpose} className="grid gap-1.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                    <span className="text-sm font-medium">{PURPOSE_LABEL[c.purpose]}</span>
                    <span className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
                      <span><strong className="font-heading text-foreground"><CountUp value={isDnd ? c.granted : c.granted + c.legacyGranted} /></strong> {isDnd ? "in force" : "granted"}</span>
                      {c.legacyGranted > 0 && <span>(<CountUp value={c.legacyGranted} /> from the lead form)</span>}
                      <span><strong className="font-heading text-foreground"><CountUp value={c.withdrawn} /></strong> {isDnd ? "lifted" : "withdrawn"}</span>
                      {!isDnd && <span><strong className="font-heading text-foreground"><CountUp value={c.expired} /></strong> expired</span>}
                      {!isDnd && <span><strong className="font-heading text-foreground"><CountUp value={c.notRecorded} /></strong> not recorded</span>}
                    </span>
                  </div>
                  {!isDnd && (
                    <div className={styles.bar} role="img" aria-label={`${Math.round(pct)} percent granted`}>
                      <div className={styles.barFill} style={{ width: `${pct}%`, ["--i" as string]: i }} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      <Card className={styles.rise} style={{ ["--i" as string]: 3 }}>
        <CardHeader>
          <CardTitle className="text-base">Recent withdrawals</CardTitle>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No withdrawals recorded.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When (IST)</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Purpose</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody striped>
                {recent.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-sm text-muted-foreground">
                      {now.getTime() - r.at.getTime() < DAY && (
                        <>
                          <span className={styles.pulseDot} aria-hidden="true" />
                          <span className="sr-only">Last 24 hours. </span>{" "}
                        </>
                      )}
                      {fmt(r.at)}
                    </TableCell>
                    <TableCell className="text-sm">
                      <Link href={`/clients/${r.clientId}`} className="font-mono underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">{r.clientCode}</Link>
                    </TableCell>
                    <TableCell className="text-sm">{PURPOSE_LABEL[r.purpose] ?? r.purpose}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.channel ?? "all channels"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{sourceLabel(r.source)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
