"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { bulkAddNoteAction } from "./actions";

export function BulkAddNoteDialog({ selectedCount, clientIds, onDone }: { selectedCount: number; clientIds: string[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  async function handleSubmit(formData: FormData) {
    const note = String(formData.get("note") ?? "").trim();
    if (!note) return;
    setPending(true);
    try {
      const { updated } = await bulkAddNoteAction(clientIds, note);
      toast.success(`Note added to ${updated.length} client(s)`);
      setOpen(false);
      formRef.current?.reset();
      onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to add note");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>Add Note ({selectedCount})</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Note to {selectedCount} Client(s)</DialogTitle>
        </DialogHeader>
        <form ref={formRef} action={handleSubmit} className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="bulk-note">Note</FieldLabel>
            <Textarea id="bulk-note" name="note" rows={3} required />
          </Field>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Adding..." : `Add to ${selectedCount} Client(s)`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
