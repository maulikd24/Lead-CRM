"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Report = {
  dryRun: boolean;
  exportedAt: string;
  tables: { table: string; rows: number; present?: number; mismatched?: number }[];
  matched: { table: string; matched: number; total: number; by: string }[];
  usersToCreate: number;
  credentials: { email: string; name: string; role: string; password: string }[];
  notes: string[];
  existingClients: number;
};
type Failure = { error: string; details?: string[] };

async function send(file: File, mode: "preview" | "import", confirm?: string): Promise<Report | Failure> {
  const body = new FormData();
  body.append("file", file);
  body.append("mode", mode);
  if (confirm) body.append("confirm", confirm);
  try {
    const res = await fetch("/api/data-import", { method: "POST", body });
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      return res.ok ? (json as Report) : (json as Failure);
    } catch {
      return { error: res.status === 413 ? "This file is too large for the server to accept — use the command-line importer instead." : `The server rejected the upload (${res.status}).` };
    }
  } catch {
    return { error: "The upload failed. Check your connection, or use the command-line importer for large files." };
  }
}

function downloadCredentials(credentials: Report["credentials"]) {
  const csv = ["email,name,role,temporaryPassword", ...credentials.map((c) => [c.email, c.name, c.role, c.password].map((v) => `"${v.replace(/"/g, '""')}"`).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([`${csv}\n`], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "imported-users-credentials.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export function ImportPanel() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Report | null>(null);
  const [result, setResult] = useState<Report | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [confirm, setConfirm] = useState("");

  function reset() {
    setFile(null);
    setPreview(null);
    setResult(null);
    setFailure(null);
    setConfirm("");
    if (inputRef.current) inputRef.current.value = "";
  }

  async function check() {
    if (!file) return;
    setBusy(true);
    setFailure(null);
    setPreview(null);
    const out = await send(file, "preview");
    setBusy(false);
    if ("error" in out) setFailure(out);
    else setPreview(out);
  }

  async function runIt() {
    if (!file) return;
    setBusy(true);
    setFailure(null);
    const out = await send(file, "import", confirm);
    setBusy(false);
    if ("error" in out) {
      setFailure(out);
      return;
    }
    setResult(out);
    setPreview(null);
    toast.success("Import complete and verified");
  }

  const total = (r: Report) => r.tables.reduce((n, t) => n + t.rows, 0);

  return (
    <div className="flex flex-col gap-4">
      {!result && (
        <div className="flex flex-wrap items-center gap-3">
          <Input
            ref={inputRef}
            type="file"
            accept=".zip,application/zip"
            className="max-w-sm"
            disabled={busy}
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setPreview(null);
              setFailure(null);
              setConfirm("");
            }}
          />
          <Button variant="outline" onClick={check} disabled={!file || busy}>
            {busy && !preview ? "Checking…" : "Check file"}
          </Button>
        </div>
      )}

      {failure && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <p className="font-medium text-destructive">{failure.error}</p>
          {failure.details && failure.details.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-muted-foreground">
              {failure.details.slice(0, 12).map((d) => (
                <li key={d}>{d}</li>
              ))}
              {failure.details.length > 12 && <li>…and {failure.details.length - 12} more</li>}
            </ul>
          )}
        </div>
      )}

      {preview && (
        <div className="flex flex-col gap-3">
          <p className="text-sm">
            <strong>{total(preview).toLocaleString()}</strong> records from an export made {new Date(preview.exportedAt).toLocaleString()} passed the integrity check. Nothing has been written yet.
          </p>
          {preview.existingClients > 0 && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              This database already has <strong>{preview.existingClients}</strong> client(s). Records in the file with the same id will be <strong>overwritten</strong>; other existing records are left alone.
            </div>
          )}
          <ul className="list-disc pl-5 text-sm text-muted-foreground">
            {preview.matched.map((m) => (
              <li key={m.table}>
                {m.table}: {m.matched} of {m.total} already here (matched by {m.by}) — {m.total - m.matched} will be created
              </li>
            ))}
            {preview.usersToCreate > 0 && <li>{preview.usersToCreate} user(s) will get a temporary password they must change at first sign-in.</li>}
            {preview.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">Records per table</summary>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Table</TableHead>
                  <TableHead className="text-right">To import</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.tables.map((t) => (
                  <TableRow key={t.table}>
                    <TableCell>{t.table}</TableCell>
                    <TableCell className="text-right">{t.rows}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </details>
          <div className="flex flex-wrap items-center gap-3">
            <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Type IMPORT to confirm" className="max-w-56" disabled={busy} />
            <Button onClick={runIt} disabled={confirm !== "IMPORT" || busy}>
              {busy ? "Importing… this can take a few minutes" : "Import data"}
            </Button>
            <Button variant="ghost" onClick={reset} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {result && (
        <div className="flex flex-col gap-3">
          <p className="text-sm">
            <Badge variant="default">Done</Badge> <strong>{total(result).toLocaleString()}</strong> records imported and checked cell by cell against the file.
          </p>
          {result.credentials.length > 0 && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              <p>
                {result.credentials.length} user(s) were created with temporary passwords. They are shown <strong>only now</strong> and are not stored anywhere readable — download them and hand them out securely, then delete the file.
              </p>
              <Button className="mt-2" size="sm" onClick={() => downloadCredentials(result.credentials)}>
                Download temporary passwords
              </Button>
            </div>
          )}
          {result.notes.length > 0 && (
            <ul className="list-disc pl-5 text-sm text-muted-foreground">
              {result.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
          <p className="text-sm text-muted-foreground">Next: re-enter your integration API keys in Settings → Apps &amp; Integrations — they are never part of an export.</p>
          <Button variant="outline" className="w-fit" onClick={reset}>
            Import another file
          </Button>
        </div>
      )}
    </div>
  );
}
