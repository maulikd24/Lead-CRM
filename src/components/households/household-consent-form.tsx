"use client";

import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { recordHouseholdConsentAction } from "@/app/(dashboard)/households/[id]/intelligence-actions";

const SELECT_CLASS = "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

/** What a member may agree to share. Mirrors CONSENTABLE_FACETS; the server validates again, and memory and contact details can never be listed. */
const SHAREABLE: [string, string][] = [
  ["relationship_type", "How members are related"],
  ["member_identity", "Their name and customer code"],
  ["portfolio_summary", "Their portfolio size band and number of accounts"],
  ["service_state", "Whether they have an open complaint or overdue promise"],
];

/** Record or withdraw a member's relationship consent. Only members this viewer looks after can be chosen as the subject. */
export function HouseholdConsentForm({ householdId, subjects, others }: { householdId: string; subjects: { id: string; label: string }[]; others: { id: string; label: string; own: boolean }[] }) {
  const uid = useId();
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<"GRANTED" | "WITHDRAWN">("GRANTED");
  const submit = (form: FormData) =>
    start(async () => {
      const r = await recordHouseholdConsentAction({
        householdId,
        subjectClientId: String(form.get("subject")),
        granteeClientId: String(form.get("grantee") || "") || null,
        status: mode,
        scopes: form.getAll("scopes").map(String),
        evidenceRef: String(form.get("evidence") ?? ""),
      });
      if (r.ok) toast.success(r.message);
      else toast.error(r.error);
    });
  return (
    <details className="rounded-md border border-border p-3">
      <summary className="cursor-pointer text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">Record or withdraw a member&apos;s consent to share</summary>
      <form action={submit} className="mt-3 flex flex-col gap-3">
        <fieldset className="flex gap-4 text-sm">
          <legend className="sr-only">Grant or withdraw</legend>
          <label className="flex items-center gap-2"><input type="radio" name="mode" checked={mode === "GRANTED"} onChange={() => setMode("GRANTED")} className="accent-[var(--primary)]" /> The member agrees to share</label>
          <label className="flex items-center gap-2"><input type="radio" name="mode" checked={mode === "WITHDRAWN"} onChange={() => setMode("WITHDRAWN")} className="accent-[var(--primary)]" /> The member withdraws</label>
        </fieldset>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${uid}-subject`} className="text-sm font-medium">Whose consent</label>
            <select id={`${uid}-subject`} name="subject" className={SELECT_CLASS}>{subjects.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${uid}-grantee`} className="text-sm font-medium">Shared with</label>
            <select id={`${uid}-grantee`} name="grantee" className={SELECT_CLASS} defaultValue="">
              <option value="">Every other member&apos;s relationship manager</option>
              {others.map((o) => <option key={o.id} value={o.id}>Only the relationship manager of {o.label}</option>)}
            </select>
          </div>
        </div>
        {mode === "GRANTED" && (
          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-sm font-medium">What may be shown</legend>
            {SHAREABLE.map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" name="scopes" value={k} className="size-4 accent-[var(--primary)]" /> {label}</label>
            ))}
            <p className="text-xs text-muted-foreground">What we know about the member (memory) and their contact details are never shared across members.</p>
          </fieldset>
        )}
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${uid}-evidence`} className="text-sm font-medium">Where the consent came from (optional)</label>
          <Input id={`${uid}-evidence`} name="evidence" maxLength={200} placeholder="For example, told me on a call, signed form" />
        </div>
        <div><Button type="submit" disabled={pending}>{mode === "GRANTED" ? "Record consent" : "Record withdrawal"}</Button></div>
      </form>
    </details>
  );
}
