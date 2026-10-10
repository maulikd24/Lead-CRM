"use client";

import { useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { runUploadAction, type UploadResult } from "./actions";
import { RunSummary } from "./run-summary";

const SELECT = "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

/** Upload, preview (dry run), then apply. "Apply" only unlocks after a preview of the very file that is still selected. */
export function UploadPanel() {
  const [kind, setKind] = useState("HOLDINGS");
  const [file, setFile] = useState<File | null>(null);
  const [previewed, setPreviewed] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [pending, startTransition] = useTransition();
  const input = useRef<HTMLInputElement>(null);

  function submit(dryRun: boolean, force = false) {
    if (!file) return;
    const form = new FormData();
    form.set("kind", kind);
    form.set("file", file);
    form.set("dryRun", String(dryRun));
    form.set("force", String(force));
    startTransition(async () => {
      try {
        const r = await runUploadAction(form);
        setResult(r);
        if (r.ok && dryRun) setPreviewed(r.outcome.status !== "FAILED");
        if (r.ok && !dryRun) setPreviewed(false);
      } catch {
        setResult({ ok: false, message: "Something went wrong. Nothing was changed." });
      }
    });
  }

  const skipped = result?.ok && result.outcome.status === "SKIPPED_DUPLICATE" && result.outcome.reason === "already_imported";

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-[14rem_1fr]">
        <div className="flex flex-col gap-2">
          <Label htmlFor="bo-kind">Kind of file</Label>
          <select id="bo-kind" className={SELECT} value={kind} onChange={(e) => { setKind(e.target.value); setPreviewed(false); }}>
            <option value="CLIENTS">Client master</option>
            <option value="HOLDINGS">Holdings</option>
            <option value="TRANSACTIONS">Transactions</option>
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="bo-file">CSV file (up to 5 MB)</Label>
          <input
            id="bo-file"
            ref={input}
            type="file"
            accept=".csv,text/csv"
            className="h-9 w-full rounded-lg border border-input bg-transparent text-sm file:mr-3 file:h-9 file:border-0 file:bg-secondary file:px-3 file:text-sm file:font-medium file:text-secondary-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreviewed(false); setResult(null); }}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={() => submit(true)} disabled={!file || pending}>{pending ? "Working…" : "Preview (dry run)"}</Button>
        <Button onClick={() => submit(false)} disabled={!file || !previewed || pending}>Import for real</Button>
        {skipped && <Button variant="ghost" onClick={() => submit(false, true)} disabled={pending}>Import again anyway</Button>}
        {!previewed && file && <span className="text-xs text-muted-foreground">Preview the file first. Importing unlocks after that.</span>}
      </div>

      <div aria-live="polite">
        {result && !result.ok && <p role="alert" className="text-sm text-destructive">{result.message}</p>}
        {result?.ok && <RunSummary data={{ ...result.outcome }} />}
      </div>
    </div>
  );
}
