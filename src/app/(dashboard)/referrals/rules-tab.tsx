import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MasterDetail, StickyActionBar, type MasterItem } from "@/components/workspace";
import { EVENT_LABEL, type ReferralEventType } from "@/lib/referrals/state-machine";
import { formatRupees } from "@/lib/referrals/summary";
import type { RuleRow, RulesData } from "@/lib/referrals/views";

import { EMPTY_RULE, RuleForm, RuleToggle, SettingsForm, type RuleDraft } from "./controls";
import { Trailing } from "./trailing";

const rupees = (p: number | null) => (p === null ? "" : String(p / 100));
const date = (d: Date | null) => (d ? new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10) : "");
const draftOf = (r: RuleRow): RuleDraft => ({ id: r.id, name: r.name, event: r.event, kind: r.kind, amountRupees: r.kind === "FIXED" ? rupees(r.fixedPaise) : String((r.percentBps ?? 0) / 100), maxRewardRupees: rupees(r.maxRewardPaise), capPerMonthRupees: rupees(r.capPerReferrerMonthPaise), validFrom: date(r.validFrom), validTo: date(r.validTo), clawbackDays: r.clawbackDays === null ? "" : String(r.clawbackDays) });
const when = (d: Date | null) => (d ? d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : null);

export function describeRule(r: RuleRow): string {
  const amount = r.kind === "FIXED" ? formatRupees(r.fixedPaise ?? 0) : `${(r.percentBps ?? 0) / 100}% of the first funding`;
  const bits = [`${amount} on ${EVENT_LABEL[r.event as ReferralEventType] ?? r.event}`];
  if (r.maxRewardPaise !== null) bits.push(`at most ${formatRupees(r.maxRewardPaise)} each`);
  if (r.capPerReferrerMonthPaise !== null) bits.push(`at most ${formatRupees(r.capPerReferrerMonthPaise)} a month per referrer`);
  if (r.validFrom || r.validTo) bits.push(`${r.validFrom ? `from ${when(r.validFrom)}` : ""}${r.validFrom && r.validTo ? " " : ""}${r.validTo ? `until ${when(r.validTo)}` : ""}`);
  bits.push(r.clawbackDays === null ? "no clawback" : `taken back if reversed within ${r.clawbackDays} days`);
  return bits.join(", ");
}

function RuleDetail({ r, canEdit }: { r: RuleRow; canEdit: boolean }) {
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-heading text-base font-semibold">
            {r.name} <Badge variant={r.active ? "success" : "outline"}>{r.active ? "On" : "Off"}</Badge>
          </p>
          <p className="text-muted-foreground">{describeRule(r)}</p>
        </div>
        {canEdit && <RuleToggle id={r.id} active={r.active} />}
      </div>
      {canEdit ? <RuleForm initial={draftOf(r)} /> : <p className="text-xs text-muted-foreground">Only an Admin can change rules.</p>}
      <p className="text-xs text-muted-foreground">Switching a rule on needs the disclosure wording to be signed off by compliance. With no start date it applies from that moment, so it never pays for things that already happened. Pick an earlier start date only if you mean to pay for them.</p>
    </div>
  );
}

function NewRule() {
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="font-heading text-base font-semibold">Add a rule</p>
      <RuleForm initial={EMPTY_RULE} />
      <p className="text-xs text-muted-foreground">A new rule starts switched off. There are no rules until you add one, so nothing accrues by default.</p>
    </div>
  );
}

export function RulesTab({ data, canEdit, canSignoff }: { data: RulesData; canEdit: boolean; canSignoff: boolean }) {
  const { rules, disclaimer, disclosure, velocityLimit, linkBaseConfigured } = data;
  const items: MasterItem[] = [
    { id: "settings", title: "Disclosure and settings", meta: `Review above ${velocityLimit} sign-ups a day`, trailing: <Trailing chips={[{ label: disclosure.signedOff ? "Signed off" : "Needs sign-off", variant: disclosure.signedOff ? "success" : "warning" }]} /> },
    ...rules.map((r) => ({ id: r.id, title: r.name, meta: describeRule(r), trailing: <Trailing chips={[{ label: r.active ? "On" : "Off", variant: r.active ? "success" : "outline" }]} /> })),
    ...(canEdit ? [{ id: "new", title: "Add a rule", meta: rules.length === 0 ? "No rules yet, so nothing accrues" : "A new rule starts switched off" }] : []),
  ];
  const settings = canEdit ? (
    <SettingsForm disclaimer={disclaimer} disclosure={disclosure} canSignoff={canSignoff} velocityLimit={velocityLimit} linkBaseConfigured={linkBaseConfigured} />
  ) : (
    <p className="text-sm text-muted-foreground">Only an Admin can change settings. Review threshold: {velocityLimit} sign-ups a day. Disclosure wording: {disclosure.signedOff ? "signed off by compliance" : "waiting for compliance sign-off"}.</p>
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {rules.length === 0 && <p className="text-sm text-muted-foreground max-lg:hidden">There are no rules, so no reward accrues. Add one when the amounts are decided.</p>}
      <MasterDetail idPrefix="ru" label="Rules and settings" noun="items" items={items} details={{ settings, new: <NewRule />, ...Object.fromEntries(rules.map((r) => [r.id, <RuleDetail key={r.id} r={r} canEdit={canEdit} />])) }} />
      {canEdit && (
        <StickyActionBar phoneOnly label="Rule actions">
          <Button size="lg" render={<Link href="?tab=rules&item=new&sheet=ru-detail" scroll={false} />}>
            Add a rule
          </Button>
        </StickyActionBar>
      )}
    </div>
  );
}
