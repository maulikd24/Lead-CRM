"use client";

import { useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { runUploadAction, type UploadResult } from "./actions";
import { RunSummary } from "./run-summary";

const SELECT = "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

/**
 * Upload, preview (dry run), then apply. The state lives here so the Upload and Preview sections of the workspace share it.
 * "Apply" only unlocks after a preview of the very file that is still selected.
 */
export function useUploadFlow(onPreviewed: () => void) {
  const [kind, setKind] = useState("HOLDINGS");
  const [file, setFile] = useState<File | null>(null);
  const [previewed, setPreviewed] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [pending, startTransition] = useTransition();

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
        if (dryRun) onPreviewed();
      } catch {
        setResult({ ok: false, message: "Something went wrong. Nothing was changed." });
        if (dryRun) onPreviewed();
      }
    });
  }

  return {
    kind,
    file,
    previewed,
    result,
    pending,
    submit,
    chooseKind: (k: string) => { setKind(k); setPreviewed(false); },
    chooseFile: (f: File | null) => { setFile(f); setPreviewed(false); setResult(null); },
  };
}

export type UploadFlow = ReturnType<typeof useUploadFlow>;

/** The Upload section: which kind of file, which file, and the one button that previews it. */
export function UploadForm({ flow }: { flow: UploadFlow }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-[14rem_1fr]">
        <div className="flex flex-col gap-2">
          <Label htmlFor="bo-kind">Kind of file</Label>
          <select id="bo-kind" className={SELECT} value={flow.kind} onChange={(e) => flow.chooseKind(e.target.value)}>
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
            onChange={(e) => flow.chooseFile(e.target.files?.[0] ?? null)}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => flow.submit(true)} disabled={!flow.file || flow.pending}>{flow.pending ? "Working…" : "Preview (dry run)"}</Button>
        <span className="text-xs text-muted-foreground">{flow.file ? "A preview changes nothing. Importing unlocks after it." : "Choose a file to preview it."}</span>
      </div>
    </div>
  );
}

/** The Preview section: what the dry run found, and the import button that only unlocks after it. */
export function PreviewPane({ flow, onBack }: { flow: UploadFlow; onBack: () => void }) {
  const { result, previewed, pending, file } = flow;
  const skipped = result?.ok && result.outcome.status === "SKIPPED_DUPLICATE" && result.outcome.reason === "already_imported";
  if (!result) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-xl border bg-card px-4 py-10 text-sm text-muted-foreground">
        <p className="font-heading text-base font-semibold text-foreground">Nothing to preview yet</p>
        <p>Choose a file on the Upload section and run a preview. What it would create, update or refuse appears here.</p>
        <Button variant="outline" onClick={onBack}>Go to Upload</Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <div aria-live="polite" className="flex flex-col gap-4">
        {!result.ok && <p role="alert" className="text-sm text-destructive">{result.message}</p>}
        {result.ok && <RunSummary data={{ ...result.outcome }} />}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => flow.submit(false)} disabled={!file || !previewed || pending}>{pending ? "Working…" : "Import for real"}</Button>
        {skipped && <Button variant="ghost" onClick={() => flow.submit(false, true)} disabled={pending}>Import again anyway</Button>}
        <Button variant="outline" onClick={onBack} disabled={pending}>Choose another file</Button>
        {!previewed && file && <span className="text-xs text-muted-foreground">Preview the file first. Importing unlocks after that.</span>}
      </div>
    </div>
  );
}
