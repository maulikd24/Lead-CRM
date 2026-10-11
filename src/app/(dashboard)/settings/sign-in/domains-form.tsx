"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";

import { saveAllowedDomainsAction, type SignInSettingsState } from "./actions";

export function DomainsForm({ current }: { current: string }) {
  const [state, action, pending] = useActionState<SignInSettingsState, FormData>(saveAllowedDomainsAction, {});
  const r = state.result;
  return (
    <form action={action} className="grid max-w-xl gap-3">
      <label htmlFor="domains" className="text-sm font-medium">Allowed company domains</label>
      <textarea id="domains" name="domains" rows={4} defaultValue={current} aria-describedby="domains-help" className="rounded-md border bg-background p-2 text-sm" placeholder="example.com" />
      <p id="domains-help" className="m-0 text-xs text-muted-foreground">One per line or separated by commas. Use the part after the @. Leave empty to switch Google sign-in off.</p>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>{pending ? "Saving..." : "Save domains"}</Button>
        <span role="status" className="text-sm">
          {r?.ok ? (r.changed ? "Saved." : "No change.") : null}
        </span>
      </div>
      {r && !r.ok && <p role="alert" className="m-0 text-sm text-destructive">{r.error}</p>}
    </form>
  );
}
