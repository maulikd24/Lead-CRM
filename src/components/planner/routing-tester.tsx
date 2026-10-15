"use client";

import { useId, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import type { RoutingPreview } from "@/lib/planner/routing";

type Result = { ok: true; preview: RoutingPreview } | { ok: false; error: string };

/** "Test this rule": describe a lead (city, language, product, audience) and see which rule would own it and why every rule matched or not. Writes nothing. */
export function RoutingTester({ test, audiences, owners }: { test: (input: Record<string, string>) => Promise<Result>; audiences: { key: string; name: string }[]; owners: Record<string, string> }) {
  const uid = useId();
  const [v, setV] = useState({ city: "", language: "", product: "", audienceKey: "" });
  const [res, setRes] = useState<Result | null>(null);
  const [pending, start] = useTransition();
  const field = "native-control h-9 w-full min-w-0";
  const row = (name: keyof typeof v, label: string, extra?: React.ReactNode) => (
    <div className="grid gap-1 text-sm"><label htmlFor={`${uid}-${name}`} className="font-medium">{label}</label>{extra ?? <input id={`${uid}-${name}`} className={field} value={v[name]} onChange={(e) => setV({ ...v, [name]: e.target.value })} />}</div>
  );
  return (
    <section aria-label="Test a routing rule" className="grid gap-3 rounded-lg border p-4">
      <h2 className="font-heading text-sm font-semibold">Test the rules</h2>
      <p className="text-xs text-muted-foreground">Describe a lead. Nothing is saved and nobody is notified.</p>
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); start(async () => setRes(await test(v))); }}>
        {row("city", "City")}
        {row("language", "Language")}
        {row("product", "Product or tool")}
        {row("audienceKey", "Audience", <select id={`${uid}-audienceKey`} className={field} value={v.audienceKey} onChange={(e) => setV({ ...v, audienceKey: e.target.value })}><option value="">Any</option>{audiences.map((a) => <option key={a.key} value={a.key}>{a.name}</option>)}</select>)}
        <div className="sm:col-span-2"><Button type="submit" size="sm" disabled={pending}>{pending ? "Testing" : "Test"}</Button></div>
      </form>
      <div aria-live="polite">
        {res && !res.ok && <p role="alert" className="text-sm text-destructive">{res.error}</p>}
        {res?.ok && (
          <div className="grid gap-2 text-sm">
            <p className="font-medium">{res.preview.decision.via === "none" ? "No rule matches: the default lead assignment decides." : `${res.preview.decision.via === "rule" ? "Rule" : "Fallback"} "${res.preview.decision.rule?.name}" owns this lead: ${owners[res.preview.decision.ownerId ?? ""] ?? res.preview.decision.ownerLabel ?? "the named owner"}.`}</p>
            <ol className="grid gap-1 text-xs" aria-label="Every rule, in order">
              {res.preview.trace.map((t) => (
                <li key={t.rule.id} className="rounded border p-2"><span className="font-medium">{t.rule.name}</span>: {t.chosen ? "chosen" : t.matched ? "matches" : "does not match"}. <span className="text-muted-foreground">{[...t.reasons, t.note].filter(Boolean).join("; ")}</span></li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </section>
  );
}
