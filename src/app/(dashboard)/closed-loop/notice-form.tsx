"use client";

import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { proposeAdsNoticeAction } from "./actions";

/** Files a request to change the ad measurement wording. Nothing changes until a second Admin approves it in Approvals. */
export function NoticeForm({ initialText }: { initialText: string }) {
  const uid = useId();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(form: FormData) {
    setError(null);
    start(async () => {
      const r = await proposeAdsNoticeAction(String(form.get("text") ?? ""), String(form.get("version") ?? ""));
      if (r.ok) toast.success("Sent for approval. A second Admin decides it in Approvals.");
      else setError(r.error);
    });
  }

  return (
    <form action={submit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${uid}-text`} className="text-sm font-medium">Proposed wording</label>
        <textarea id={`${uid}-text`} name="text" defaultValue={initialText} rows={4} maxLength={1000} className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
      </div>
      <div className="flex flex-col gap-1.5 sm:max-w-xs">
        <label htmlFor={`${uid}-version`} className="text-sm font-medium">Version label</label>
        <Input id={`${uid}-version`} name="version" maxLength={60} placeholder="for example 2027-04" />
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div><Button type="submit" size="sm" disabled={pending}>{pending ? "Sending" : "Send for approval"}</Button></div>
    </form>
  );
}
