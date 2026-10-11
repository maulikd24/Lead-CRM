"use client";

import { useId, useMemo, useState } from "react";

import { ShowFirst } from "@/components/workspace";
import { KIND_LABEL, LEDGER_KINDS, type LedgerEntry, type LedgerKind } from "@/lib/ledger/types";
import { cn } from "@/lib/utils";

import { LedgerEntryCard } from "./ledger-entry";

type Page = { entries: LedgerEntry[]; nextCursor: string | null };

/**
 * The entries with the kind filter. The filter is local (the page is already loaded: instant, no round trip); "Show older" asks the read API for the next page
 * with the same viewer. On a phone only the first three rows show and "View all" opens the shared bottom sheet.
 */
export function LedgerList({ params = {}, initial, counts, apiBase = "/api/action-ledger", expandAll = false }: { params?: Record<string, string>; initial: Page; counts: Partial<Record<LedgerKind, number>>; apiBase?: string; expandAll?: boolean }) {
  const [entries, setEntries] = useState(initial.entries);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [kind, setKind] = useState<LedgerKind | "all">("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uid = useId();

  const total = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0) || entries.length;
  const present = LEDGER_KINDS.filter((k) => (counts[k] ?? 0) > 0 || entries.some((e) => e.kind === k));
  const visible = useMemo(() => (kind === "all" ? entries : entries.filter((e) => e.kind === kind)), [entries, kind]);

  async function older() {
    if (!cursor || loading) return;
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ ...params, before: cursor });
      const res = await fetch(`${apiBase}?${qs}`, { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as Page;
      setEntries((prev) => [...prev, ...body.entries.filter((e) => !prev.some((p) => p.id === e.id))]);
      setCursor(body.nextCursor);
    } catch {
      setError("Couldn't load older entries. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-3">
      <div role="group" aria-label="Filter by kind" className="flex flex-wrap gap-1.5">
        {(["all", ...present] as const).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={kind === k}
            onClick={() => setKind(k)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              kind === k ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {k === "all" ? "All" : KIND_LABEL[k]} <span className={cn("tabular-nums", kind === k && "opacity-80")}>{k === "all" ? total : (counts[k] ?? entries.filter((e) => e.kind === k).length)}</span>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{entries.length === 0 ? "No actions recorded yet." : "Nothing matches this filter."}</p>
      ) : (
        <div aria-live="polite">
          <ShowFirst
            name="ledger"
            title="Action history"
            noun="actions"
            as="ul"
            limit={3}
            items={visible.map((e, i) => <LedgerEntryCard key={e.id} entry={e} idPrefix={`${uid}-${i}`} defaultOpen={expandAll} />)}
            sheetItems={visible.map((e, i) => <LedgerEntryCard key={e.id} entry={e} idPrefix={`${uid}-s${i}`} />)}
          />
        </div>
      )}

      {cursor && (
        <div className="grid justify-items-center gap-1">
          <button type="button" onClick={older} disabled={loading} className="rounded-full border border-border px-4 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60">
            {loading ? "Loading" : "Show older actions"}
          </button>
          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        </div>
      )}
    </div>
  );
}
