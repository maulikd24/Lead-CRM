"use client";

import { useRef, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { requestDataExportAction } from "./actions";

export function RequestExportForm({ disabledReason }: { disabledReason: string | null }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      try {
        await requestDataExportAction(formData);
        toast.success("Export requested — another Admin now needs to approve it");
        formRef.current?.reset();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to request the export");
      }
    });
  }

  return (
    <form ref={formRef} action={handleSubmit} className="flex flex-col gap-3">
      <Field>
        <FieldLabel htmlFor="export-reason">Why do you need this export?</FieldLabel>
        <Textarea id="export-reason" name="reason" rows={3} required minLength={10} maxLength={500} placeholder="e.g. Moving Supportify to our internal servers" disabled={!!disabledReason} />
      </Field>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending || !!disabledReason}>
          {pending ? "Requesting…" : "Request export"}
        </Button>
        {disabledReason && <p className="text-xs text-muted-foreground">{disabledReason}</p>}
      </div>
    </form>
  );
}
