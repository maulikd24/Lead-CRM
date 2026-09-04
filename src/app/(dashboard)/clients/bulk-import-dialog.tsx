"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, FieldLabel } from "@/components/ui/field";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { bulkImportClientsAction, type ImportRowOutcome } from "./import-actions";
import { CSV_IMPORT_COLUMNS } from "@/lib/clients/csv-columns";

const STATUS_VARIANT: Record<ImportRowOutcome["status"], "default" | "secondary" | "destructive"> = {
  created: "default",
  duplicate: "secondary",
  failed: "destructive",
};

function downloadTemplate() {
  const csv = CSV_IMPORT_COLUMNS.join(",") + "\n";
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "clients-import-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export function BulkImportDialog() {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [results, setResults] = useState<ImportRowOutcome[] | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  async function handleSubmit(formData: FormData) {
    setPending(true);
    try {
      const { results } = await bulkImportClientsAction(formData);
      setResults(results);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Import failed");
    } finally {
      setPending(false);
    }
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setResults(null);
      formRef.current?.reset();
    }
  }

  const createdCount = results?.filter((r) => r.status === "created").length ?? 0;
  const duplicateCount = results?.filter((r) => r.status === "duplicate").length ?? 0;
  const failedCount = results?.filter((r) => r.status === "failed").length ?? 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>Bulk Import</DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Bulk Import Clients</DialogTitle>
          <DialogDescription>
            Every row goes through the same PAN/CKYC duplicate checks as creating a client manually — duplicates
            and invalid rows are skipped, not fatal to the rest of the batch.
          </DialogDescription>
        </DialogHeader>

        {!results && (
          <form ref={formRef} action={handleSubmit} className="flex flex-col gap-4">
            <button type="button" onClick={downloadTemplate} className="text-sm text-primary underline self-start">
              Download CSV template
            </button>
            <Field>
              <FieldLabel htmlFor="file">CSV File</FieldLabel>
              <input
                id="file"
                name="file"
                type="file"
                accept=".csv"
                required
                className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm"
              />
            </Field>
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending ? "Importing..." : "Import"}
              </Button>
            </DialogFooter>
          </form>
        )}

        {results && (
          <div className="flex flex-col gap-3">
            <p className="text-sm">
              <span className="font-medium">{createdCount} created</span> · {duplicateCount} duplicates · {failedCount} failed
            </p>
            <div className="max-h-80 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Row</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Detail</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.map((r) => (
                    <TableRow key={r.row}>
                      <TableCell className="text-xs text-muted-foreground">{r.row}</TableCell>
                      <TableCell className="text-sm">{r.name}</TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[r.status]}>{r.status}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.status === "created" ? r.clientCode : r.status === "duplicate" ? r.reason : r.error}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                Close
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
