"use client";

import { useRef, useState } from "react";
import { Bug, Paperclip, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { createBugReportAction } from "@/app/(dashboard)/debugger/actions";

const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024; // keep in sync with debugger/actions.ts

/** Rendered once in the shared dashboard header (src/app/(dashboard)/layout.tsx) so every signed-in
 * user, regardless of role, can flag an issue from wherever they hit it — "anyone can report" means
 * this can't live behind a role-gated nav item. */
export function ReportIssueDialog() {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [attachment, setAttachment] = useState<File | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) {
      setAttachment(null);
      return;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      toast.error("Attachment is too large — please keep it under 8MB");
      e.target.value = "";
      setAttachment(null);
      return;
    }
    setAttachment(file);
  }

  function clearAttachment() {
    setAttachment(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleSubmit(formData: FormData) {
    setPending(true);
    try {
      formData.set("pageUrl", window.location.pathname);
      // The hidden <input> already carries the file when one is chosen, but set it explicitly so a
      // cleared selection (via the X button) never resubmits a stale file from a prior pick.
      if (attachment) formData.set("attachment", attachment);
      else formData.delete("attachment");
      const result = await createBugReportAction(formData);
      toast.success(
        result.attachmentFailed
          ? "Thanks — an Admin has been notified. (The attachment couldn't be uploaded, but your report was filed.)"
          : "Thanks — an Admin has been notified.",
      );
      setOpen(false);
      formRef.current?.reset();
      setAttachment(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to submit report");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="icon" variant="ghost" title="Report an issue" />}>
        <Bug className="size-4" />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Report an Issue</DialogTitle>
          <DialogDescription>
            Describe what happened — the page you&apos;re on is captured automatically. An Admin is
            notified immediately.
          </DialogDescription>
        </DialogHeader>
        <form ref={formRef} action={handleSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="description">What went wrong?</FieldLabel>
              <Textarea id="description" name="description" rows={4} placeholder="e.g. the export button doesn't respond" required />
            </Field>
            <Field>
              <FieldLabel htmlFor="attachment">Attachment (optional)</FieldLabel>
              {attachment ? (
                <div className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm">
                  <span className="flex min-w-0 items-center gap-1.5 truncate">
                    <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{attachment.name}</span>
                  </span>
                  <button type="button" onClick={clearAttachment} className="shrink-0 text-muted-foreground hover:text-destructive">
                    <X className="size-3.5" />
                  </button>
                </div>
              ) : (
                <input
                  ref={fileInputRef}
                  id="attachment"
                  name="attachment"
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain"
                  onChange={handleFileChange}
                  className="text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-transparent file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground"
                />
              )}
              <p className="text-xs text-muted-foreground">A screenshot helps — images, PDFs, or text files up to 8MB.</p>
            </Field>
          </FieldGroup>
          <DialogFooter className="mt-4">
            <Button type="submit" disabled={pending}>
              {pending ? "Submitting..." : "Submit"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
