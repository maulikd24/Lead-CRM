"use client";

import { useState, useTransition } from "react";

import { Input } from "@/components/ui/input";

import { savePlanAction } from "./actions";

/** The month's planned budget for one campaign. Saves when the field loses focus. */
export function PlanInput({ campaignId, name, planned }: { campaignId: string; name: string; planned: number | null }) {
  const [v, setV] = useState(planned === null ? "" : String(planned));
  const [err, setErr] = useState<string | null>(null);
  const [, start] = useTransition();
  return (
    <div className="ml-auto w-28">
      <Input aria-label={`Planned monthly budget for ${name}`} inputMode="decimal" className="h-8 text-right" value={v} onChange={(e) => setV(e.target.value)} onBlur={() => { if ((planned === null ? "" : String(planned)) !== v) start(async () => { const r = await savePlanAction(campaignId, v); setErr(r.ok ? null : r.error); }); }} />
      {err ? <p role="alert" className="text-xs text-destructive">{err}</p> : null}
    </div>
  );
}
