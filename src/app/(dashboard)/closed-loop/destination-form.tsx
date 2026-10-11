"use client";

import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DestinationKey } from "@/lib/closedloop/types";
import { saveDestinationAction } from "./actions";

type Field = { key: string; label: string; secret: boolean; hint?: string; filled: boolean };

/** Credentials are typed here by an Admin and stored encrypted; a saved secret is never shown back (the box says it is saved, and blank keeps it). */
export function DestinationForm({ destinationKey, initial, fields }: { destinationKey: DestinationKey; initial: { enabled: boolean; region: string; allowedRegions: string; sendValue: boolean }; fields: Field[] }) {
  const uid = useId();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(form: FormData) {
    setError(null);
    start(async () => {
      const credentials: Record<string, string> = {};
      for (const f of fields) credentials[f.key] = String(form.get(`cred-${f.key}`) ?? "");
      const r = await saveDestinationAction(destinationKey, {
        enabled: form.get("enabled") === "on",
        region: String(form.get("region") ?? ""),
        allowedRegions: String(form.get("allowedRegions") ?? ""),
        sendValue: form.get("sendValue") === "on",
        credentials,
      });
      if (r.ok) toast.success("Saved");
      else setError(r.error);
    });
  }

  return (
    <form action={submit} className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((f) => (
          <div key={f.key} className="flex flex-col gap-1.5">
            <label htmlFor={`${uid}-${f.key}`} className="text-sm font-medium">{f.label}</label>
            <Input id={`${uid}-${f.key}`} name={`cred-${f.key}`} type={f.secret ? "password" : "text"} autoComplete="off" placeholder={f.filled ? "Saved. Leave blank to keep." : ""} maxLength={2000} />
            {f.hint && <p className="text-xs text-muted-foreground">{f.hint}</p>}
          </div>
        ))}
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${uid}-region`} className="text-sm font-medium">Where this destination processes data</label>
          <Input id={`${uid}-region`} name="region" defaultValue={initial.region} maxLength={40} placeholder="for example global" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${uid}-allowed`} className="text-sm font-medium">Regions you have approved</label>
          <Input id={`${uid}-allowed`} name="allowedRegions" defaultValue={initial.allowedRegions} maxLength={400} placeholder="Empty until your legal owner approves" />
          <p className="text-xs text-muted-foreground">Nothing is sent unless the region above is on this list.</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-6 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" name="enabled" defaultChecked={initial.enabled} className="size-4 accent-[var(--primary)]" />Switch this destination on</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="sendValue" defaultChecked={initial.sendValue} className="size-4 accent-[var(--primary)]" />Send first funding amount (rounded to the nearest 10,000 rupees)</label>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div><Button type="submit" size="sm" disabled={pending}>{pending ? "Saving" : "Save"}</Button></div>
    </form>
  );
}
