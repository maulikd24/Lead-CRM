"use client";

import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createGoalAction, updateGoalAction } from "@/app/(dashboard)/clients/[id]/360/outcomes-actions";
import { STATIC_COPY } from "@/lib/outcomes/copy";
import type { GoalCardModel, OutcomesViewModel } from "@/lib/outcomes/view-model";

const SELECT_CLASS = "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

type Props = {
  clientId: string;
  goal?: GoalCardModel;
  holdingOptions: OutcomesViewModel["holdingOptions"];
  accountOptions: OutcomesViewModel["accountOptions"];
  trigger: React.ReactElement;
};

/** Add or edit a goal. Linked accounts and holdings are chosen from the customer's own holdings and are references only: nothing about them is changed. */
export function GoalDialog({ clientId, goal, holdingOptions, accountOptions, trigger }: Props) {
  const [open, setOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const uid = useId();
  const f = goal?.form;

  function submit(form: FormData) {
    setErrors({});
    setFormError(null);
    const raw = {
      name: form.get("name"),
      targetAmount: form.get("targetAmount"),
      targetDate: form.get("targetDate"),
      priority: form.get("priority"),
      status: form.get("status") ?? f?.status ?? "ACTIVE",
      annualRatePct: form.get("annualRatePct"),
      plannedMonthly: form.get("plannedMonthly"),
      notes: form.get("notes"),
      linkedAccountIds: form.getAll("linkedAccountIds"),
      linkedHoldingKeys: form.getAll("linkedHoldingKeys"),
    };
    start(async () => {
      const r = goal ? await updateGoalAction(clientId, goal.id, raw) : await createGoalAction(clientId, raw);
      if (r.ok) {
        toast.success(r.message ?? "Saved");
        setOpen(false);
      } else {
        setFormError(r.error);
        setErrors(r.fieldErrors ?? {});
      }
    });
  }

  const err = (k: string) => (errors[k] ? <p id={`${uid}-${k}-err`} role="alert" className="text-xs text-destructive">{errors[k]}</p> : null);
  const aria = (k: string) => (errors[k] ? { "aria-invalid": true, "aria-describedby": `${uid}-${k}-err` } : {});

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{goal ? "Edit goal" : "Add a goal"}</DialogTitle>
          <DialogDescription>{STATIC_COPY.holdingsReadOnly}</DialogDescription>
        </DialogHeader>
        <form action={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${uid}-name`} className="text-sm font-medium">Goal name</label>
            <Input id={`${uid}-name`} name="name" required maxLength={80} defaultValue={f?.name} placeholder="For example, a child's education" {...aria("name")} />
            {err("name")}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${uid}-amount`} className="text-sm font-medium">Target amount (₹)</label>
              <Input id={`${uid}-amount`} name="targetAmount" type="number" inputMode="decimal" min={1} step="any" required defaultValue={f?.targetAmount} {...aria("targetAmount")} />
              {err("targetAmount")}
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${uid}-date`} className="text-sm font-medium">Target date</label>
              <Input id={`${uid}-date`} name="targetDate" type="date" required defaultValue={f?.targetDate} {...aria("targetDate")} />
              {err("targetDate")}
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${uid}-priority`} className="text-sm font-medium">Priority</label>
              <select id={`${uid}-priority`} name="priority" defaultValue={f?.priority ?? "MEDIUM"} className={SELECT_CLASS}>
                <option value="HIGH">High</option>
                <option value="MEDIUM">Medium</option>
                <option value="LOW">Low</option>
              </select>
            </div>
            {goal && (
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`${uid}-status`} className="text-sm font-medium">Status</label>
                <select id={`${uid}-status`} name="status" defaultValue={f?.status} className={SELECT_CLASS}>
                  <option value="ACTIVE">Active</option>
                  <option value="ACHIEVED">Achieved</option>
                  <option value="PAUSED">Paused</option>
                  <option value="ARCHIVED">Archived</option>
                </select>
              </div>
            )}
          </div>
          <fieldset className="flex flex-col gap-3 rounded-md border border-border p-3">
            <legend className="px-1 text-sm font-medium">{STATIC_COPY.assumptionsHeading}</legend>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`${uid}-rate`} className="text-sm font-medium">{STATIC_COPY.assumedRateLabel} (%)</label>
                <Input id={`${uid}-rate`} name="annualRatePct" type="number" inputMode="decimal" min={0} max={20} step="0.1" defaultValue={f?.annualRatePct ?? ""} placeholder="Leave blank for the default" {...aria("annualRatePct")} />
                {err("annualRatePct")}
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`${uid}-monthly`} className="text-sm font-medium">{STATIC_COPY.plannedMonthlyLabel} (₹)</label>
                <Input id={`${uid}-monthly`} name="plannedMonthly" type="number" inputMode="decimal" min={0} step="any" defaultValue={f?.plannedMonthly ?? ""} placeholder="Optional" {...aria("plannedMonthly")} />
                {err("plannedMonthly")}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{STATIC_COPY.assumedRateNote}</p>
          </fieldset>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">Linked holdings (read-only)</legend>
            {holdingOptions.length === 0 ? (
              <p className="text-xs text-muted-foreground">No holdings on file yet for this customer.</p>
            ) : (
              <>
                {accountOptions.map((a) => (
                  <label key={a.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="linkedAccountIds" value={a.id} defaultChecked={f?.linkedAccountIds.includes(a.id)} className="size-4 accent-[var(--primary)]" />
                    All holdings in {a.label}
                  </label>
                ))}
                <ul className="flex flex-col gap-1.5 border-t border-border pt-2">
                  {holdingOptions.map((h) => (
                    <li key={h.key}>
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" name="linkedHoldingKeys" value={h.key} defaultChecked={f?.linkedHoldingKeys.includes(h.key)} className="size-4 accent-[var(--primary)]" />
                        <span className="min-w-0 flex-1 truncate">{h.label} <span className="text-xs text-muted-foreground">{h.detail}</span></span>
                        <span className="text-xs tabular-nums text-muted-foreground">{h.valueText}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {err("links")}
          </fieldset>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${uid}-notes`} className="text-sm font-medium">Notes (optional)</label>
            <Textarea id={`${uid}-notes`} name="notes" rows={2} maxLength={500} defaultValue={f?.notes} {...aria("notes")} />
            {err("notes")}
          </div>
          {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>{pending ? "Saving" : "Save goal"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
