"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { OverrideRule } from "@/lib/partners/overrides/rules";
import type { TaxRule } from "@/lib/partners/tax/rules";
import { proposeOverrideRuleAction, proposeTaxRuleAction, type ProposeActionResult } from "./actions";

const SELECT = "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";
const TYPES = [
  { key: "PARTNER", label: "Partner" },
  { key: "AFFILIATE", label: "Affiliate" },
  { key: "DISTRIBUTOR", label: "Distributor" },
];
const dateOnly = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10) : "");

function Errors({ errors }: { errors: string[] }) {
  if (errors.length === 0) return null;
  return (
    <ul role="alert" className="flex list-disc flex-col gap-1 pl-5 text-sm text-destructive">
      {errors.map((e) => <li key={e}>{e}</li>)}
    </ul>
  );
}

function useSubmit(propose: (change: unknown) => Promise<ProposeActionResult>, onDone: () => void) {
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const submit = (change: unknown) => {
    setErrors([]);
    start(async () => {
      const r = await propose(change);
      if (r.ok) {
        toast.success("Sent for approval. A different person has to approve it before it takes effect.");
        onDone();
      } else setErrors(r.errors);
    });
  };
  return { errors, pending, submit };
}

type Mode = { op: "create" } | { op: "replace"; rule: TaxRule } | { op: "retire"; rule: TaxRule };

/** Add, replace or end a tax rule. Nothing takes effect until a different person approves it. There are no default values. */
export function TaxRuleDialog({ mode, label: buttonLabel, variant = "default" }: { mode: Mode; label: string; variant?: "default" | "ghost" | "outline" }) {
  const base = mode.op === "retire" ? null : mode.op === "replace" ? mode.rule : null;
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<string>(base?.kind ?? "TDS");
  const [label, setLabel] = useState(base?.label ?? "");
  const [rate, setRate] = useState(base?.ratePercent ?? "");
  const [threshold, setThreshold] = useState(base?.thresholdAmount ?? "");
  const [types, setTypes] = useState<string[]>(base?.partnerTypes ?? []);
  const [pan, setPan] = useState<string>(base?.panStatus ?? "ANY");
  const [gstReg, setGstReg] = useState<string>(base?.gstRegistration ?? "ANY");
  const [gstMode, setGstMode] = useState<string>(base?.gstMode ?? "");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState(dateOnly(base?.effectiveTo ?? null));
  const [endOn, setEndOn] = useState("");
  const { errors, pending, submit } = useSubmit(proposeTaxRuleAction, () => setOpen(false));

  function go(e: React.FormEvent) {
    e.preventDefault();
    if (mode.op === "retire") return submit({ op: "retire", ruleId: mode.rule.id, effectiveTo: endOn });
    const rule = { kind, label, ratePercent: rate, thresholdAmount: kind === "TDS" ? threshold : "", partnerTypes: types, panStatus: kind === "TDS" ? pan : "ANY", gstRegistration: kind === "GST" ? gstReg : "ANY", gstMode: kind === "GST" ? gstMode : "", effectiveFrom: from, effectiveTo: to };
    submit(mode.op === "replace" ? { op: "replace", ruleId: mode.rule.id, rule } : { op: "create", rule });
  }

  const title = mode.op === "create" ? "Add a tax rule" : mode.op === "replace" ? "Replace this tax rule" : "End this tax rule";
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant={variant} />}>{buttonLabel}</DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <form onSubmit={go} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{mode.op === "retire" ? "The rule stops applying from the date you give. It is kept for the record." : "You type every value: there is no default rate or threshold. A different person approves it before it takes effect, and the rule used is printed on each statement."}</DialogDescription>
          </DialogHeader>
          {mode.op === "retire" ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tr-end">Ends on (the rule no longer applies from this date)</Label>
              <Input id="tr-end" type="date" value={endOn} onChange={(e) => setEndOn(e.target.value)} required />
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tr-kind">Tax</Label>
                <select id="tr-kind" className={SELECT} value={kind} onChange={(e) => setKind(e.target.value)} disabled={mode.op === "replace"}>
                  <option value="TDS">TDS (tax deducted from the partner)</option>
                  <option value="GST">GST</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tr-label">{kind === "TDS" ? "Section, as it should print" : "Label, as it should print"}</Label>
                <Input id="tr-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} required />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tr-rate">Rate (percent, up to four decimals)</Label>
                <Input id="tr-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} required />
              </div>
              {kind === "TDS" ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="tr-th">Threshold per financial year, in rupees (blank for none)</Label>
                  <Input id="tr-th" inputMode="decimal" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="tr-mode">How GST is handled</Label>
                  <select id="tr-mode" className={SELECT} value={gstMode} onChange={(e) => setGstMode(e.target.value)} required>
                    <option value="">Choose…</option>
                    <option value="REVERSE_CHARGE">Reverse charge: the firm pays it, not taken from the partner</option>
                    <option value="SELF_INVOICE">Self-invoice: the firm raises the invoice and pays it</option>
                    <option value="PARTNER_INVOICED">The partner invoices: added to what they are paid</option>
                  </select>
                </div>
              )}
              <fieldset className="flex flex-col gap-1.5 sm:col-span-2">
                <legend className="mb-1 text-sm font-medium">Applies to (none ticked means every partner type)</legend>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {TYPES.map((t) => (
                    <label key={t.key} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={types.includes(t.key)} onChange={(e) => setTypes(e.target.checked ? [...types, t.key] : types.filter((x) => x !== t.key))} /> {t.label}
                    </label>
                  ))}
                </div>
              </fieldset>
              {kind === "TDS" ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="tr-pan">PAN on file</Label>
                  <select id="tr-pan" className={SELECT} value={pan} onChange={(e) => setPan(e.target.value)}>
                    <option value="ANY">Either</option>
                    <option value="PRESENT">Only partners with a PAN</option>
                    <option value="ABSENT">Only partners without a PAN</option>
                  </select>
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="tr-reg">GST registration</Label>
                  <select id="tr-reg" className={SELECT} value={gstReg} onChange={(e) => setGstReg(e.target.value)}>
                    <option value="ANY">Either</option>
                    <option value="REGISTERED">Only registered partners</option>
                    <option value="UNREGISTERED">Only unregistered partners</option>
                  </select>
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tr-from">Effective from</Label>
                <Input id="tr-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} required />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tr-to">Effective until (blank for no end date)</Label>
                <Input id="tr-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
            </div>
          )}
          <Errors errors={errors} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={pending}>Send for approval</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type OMode = { op: "create" } | { op: "replace"; rule: OverrideRule } | { op: "retire"; rule: OverrideRule };

/** Add, replace or end an override rule. Same maker-checker path as tax rules; none exist by default. */
export function OverrideRuleDialog({ mode, label: buttonLabel, variant = "default" }: { mode: OMode; label: string; variant?: "default" | "ghost" | "outline" }) {
  const base = mode.op === "replace" ? mode.rule : null;
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState(base ? String(base.level) : "1");
  const [rate, setRate] = useState(base?.ratePercent ?? "");
  const [cap, setCap] = useState(base?.capPerAccrual ?? "");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState(dateOnly(base?.effectiveTo ?? null));
  const [endOn, setEndOn] = useState("");
  const { errors, pending, submit } = useSubmit(proposeOverrideRuleAction, () => setOpen(false));

  function go(e: React.FormEvent) {
    e.preventDefault();
    if (mode.op === "retire") return submit({ op: "retire", ruleId: mode.rule.id, effectiveTo: endOn });
    const rule = { level, ratePercent: rate, capPerAccrual: cap, effectiveFrom: from, effectiveTo: to };
    submit(mode.op === "replace" ? { op: "replace", ruleId: mode.rule.id, rule } : { op: "create", rule });
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant={variant} />}>{buttonLabel}</DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <form onSubmit={go} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{mode.op === "create" ? "Add an override rule" : mode.op === "replace" ? "Replace this override rule" : "End this override rule"}</DialogTitle>
            <DialogDescription>{mode.op === "retire" ? "The rule stops applying to accruals from this date." : "A share of a sub-partner's commission accrual goes to the partner above them. There is no default rate. A different person approves it before it takes effect."}</DialogDescription>
          </DialogHeader>
          {mode.op === "retire" ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="or-end">Ends on</Label>
              <Input id="or-end" type="date" value={endOn} onChange={(e) => setEndOn(e.target.value)} required />
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="or-level">Level (1 is the direct parent)</Label>
                <select id="or-level" className={SELECT} value={level} onChange={(e) => setLevel(e.target.value)} disabled={mode.op === "replace"}>
                  {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="or-rate">Rate (percent of the sub-partner&apos;s commission)</Label>
                <Input id="or-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} required />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="or-cap">Cap per accrual, in rupees (blank for none)</Label>
                <Input id="or-cap" inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="or-from">Effective from</Label>
                <Input id="or-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} required />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="or-to">Effective until (blank for no end date)</Label>
                <Input id="or-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
            </div>
          )}
          <Errors errors={errors} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={pending}>Send for approval</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
