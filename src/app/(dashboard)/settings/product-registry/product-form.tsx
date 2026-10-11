"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AVAILABILITY, PRODUCT_CATEGORIES, RISK_CATEGORIES, labelOf } from "@/lib/registry/model";
import type { FormFields } from "@/lib/registry/form-parse";
import { createProductAction, updateDraftAction } from "./actions";

const EMPTY: FormFields = { name: "", category: "MUTUAL_FUND", summary: "", availability: "OPEN", minInvestment: "", currency: "INR", riskCategory: "MODERATE", jurisdictions: "IN", requiredDocuments: "", eligibility: "", restrictions: "", claims: "", validFrom: "", validTo: "" };
const SELECT = "h-9 w-full rounded-lg border border-input bg-background px-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring";

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Create a product (a first draft) or edit a draft version. Plain text lines instead of JSON. Saving never makes anything citable: that needs a review by a second Admin. */
export function ProductForm({ mode, versionId, initial, onDone }: { mode: "create" | "edit"; versionId?: string; initial?: FormFields; onDone?: () => void }) {
  const [f, setF] = useState<FormFields>(initial ?? EMPTY);
  const [key, setKey] = useState("");
  const [isExample, setIsExample] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof FormFields) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));

  const submit = () => {
    setError(null);
    start(async () => {
      try {
        const r = mode === "create" ? await createProductAction(key, f, isExample) : await updateDraftAction(versionId ?? "", f);
        if (!r.ok) {
          setError(r.error);
          return;
        }
        toast.success(r.message);
        onDone?.();
      } catch {
        setError("Could not save. Try again.");
      }
    });
  };

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {mode === "create" && (
        <>
          <Field id="pf-key" label="Key" hint="Lowercase letters, digits and hyphens. Never changes. Example: growth-fund-i.">
            <Input id="pf-key" value={key} onChange={(e) => setKey(e.target.value)} required autoComplete="off" />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isExample} onChange={(e) => setIsExample(e.target.checked)} className="size-4" /> This is an example entry (cannot be cited in production)
          </label>
        </>
      )}
      <Field id="pf-name" label="Name">
        <Input id="pf-name" value={f.name} onChange={set("name")} required maxLength={120} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field id="pf-cat" label="Category">
          <select id="pf-cat" className={SELECT} value={f.category} onChange={set("category")}>
            {PRODUCT_CATEGORIES.map((c) => <option key={c} value={c}>{labelOf(c)}</option>)}
          </select>
        </Field>
        <Field id="pf-risk" label="Risk category">
          <select id="pf-risk" className={SELECT} value={f.riskCategory} onChange={set("riskCategory")}>
            {RISK_CATEGORIES.map((c) => <option key={c} value={c}>{labelOf(c)}</option>)}
          </select>
        </Field>
        <Field id="pf-avail" label="Availability">
          <select id="pf-avail" className={SELECT} value={f.availability} onChange={set("availability")}>
            {AVAILABILITY.map((c) => <option key={c} value={c}>{labelOf(c)}</option>)}
          </select>
        </Field>
        <Field id="pf-cur" label="Currency">
          <Input id="pf-cur" value={f.currency} onChange={set("currency")} maxLength={3} />
        </Field>
      </div>
      <Field id="pf-min" label="Minimum investment (rupees)" hint="Leave empty when there is no minimum.">
        <Input id="pf-min" inputMode="decimal" value={f.minInvestment} onChange={set("minInvestment")} />
      </Field>
      <Field id="pf-juris" label="Jurisdictions" hint="Comma separated, for example IN.">
        <Input id="pf-juris" value={f.jurisdictions} onChange={set("jurisdictions")} />
      </Field>
      <Field id="pf-summary" label="Summary" hint="Internal, up to 600 characters. Not a marketing claim.">
        <Textarea id="pf-summary" rows={2} value={f.summary} onChange={set("summary")} />
      </Field>
      <Field id="pf-docs" label="Required documents" hint="One per line.">
        <Textarea id="pf-docs" rows={3} value={f.requiredDocuments} onChange={set("requiredDocuments")} />
      </Field>
      <Field id="pf-elig" label="Investor eligibility" hint="One rule per line, as kind: value. Kinds: investor_type, residency, min_net_worth, min_age, kyc_complete, other.">
        <Textarea id="pf-elig" rows={3} value={f.eligibility} onChange={set("eligibility")} />
      </Field>
      <Field id="pf-restr" label="Sales restrictions" hint="One per line, as code | text.">
        <Textarea id="pf-restr" rows={3} value={f.restrictions} onChange={set("restrictions")} />
      </Field>
      <Field id="pf-claims" label="Approved marketing claims" hint="One per line, as id | text | valid until (optional, YYYY-MM-DD). Marketing may use only these.">
        <Textarea id="pf-claims" rows={4} value={f.claims} onChange={set("claims")} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field id="pf-from" label="Valid from">
          <Input id="pf-from" type="date" value={f.validFrom} onChange={set("validFrom")} />
        </Field>
        <Field id="pf-to" label="Valid to">
          <Input id="pf-to" type="date" value={f.validTo} onChange={set("validTo")} />
        </Field>
      </div>
      {error && <p role="alert" className="rounded-lg border border-destructive/40 px-3 py-2 text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={pending}>{pending ? "Saving" : mode === "create" ? "Create draft" : "Save draft"}</Button>
      </div>
    </form>
  );
}
