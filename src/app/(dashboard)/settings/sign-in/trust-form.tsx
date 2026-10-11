"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";

import { recordTrustSignoffAction, revokeTrustSignoffAction, type TrustState } from "./actions";

export function TrustForm({ signedOff, today }: { signedOff: boolean; today: string }) {
  const [rec, recAction, recPending] = useActionState<TrustState, FormData>(recordTrustSignoffAction, {});
  const [rev, revAction, revPending] = useActionState<TrustState>(revokeTrustSignoffAction, {});
  const r = rec.result ?? rev.result;
  return (
    <div className="grid max-w-xl gap-4">
      {!signedOff && (
        <form action={recAction} className="grid gap-3">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="confirm" className="mt-1" />
            <span>Compliance has reviewed the wording above and approves it for the front door.</span>
          </label>
          <label htmlFor="reviewerName" className="text-sm font-medium">Reviewer&apos;s name</label>
          <input id="reviewerName" name="reviewerName" required maxLength={80} className="rounded-md border bg-background p-2 text-sm" />
          <label htmlFor="reviewedOn" className="text-sm font-medium">Date of review</label>
          <input id="reviewedOn" name="reviewedOn" type="date" required defaultValue={today} max={today} className="rounded-md border bg-background p-2 text-sm" />
          <div><Button type="submit" disabled={recPending}>{recPending ? "Recording..." : "Record sign-off"}</Button></div>
        </form>
      )}
      {signedOff && (
        <form action={revAction}>
          <Button type="submit" variant="outline" disabled={revPending}>{revPending ? "Revoking..." : "Revoke sign-off (hides the strip)"}</Button>
        </form>
      )}
      <span role="status" className="text-sm">{r?.ok ? (r.changed ? "Saved." : "No change.") : null}</span>
      {r && !r.ok && <p role="alert" className="m-0 text-sm text-destructive">{r.error}</p>}
    </div>
  );
}
