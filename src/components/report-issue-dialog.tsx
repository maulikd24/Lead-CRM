"use client";

import { useRef, useState } from "react";
import { Bug } from "lucide-react";
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

/** Rendered once in the shared dashboard header (src/app/(dashboard)/layout.tsx) so every signed-in
 * user, regardless of role, can flag an issue from wherever they hit it — "anyone can report" means
 * this can't live behind a role-gated nav item. */
export function ReportIssueDialog() {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  async function handleSubmit(formData: FormData) {
    setPending(true);
    try {
      const description = String(formData.get("description") ?? "");
      await createBugReportAction({ pageUrl: window.location.pathname, description });
      toast.success("Thanks — an Admin has been notified.");
      setOpen(false);
      formRef.current?.reset();
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
