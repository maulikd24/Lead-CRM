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
import type { PortfolioImportRowOutcome } from "./import-actions";

const STATUS_VARIANT: Record<PortfolioImportRowOutcome["status"], "default" | "secondary" | "destructive"> = {
  created: "default",
  updated: "secondary",
  failed: "destructive",
};

function downloadTemplate(columns: string[], filename: string) {
  const csv = columns.join(",") + "\n";
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function PortfolioImportDialog({
  label,
  title,
  description,
  columns,
  templateFilename,
  action,
}: {
  label: string;
  title: string;
  description: string;
  columns: string[];
  templateFilename: string;
  action: (formData: FormData) => Promise<{ results: PortfolioImportRowOutcome[] }>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [results, setResults] = useState<PortfolioImportRowOutcome[] | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  async function handleSubmit(formData: FormData) {
    setPending(true);
    try {
      const { results } = await action(formData);
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
  const updatedCount = results?.filter((r) => r.status === "updated").length ?? 0;
  const failedCount = results?.filter((r) => r.status === "failed").length ?? 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>{label}</DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {!results && (
          <form ref={formRef} action={handleSubmit} className="flex flex-col gap-4">
            <button
              type="button"
              onClick={() => downloadTemplate(columns, templateFilename)}
              className="self-start text-sm text-primary underline"
            >
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
              <span className="font-medium">{createdCount} created</span> · {updatedCount} updated · {failedCount} failed
            </p>
            <div className="max-h-80 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Row</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Detail</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.map((r) => (
                    <TableRow key={r.row}>
                      <TableCell className="text-xs text-muted-foreground">{r.row}</TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[r.status]}>{r.status}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.status === "failed" ? r.error : r.detail}
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
