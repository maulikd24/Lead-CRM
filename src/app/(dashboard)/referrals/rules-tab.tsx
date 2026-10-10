import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { motion } from "@/components/workspace";
import { EVENT_LABEL, type ReferralEventType } from "@/lib/referrals/state-machine";
import { formatRupees } from "@/lib/referrals/summary";
import type { RuleRow } from "@/lib/referrals/views";

import { EditRule, RuleForm, RuleToggle, SettingsForm, type RuleDraft } from "./controls";

const rupees = (p: number | null) => (p === null ? "" : String(p / 100));
const date = (d: Date | null) => (d ? new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10) : "");
const draftOf = (r: RuleRow): RuleDraft => ({ id: r.id, name: r.name, event: r.event, kind: r.kind, amountRupees: r.kind === "FIXED" ? rupees(r.fixedPaise) : String((r.percentBps ?? 0) / 100), maxRewardRupees: rupees(r.maxRewardPaise), capPerMonthRupees: rupees(r.capPerReferrerMonthPaise), validFrom: date(r.validFrom), validTo: date(r.validTo) });
const when = (d: Date | null) => (d ? d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : null);

function describe(r: RuleRow): string {
  const amount = r.kind === "FIXED" ? formatRupees(r.fixedPaise ?? 0) : `${(r.percentBps ?? 0) / 100}% of the first funding`;
  const bits = [`${amount} on ${EVENT_LABEL[r.event as ReferralEventType] ?? r.event}`];
  if (r.maxRewardPaise !== null) bits.push(`at most ${formatRupees(r.maxRewardPaise)} each`);
  if (r.capPerReferrerMonthPaise !== null) bits.push(`at most ${formatRupees(r.capPerReferrerMonthPaise)} a month per referrer`);
  if (r.validFrom || r.validTo) bits.push(`${r.validFrom ? `from ${when(r.validFrom)}` : ""}${r.validFrom && r.validTo ? " " : ""}${r.validTo ? `until ${when(r.validTo)}` : ""}`);
  return bits.join(", ");
}

export function RulesTab({ rules, disclaimer, velocityLimit, linkBaseConfigured, canEdit }: { rules: RuleRow[]; disclaimer: string; velocityLimit: number; linkBaseConfigured: boolean; canEdit: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      <Card size="sm" className={motion.enter}>
        <CardHeader>
          <CardTitle className="font-heading text-sm">Reward rules</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {rules.length === 0 ? (
            <p className="text-sm text-muted-foreground">There are no rules, so no reward accrues. Add one when the amounts are decided. A new rule starts switched off.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {rules.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-medium">
                      {r.name} <Badge variant={r.active ? "success" : "outline"}>{r.active ? "On" : "Off"}</Badge>
                    </p>
                    <p className="text-muted-foreground">{describe(r)}</p>
                  </div>
                  {canEdit && (
                    <div className="flex flex-wrap items-center gap-2">
                      <RuleToggle id={r.id} active={r.active} />
                      <EditRule draft={draftOf(r)} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canEdit ? (
            <div className="rounded-lg border border-dashed border-border p-3">
              <p className="mb-2 text-sm font-medium">Add a rule</p>
              <RuleForm />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Only an Admin can change rules.</p>
          )}
          <p className="text-xs text-muted-foreground">Switching a rule on with no start date makes it apply from that moment, so it never pays for things that already happened. Pick an earlier start date only if you mean to pay for them.</p>
        </CardContent>
      </Card>
      <Card size="sm" className={motion.enter} style={{ ["--i" as string]: 1 }}>
        <CardHeader>
          <CardTitle className="font-heading text-sm">Programme settings</CardTitle>
        </CardHeader>
        <CardContent>
          {canEdit ? <SettingsForm disclaimer={disclaimer} velocityLimit={velocityLimit} linkBaseConfigured={linkBaseConfigured} /> : <p className="text-sm text-muted-foreground">Only an Admin can change settings. Review threshold: {velocityLimit} sign-ups a day. Disclaimer: {disclaimer || "not set"}.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
