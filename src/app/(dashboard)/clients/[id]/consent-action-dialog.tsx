"use client";

import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { CONSENT_CHANNELS, CONSENT_PURPOSES, DND_PURPOSE } from "@/lib/consent/policy";
import { PURPOSE_LABEL } from "@/lib/consent/view";
import { changeConsentAction } from "./consent-actions";

const SELECT_CLASS =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

/** Record or withdraw consent. The reason is required: it is the audit trail for a change made on the customer's behalf. */
export function ConsentActionDialog({ clientId }: { clientId: string }) {
  const [open, setOpen] = useState(false);
  const [purpose, setPurpose] = useState<string>("MARKETING_COMMS");
  const [status, setStatus] = useState<"GRANTED" | "WITHDRAWN">("WITHDRAWN");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const uid = useId();
  const isDnd = purpose === DND_PURPOSE;

  function submit(form: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await changeConsentAction({
        clientId,
        purpose,
        channel: String(form.get("channel") ?? ""),
        status,
        reason: String(form.get("reason") ?? ""),
        noticeVersion: String(form.get("noticeVersion") ?? ""),
      });
      if (result.ok) {
        toast.success("Consent updated");
        setOpen(false);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>Record consent or withdrawal</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record consent or withdrawal</DialogTitle>
        </DialogHeader>
        <form action={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${uid}-purpose`} className="text-sm font-medium">Purpose</label>
            <select id={`${uid}-purpose`} value={purpose} onChange={(e) => setPurpose(e.target.value)} className={SELECT_CLASS}>
              {[...CONSENT_PURPOSES, DND_PURPOSE].map((p) => (
                <option key={p} value={p}>{PURPOSE_LABEL[p]}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${uid}-channel`} className="text-sm font-medium">Channel</label>
            <select id={`${uid}-channel`} name="channel" defaultValue="" className={SELECT_CLASS}>
              <option value="">All channels</option>
              {CONSENT_CHANNELS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">What happened</legend>
            {(
              [
                ["GRANTED", isDnd ? "Set do-not-contact" : "The customer agreed"],
                ["WITHDRAWN", isDnd ? "Lift do-not-contact" : "The customer withdrew"],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="flex items-center gap-2 text-sm">
                <input type="radio" name={`${uid}-status`} value={value} checked={status === value} onChange={() => setStatus(value)} className="size-4 accent-[var(--primary)]" />
                {label}
              </label>
            ))}
          </fieldset>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${uid}-reason`} className="text-sm font-medium">Reason (required)</label>
            <Textarea id={`${uid}-reason`} name="reason" required minLength={3} maxLength={500} rows={3} placeholder="How and when the customer told you" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${uid}-notice`} className="text-sm font-medium">Notice version (optional)</label>
            <Input id={`${uid}-notice`} name="noticeVersion" maxLength={60} placeholder="e.g. v2" />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">{error}</p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={pending}>{pending ? "Saving" : "Save"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
