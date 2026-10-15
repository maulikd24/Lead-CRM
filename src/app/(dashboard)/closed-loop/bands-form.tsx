"use client";

import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveAumBandsAction } from "./actions";

export function BandsForm({ initial }: { initial: string }) {
  const id = useId();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      action={(form) => {
        setError(null);
        start(async () => {
          const r = await saveAumBandsAction(String(form.get("bands") ?? ""));
          if (r.ok) toast.success("Saved");
          else setError(r.error);
        });
      }}
      className="flex flex-col gap-3"
    >
      <label htmlFor={id} className="text-sm font-medium">Bands</label>
      <Input id={id} name="bands" defaultValue={initial} maxLength={400} placeholder="10L=1000000, 50L=5000000, 1Cr=10000000" />
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div><Button type="submit" size="sm" disabled={pending}>{pending ? "Saving" : "Save bands"}</Button></div>
    </form>
  );
}
