"use client";

import { useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import * as actions from "./actions";

type Result = { ok: true; message?: string } | { ok: false; error: string };

/** Runs a server action, shows its message, and never lets a thrown error escape as a blank screen. */
function useAct() {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<Result>, okText: string, after?: () => void) =>
    start(async () => {
      try {
        const r = await fn();
        if (r.ok) {
          toast.success(r.message ?? okText);
          after?.();
        } else toast.error(r.error);
      } catch {
        toast.error("Something went wrong. Nothing was changed.");
      }
    });
  return { pending, run };
}

/** A button that first asks for a short written reason or note, then runs the action. */
export function ReasonAction({ label, prompt, minLength = 3, variant = "outline", onSubmit, okText }: { label: string; prompt: string; minLength?: number; variant?: "outline" | "default" | "ghost" | "destructive"; onSubmit: (text: string) => Promise<Result>; okText: string }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const { pending, run } = useAct();
  if (!open)
    return (
      <Button size="sm" variant={variant} onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => onSubmit(value), okText, () => {
          setOpen(false);
          setValue("");
        });
      }}
    >
      <Label className="sr-only" htmlFor={`reason-${label}`}>
        {prompt}
      </Label>
      <Input id={`reason-${label}`} value={value} onChange={(e) => setValue(e.target.value)} placeholder={prompt} className="h-8 w-56" autoFocus maxLength={300} />
      <Button size="sm" type="submit" disabled={pending || value.trim().length < minLength}>
        {pending ? "Working…" : "Confirm"}
      </Button>
      <Button size="sm" type="button" variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </form>
  );
}

export function SimpleAction({ label, onRun, okText, variant = "outline", disabled }: { label: string; onRun: () => Promise<Result>; okText: string; variant?: "outline" | "default" | "ghost"; disabled?: boolean }) {
  const { pending, run } = useAct();
  return (
    <Button size="sm" variant={variant} disabled={pending || disabled} onClick={() => run(onRun, okText)}>
      {pending ? "Working…" : label}
    </Button>
  );
}

export const RefreshButton = () => <SimpleAction label="Refresh progress" variant="outline" okText="Refreshed." onRun={() => actions.refreshAction()} />;

export function EnrollForm() {
  const [code, setCode] = useState("");
  const { pending, run } = useAct();
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => actions.enrollReferrerAction(code), "Referrer added with a first code.", () => setCode(""));
      }}
    >
      <div className="flex flex-col gap-1">
        <Label htmlFor="enroll-code">Customer code</Label>
        <Input id="enroll-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="CL-00001" className="h-8 w-40" maxLength={40} />
      </div>
      <Button size="sm" type="submit" disabled={pending || !code.trim()}>
        {pending ? "Adding…" : "Make a referrer"}
      </Button>
    </form>
  );
}

export function InviteDraft({ referrerId }: { referrerId: string }) {
  const [draft, setDraft] = useState<{ text: string; code: string; consentEnforced: boolean } | null>(null);
  const [pending, start] = useTransition();
  const make = () =>
    start(async () => {
      try {
        const r = await actions.draftInviteAction(referrerId);
        if (r.ok) setDraft({ text: r.text, code: r.code, consentEnforced: r.consentEnforced });
        else toast.error(r.error);
      } catch {
        toast.error("Could not prepare the draft.");
      }
    });
  return (
    <div className="flex flex-col gap-2">
      <Button size="sm" variant="outline" disabled={pending} onClick={make}>
        {pending ? "Checking…" : "Draft an invitation"}
      </Button>
      {draft && (
        <div className="flex max-w-md flex-col gap-2 rounded-lg border border-border p-3 text-sm">
          <p className="text-xs text-muted-foreground">Draft only. Nothing is sent from here. Read it, then send it yourself from your own channel. It passed the consent check{draft.consentEnforced ? "" : " (consent enforcement is off on this server)"} and the copy guardrails.</p>
          <Textarea readOnly value={draft.text} rows={6} aria-label={`Invitation draft for code ${draft.code}`} />
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => navigator.clipboard?.writeText(draft.text).then(() => toast.success("Copied."), () => toast.error("Could not copy."))}>
              Copy text
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
              Close
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function SettingsForm({ disclaimer, velocityLimit, linkBaseConfigured }: { disclaimer: string; velocityLimit: number; linkBaseConfigured: boolean }) {
  const [d, setD] = useState(disclaimer);
  const [v, setV] = useState(String(velocityLimit));
  const a = useAct();
  const b = useAct();
  return (
    <div className="flex flex-col gap-5">
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          a.run(() => actions.saveSettingAction("disclaimer", d), "Disclaimer saved.");
        }}
      >
        <Label htmlFor="disclaimer">Mandatory disclaimer</Label>
        <Textarea id="disclaimer" value={d} onChange={(e) => setD(e.target.value)} rows={3} maxLength={600} placeholder="Wording approved by your compliance team. Every invitation ends with it." />
        <p className="text-xs text-muted-foreground">Until this is filled in, no invitation can be drafted. Use wording your compliance officer has approved: it is not pre-filled on purpose.</p>
        <Button size="sm" type="submit" disabled={a.pending} className="w-fit">
          {a.pending ? "Saving…" : "Save disclaimer"}
        </Button>
      </form>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          b.run(() => actions.saveSettingAction("velocity_limit", v), "Saved.");
        }}
      >
        <div className="flex flex-col gap-1">
          <Label htmlFor="velocity">Review when a referrer gets more than this many sign-ups in a day</Label>
          <Input id="velocity" inputMode="numeric" value={v} onChange={(e) => setV(e.target.value)} className="h-8 w-24" />
        </div>
        <Button size="sm" type="submit" disabled={b.pending}>
          Save
        </Button>
      </form>
      <p className="text-xs text-muted-foreground">Share link base: {linkBaseConfigured ? "configured on the server." : "not configured. Set REFERRAL_LINK_BASE to an https address on the server to get share links."}</p>
    </div>
  );
}

export type RuleDraft = { id?: string; name: string; event: string; kind: string; amountRupees: string; maxRewardRupees: string; capPerMonthRupees: string; validFrom: string; validTo: string };
const EMPTY_RULE: RuleDraft = { name: "", event: "KYC_COMPLETE", kind: "FIXED", amountRupees: "", maxRewardRupees: "", capPerMonthRupees: "", validFrom: "", validTo: "" };
const SELECT = "h-8 rounded-lg border border-input bg-background px-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export function RuleForm({ initial, onDone }: { initial?: RuleDraft; onDone?: () => void }) {
  const [r, setR] = useState<RuleDraft>(initial ?? EMPTY_RULE);
  const { pending, run } = useAct();
  const set = (k: keyof RuleDraft) => (e: { target: { value: string } }) => setR((x) => ({ ...x, [k]: e.target.value }));
  const field = (id: string, label: string, node: ReactNode) => (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      {node}
    </div>
  );
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => actions.saveRuleAction(r, r.id), r.id ? "Rule saved." : "Rule added (switched off until you turn it on).", () => {
          if (!r.id) setR(EMPTY_RULE);
          onDone?.();
        });
      }}
    >
      {field(`n-${r.id ?? "new"}`, "Name", <Input id={`n-${r.id ?? "new"}`} value={r.name} onChange={set("name")} maxLength={80} className="h-8" />)}
      {field(`e-${r.id ?? "new"}`, "Pays when the referred person reaches", (
        <select id={`e-${r.id ?? "new"}`} value={r.event} onChange={set("event")} className={SELECT}>
          <option value="SIGNED_UP">Signed up</option>
          <option value="KYC_COMPLETE">KYC complete</option>
          <option value="FIRST_FUNDING">First funding</option>
        </select>
      ))}
      {field(`k-${r.id ?? "new"}`, "Type", (
        <select id={`k-${r.id ?? "new"}`} value={r.kind} onChange={set("kind")} className={SELECT}>
          <option value="FIXED">Fixed amount (rupees)</option>
          <option value="PERCENT">Percent of the first funding</option>
        </select>
      ))}
      {field(`a-${r.id ?? "new"}`, r.kind === "PERCENT" ? "Percent (for example 1.25)" : "Amount in rupees", <Input id={`a-${r.id ?? "new"}`} inputMode="decimal" value={r.amountRupees} onChange={set("amountRupees")} className="h-8" />)}
      {field(`m-${r.id ?? "new"}`, "Most one reward can pay, rupees (optional)", <Input id={`m-${r.id ?? "new"}`} inputMode="decimal" value={r.maxRewardRupees} onChange={set("maxRewardRupees")} className="h-8" />)}
      {field(`c-${r.id ?? "new"}`, "Most one referrer can earn per month, rupees (optional)", <Input id={`c-${r.id ?? "new"}`} inputMode="decimal" value={r.capPerMonthRupees} onChange={set("capPerMonthRupees")} className="h-8" />)}
      {field(`f-${r.id ?? "new"}`, "Valid from (optional, India time)", <Input id={`f-${r.id ?? "new"}`} type="date" value={r.validFrom} onChange={set("validFrom")} className="h-8" />)}
      {field(`t-${r.id ?? "new"}`, "Valid until (optional)", <Input id={`t-${r.id ?? "new"}`} type="date" value={r.validTo} onChange={set("validTo")} className="h-8" />)}
      <div className="flex items-center gap-2 sm:col-span-2">
        <Button size="sm" type="submit" disabled={pending}>
          {pending ? "Saving…" : r.id ? "Save rule" : "Add rule"}
        </Button>
        {onDone && (
          <Button size="sm" type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

export function RuleToggle({ id, active }: { id: string; active: boolean }) {
  return <SimpleAction label={active ? "Switch off" : "Switch on"} variant={active ? "outline" : "default"} okText={active ? "Rule switched off." : "Rule switched on."} onRun={() => actions.setRuleActiveAction(id, !active)} />;
}

export function EditRule({ draft }: { draft: RuleDraft }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Edit
      </Button>
    );
  return (
    <div className="w-full rounded-lg border border-border p-3">
      <RuleForm initial={draft} onDone={() => setOpen(false)} />
    </div>
  );
}

export function PrepareStatement({ referrerId, period, again }: { referrerId: string; period: string; again?: boolean }) {
  return <SimpleAction label={again ? "Prepare again" : "Prepare statement"} okText="Statement prepared. A different person has to approve it." onRun={() => actions.prepareStatementAction(referrerId, period)} />;
}

export function StatementStep({ id, status, canApprove }: { id: string; status: "PREPARED" | "APPROVED" | "PAID"; canApprove: boolean }) {
  if (status === "PAID") return null;
  if (status === "PREPARED") return <SimpleAction label="Approve" variant="default" okText="Approved." disabled={!canApprove} onRun={() => actions.approveStatementAction(id)} />;
  return <ReasonAction label="Mark as paid" prompt="Bank reference (UTR)" minLength={6} variant="default" okText="Marked as paid." onSubmit={(ref) => actions.markPaidAction(id, ref)} />;
}

export function RevokeCode({ codeId }: { codeId: string }) {
  return <ReasonAction label="Revoke" prompt="Why is this code being revoked?" variant="ghost" okText="Code revoked." onSubmit={(why) => actions.revokeCodeAction(codeId, why)} />;
}

export function ReferrerButtons({ id, status }: { id: string; status: "ACTIVE" | "SUSPENDED" }) {
  return (
    <>
      <SimpleAction label="New code" okText="New code issued." disabled={status !== "ACTIVE"} onRun={() => actions.issueCodeAction(id)} />
      <SimpleAction label={status === "ACTIVE" ? "Suspend" : "Reactivate"} variant="ghost" okText={status === "ACTIVE" ? "Referrer suspended." : "Referrer reactivated."} onRun={() => actions.setReferrerStatusAction(id, status === "ACTIVE" ? "SUSPENDED" : "ACTIVE")} />
    </>
  );
}

export function LedgerButtons({ referrerId, entryId, state }: { referrerId: string; entryId: string; state: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {state === "NEEDS_REVIEW" && <ReasonAction label="Clear" prompt="What did you check?" minLength={5} okText="Review cleared." onSubmit={(n) => actions.clearReviewAction(referrerId, entryId, n)} />}
      {(state === "NEEDS_REVIEW" || state === "ACCRUED") && <ReasonAction label="Reverse" prompt="Reason for reversing" variant="ghost" okText="Reward reversed." onSubmit={(why) => actions.reverseEntryAction(referrerId, entryId, why)} />}
    </div>
  );
}
