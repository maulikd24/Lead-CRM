import { Badge } from "@/components/ui/badge";
import { ActionButton, CopyButton, DecisionBox } from "@/components/planner/inline-actions";
import { ActionForm } from "@/components/planner/action-form";
import { QrSvg } from "@/components/planner/qr-svg";
import { CHANNELS, type ChannelKey } from "@/lib/planner/channels";
import { checkCopyDraft } from "@/lib/planner/copy";
import type { loadPlanDetail } from "@/lib/planner/db";
import type { Range } from "@/lib/planner/funnel";
import { KIND_LABEL } from "@/lib/planner/destinations";
import { STATUS_LABELS, type PlanStatus } from "@/lib/planner/workflow";

import { addCopyAction, aiDraftCopyAction, copyReviewAction, decidePlanAction, deleteCopyAction, deletePlanAction, editCopyAction, planFlowAction, setLinksTestedAction } from "../actions";
import { PlanForm } from "../plan-form";
import { Empty, NotLiveBadge, inr } from "../ui";

export type Detail = NonNullable<Awaited<ReturnType<typeof loadPlanDetail>>>;
type Viewer = { id: string };

const dt = (d: Date | null | undefined) => (d ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(d) : "Not yet");
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "Not set");
const pct = (r: Range) => `${Math.round(r.low * 100)}% to ${Math.round(r.high * 100)}%`;
const count = (r: Range | null) => (r ? (r.low === r.high ? String(r.low) : `${r.low} to ${r.high}`) : "Not estimated");

function Pair({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="text-sm font-medium">{children}</dd></div>;
}

export function OverviewSection({ d, viewer }: { d: Detail; viewer: Viewer }) {
  const { row, checklist, routing, routingOwnerName, names } = d;
  const status = row.status as PlanStatus;
  const failing = checklist.filter((i) => i.status === "fail");
  const author = row.createdById === viewer.id;
  return (
    <div className="grid gap-4">
      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Pair label="Promise">{row.promise.hook}</Pair>
        <Pair label="Audience">{row.audience.name}</Pair>
        <Pair label="Channel">{CHANNELS[row.channel as ChannelKey]?.label ?? row.channel}</Pair>
        <Pair label="Lands on">{row.destination.name} <NotLiveBadge status={row.destination.status} /> <span className="text-xs font-normal text-muted-foreground">({KIND_LABEL[row.destination.kind as keyof typeof KIND_LABEL] ?? row.destination.kind})</span></Pair>
        <Pair label="Budget and dates">{inr(row.budgetInr)}, {day(row.startDate)} to {day(row.endDate)}</Pair>
        <Pair label="Owner">{names.get(row.ownerId) ?? "Unknown"}</Pair>
        <Pair label="Leads go to">{routing.via === "none" ? "The default assignment (no routing rule matches)" : `${routingOwnerName ?? routing.ownerLabel ?? "the named owner"} (${routing.via === "rule" ? "routing rule" : "fallback"})`}</Pair>
        <Pair label="Follow-up consent">{row.consentPurpose ?? "Not chosen yet"}</Pair>
        {row.creator && <Pair label="Creator">{row.creator.name} ({row.creator.sebiRegistration ?? "no SEBI registration"})</Pair>}
      </dl>

      <section aria-label="Pre-approval checklist" className="rounded-lg border p-3">
        <h2 className="mb-2 font-heading text-sm font-semibold">Pre-approval checklist <span className="font-normal text-muted-foreground">({checklist.length - failing.length} of {checklist.length} pass)</span></h2>
        <ul className="grid gap-1.5 text-sm">
          {checklist.map((i) => <li key={i.id} className="flex gap-2"><span className={i.status === "pass" ? "w-9 shrink-0 text-success" : "w-9 shrink-0 font-medium text-destructive"}>{i.status === "pass" ? "Pass" : "Fail"}</span><span><span className="font-medium">{i.label}.</span> <span className="text-muted-foreground">{i.detail}</span></span></li>)}
        </ul>
      </section>

      <section aria-label="Next step" className="rounded-lg border p-3">
        <h2 className="mb-2 font-heading text-sm font-semibold">Status: {STATUS_LABELS[status]}</h2>
        {status === "DRAFT" && (
          <div className="grid gap-2 text-sm">
            <p className="text-muted-foreground">{failing.some((i) => ["promise_compliant", "creator_registered", "product_registry"].includes(i.id)) ? "A promise, creator or product claim fails its check, so this cannot be sent for review yet." : "When the plan is ready, send it for review. A second person approves it."}</p>
            <div className="flex flex-wrap gap-3"><ActionButton label="Send for review" pendingLabel="Sending" action={planFlowAction.bind(null, row.id, "submit")} /><ActionButton variant="outline" label="Delete this draft" confirm="Delete this draft plan?" action={deletePlanAction.bind(null, row.id)} redirectTo="/planner" /></div>
          </div>
        )}
        {status === "NEEDS_REVIEW" && (
          <div className="grid gap-3 text-sm">
            {author ? <p className="text-muted-foreground">You drafted this plan, so a different person must approve it. You can still ask for changes yourself or wait.</p> : <p className="text-muted-foreground">Read the plan, its links and its copy. Approving records the decision and who made it; it does not publish anything.</p>}
            <DecisionBox decide={decidePlanAction.bind(null, row.id) as never} tickText="I have reviewed this plan, its tracked links and its copy." />
          </div>
        )}
        {status === "APPROVED" && (
          <div className="grid gap-2 text-sm"><p className="text-muted-foreground">Approved by {names.get(row.approvedById ?? "") ?? "a reviewer"} on {dt(row.approvedAt)}. Editing the plan withdraws the approval. Scheduling records the dates only: you run the campaign in the ad tools.</p><div><ActionButton label="Schedule" action={planFlowAction.bind(null, row.id, "schedule")} /></div></div>
        )}
        {status === "SCHEDULED" && <div className="grid gap-2 text-sm"><p className="text-muted-foreground">Scheduled for {day(row.startDate)}. Nothing is published from here.</p><div><ActionButton variant="outline" label="Back to approved" action={planFlowAction.bind(null, row.id, "unschedule")} /></div></div>}
      </section>
    </div>
  );
}

export function LinksSection({ d }: { d: Detail }) {
  const { row, links } = d;
  if (!links.ok) return <div role="alert" className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive">Tracked links cannot be built yet: {links.errors.join(" ")}</div>;
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">Every link carries the campaign code <span className="font-medium text-foreground">{row.code}</span> and the standard campaign names, and never a person&apos;s details.</p>
      <ul className="grid gap-3" aria-label="Tracked links">
        {links.links.map((l) => (
          <li key={l.url} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_auto]">
            <div className="grid min-w-0 gap-1.5 text-sm">
              <div className="flex flex-wrap items-center gap-2"><h2 className="font-heading font-semibold">{l.label}</h2><Badge variant={l.validation.ok ? "success" : "destructive"}>{l.validation.ok ? "Valid" : "Check this link"}</Badge></div>
              <p className="break-all text-xs" data-testid="tracked-url">{l.url}</p>
              {l.message && <p className="text-xs"><span className="text-muted-foreground">Prefilled message: </span>{l.message}</p>}
              {l.validation.problems.map((p) => <p key={p} role="alert" className="text-xs text-destructive">{p}</p>)}
              <div className="flex flex-wrap gap-2"><CopyButton text={l.url} label="Copy link" />{l.message && <CopyButton text={l.message} label="Copy message" />}</div>
            </div>
            {l.validation.ok && <QrSvg text={l.url} label={`QR code for the ${l.label} of ${row.title}`} />}
          </li>
        ))}
      </ul>
      <section aria-label="Campaign names" className="rounded-lg border p-3">
        <h2 className="mb-2 font-heading text-sm font-semibold">Campaign names (UTM convention)</h2>
        <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">{Object.entries(links.utm).map(([k, v]) => <div key={k} className="flex gap-2"><dt className="w-28 shrink-0 text-muted-foreground">{k}</dt><dd className="break-all font-medium">{v}</dd></div>)}</dl>
      </section>
      <section aria-label="Link test" className="rounded-lg border p-3 text-sm">
        <h2 className="mb-1 font-heading text-sm font-semibold">Test before approval</h2>
        {row.linksTestedAt ? (
          <div className="flex flex-wrap items-center gap-3"><span className="text-success">Tested on {dt(row.linksTestedAt)}.</span><ActionButton variant="outline" label="Remove the test mark" action={setLinksTestedAction.bind(null, row.id, false)} /></div>
        ) : (
          <div className="grid gap-2"><p className="text-muted-foreground">Open each link on a phone, check it lands on the right place, then tick it off. Any change to the plan clears the mark.</p><div><ActionButton label="I opened each link and they work" action={setLinksTestedAction.bind(null, row.id, true)} /></div></div>
        )}
      </section>
    </div>
  );
}

export function CopySection({ d, viewer, aiOn }: { d: Detail; viewer: Viewer; aiOn: boolean }) {
  const { row, names } = d;
  const channel = row.channel as ChannelKey;
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">Copy for {CHANNELS[channel]?.label ?? channel}, up to {CHANNELS[channel]?.maxChars} characters with its disclaimer. The market-risk disclaimer is added automatically. A person writes or reviews every draft; the AI only drafts.</p>
      {row.copies.length === 0 ? <Empty>No copy drafts yet.</Empty> : (
        <ul className="grid gap-3" aria-label="Copy drafts">
          {row.copies.map((c) => {
            const issues = checkCopyDraft({ channel: row.channel, body: c.body }).issues;
            const mine = c.source === "STAFF" && c.createdById === viewer.id;
            return (
              <li key={c.id} className="grid gap-2 rounded-lg border p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2"><Badge variant={c.status === "APPROVED" ? "success" : c.status === "NEEDS_REVIEW" ? "warning" : "secondary"}>{c.status === "NEEDS_REVIEW" ? "Needs review" : c.status === "APPROVED" ? "Approved" : "Draft"}</Badge><Badge variant="outline">{c.source === "AI" ? "AI draft" : "Written by staff"}</Badge><span className="text-xs text-muted-foreground">by {names.get(c.createdById) ?? "someone"}</span></div>
                <p className="whitespace-pre-wrap rounded-md bg-muted/40 p-2">{c.body}</p>
                {issues.length > 0 && <ul className="grid gap-0.5 text-xs text-destructive" aria-label="Compliance issues">{issues.map((i) => <li key={i.code}>{i.message}</li>)}</ul>}
                <div className="flex flex-wrap items-start gap-3">
                  {c.status === "DRAFT" && <ActionButton label="Send for review" action={copyReviewAction.bind(null, row.id, c.id, "submit", {})} />}
                  {c.status === "NEEDS_REVIEW" && (
                    <div className="grid gap-2">
                      {mine && <p className="text-xs text-muted-foreground">You wrote this, so a different person must approve it.</p>}
                      <div className="flex flex-wrap gap-2"><ActionButton label="Approve (I have read it and its disclaimer)" action={copyReviewAction.bind(null, row.id, c.id, "approve", { confirmed: true })} /><ActionButton variant="outline" label="Send back" action={copyReviewAction.bind(null, row.id, c.id, "request_changes", {})} /></div>
                    </div>
                  )}
                  {c.status !== "APPROVED" && <ActionButton variant="outline" label="Delete" confirm="Delete this draft?" action={deleteCopyAction.bind(null, row.id, c.id)} />}
                </div>
                {c.status !== "APPROVED" && (
                  <details className="text-xs"><summary className="cursor-pointer text-primary">Edit this draft</summary><div className="mt-2"><ActionForm label="Edit copy" fields={[{ name: "body", label: "Copy", type: "textarea", required: true }]} initial={{ body: c.body }} action={editCopyAction.bind(null, row.id, c.id)} submitLabel="Save draft" /></div></details>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <section aria-label="Add copy" className="grid gap-3 rounded-lg border p-3">
        <h2 className="font-heading text-sm font-semibold">Add a draft</h2>
        <ActionForm label="New copy draft" fields={[{ name: "body", label: "Copy", type: "textarea", required: true, help: "The disclaimer is added for you." }]} action={addCopyAction.bind(null, row.id)} submitLabel="Add draft" resetOnSuccess />
        <div className="flex flex-wrap items-center gap-3 border-t pt-3">
          <ActionButton variant="outline" label="Draft with AI" pendingLabel="Drafting" action={aiDraftCopyAction.bind(null, row.id)} />
          <p className="text-xs text-muted-foreground">{aiOn ? "A draft appears above for a person to review. It never goes anywhere by itself." : "AI drafting is switched off here. Writing copy by hand still works."}</p>
        </div>
      </section>
    </div>
  );
}

export function FunnelSection({ d }: { d: Detail }) {
  const { funnel, outcome } = d;
  const est = funnel.estimate;
  return (
    <div className="grid gap-4">
      <section aria-label="Funnel estimate" className="rounded-lg border p-3 text-sm">
        <h2 className="mb-2 font-heading text-sm font-semibold">What to expect (from our own history)</h2>
        {est.status !== "ok" ? <p className="text-muted-foreground" role="status">{"reason" in est ? est.reason : "No estimate."}</p> : (
          <div className="grid gap-3">
            <dl className="grid gap-3 sm:grid-cols-3">
              <Pair label="Leads">{count(est.leads)}</Pair>
              <Pair label="KYC approved">{count(est.kyc)} <span className="text-xs font-normal text-muted-foreground">({pct(est.rates.kyc)} of leads)</span></Pair>
              <Pair label="Funded">{count(est.funded)} <span className="text-xs font-normal text-muted-foreground">({pct(est.rates.funded)} of leads)</span></Pair>
            </dl>
            {est.notes.map((n) => <p key={n} className="text-xs text-muted-foreground">{n}</p>)}
            <ul className="grid gap-1 text-xs text-muted-foreground">{est.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
          </div>
        )}
        {funnel.source && <p className="mt-3 border-t pt-2 text-xs text-muted-foreground">Source: the campaign outcome numbers ({funnel.source.provider}), {funnel.source.period.from} to {funnel.source.period.to}, as of {dt(new Date(funnel.source.asOf))}. Scope: {funnel.source.scope}. {funnel.source.spend.map((s) => `${s.label} spend ${s.status}${s.ageLabel ? ` (${s.ageLabel})` : ""}`).join("; ")}.{funnel.source.truncated ? " The lead window reached its limit." : ""}</p>}
      </section>
      <section aria-label="Results so far" className="rounded-lg border p-3 text-sm">
        <h2 className="mb-2 font-heading text-sm font-semibold">Results so far</h2>
        {outcome.status === "not_linked" && <p className="text-muted-foreground">Not measured: this plan is not linked to a synced ad campaign. Link one with Edit plan to see leads, KYC and funded customers here.</p>}
        {outcome.status === "not_found" && <p className="text-muted-foreground">{outcome.reason}</p>}
        {outcome.status === "unavailable" && <p className="text-muted-foreground">{outcome.reason}</p>}
        {outcome.status === "ok" && (
          <div className="grid gap-2">
            <dl className="grid gap-3 sm:grid-cols-4"><Pair label="Leads">{outcome.row.leads}</Pair><Pair label="KYC approved">{outcome.row.kyc ?? "n/a"}</Pair><Pair label="Funded">{outcome.row.funded}</Pair><Pair label="Spend">{outcome.row.spend == null ? "Not synced" : inr(Math.round(outcome.row.spend))}</Pair></dl>
            <p className="text-xs text-muted-foreground">Confidence: {outcome.row.confidence.label}. {outcome.row.confidence.reasons.join(" ")} As of {dt(new Date(outcome.source.asOf))}.</p>
          </div>
        )}
      </section>
    </div>
  );
}

export function HistorySection({ d }: { d: Detail }) {
  const { row, names } = d;
  return (
    <section aria-label="Audit trail" className="rounded-lg border p-3 text-sm">
      <h2 className="mb-2 font-heading text-sm font-semibold">Audit trail</h2>
      {row.events.length === 0 ? <p className="text-muted-foreground">Nothing yet.</p> : (
        <ol className="grid gap-1.5">
          {row.events.map((e) => <li key={e.id} className="flex flex-wrap gap-x-2"><span className="tabular-nums text-muted-foreground">{dt(e.createdAt)}</span><span className="font-medium">{names.get(e.actorId) ?? "Someone"}</span><span>{e.kind === "STATUS" ? `moved the plan from ${e.fromStatus ? STATUS_LABELS[e.fromStatus as PlanStatus] ?? e.fromStatus : "new"} to ${e.toStatus ? STATUS_LABELS[e.toStatus as PlanStatus] ?? e.toStatus : "?"}` : e.kind.toLowerCase().replace(/_/g, " ")}{e.note ? `: ${e.note}` : ""}</span></li>)}
        </ol>
      )}
    </section>
  );
}

export async function EditSection({ d }: { d: Detail }) {
  const { row } = d;
  return (
    <div className="grid gap-3">
      <PlanForm planId={row.id} initial={{ title: row.title, audienceId: row.audienceId, promiseId: row.promiseId, channel: row.channel, destinationId: row.destinationId, creatorId: row.creatorId ?? "", budgetInr: row.budgetInr ?? "", startDate: day(row.startDate) === "Not set" ? "" : day(row.startDate), endDate: day(row.endDate) === "Not set" ? "" : day(row.endDate), ownerId: row.ownerId, consentPurpose: row.consentPurpose ?? "", outcomeKey: row.outcomeKey ?? "", notes: row.notes ?? "" }} />
    </div>
  );
}

