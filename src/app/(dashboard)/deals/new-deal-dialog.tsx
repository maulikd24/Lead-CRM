"use client";

import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import type { Lead, PipelineStage } from "@/generated/prisma/client";
import { createDealAction } from "./actions";

export function NewDealDialog({
  pipelineId,
  stages,
  leads,
}: {
  pipelineId: string;
  stages: PipelineStage[];
  leads: Lead[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  async function handleSubmit(formData: FormData) {
    setPending(true);
    try {
      await createDealAction(formData);
      toast.success("Deal created");
      setOpen(false);
      formRef.current?.reset();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create deal");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <Plus className="size-4" />
        New Deal
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Deal</DialogTitle>
        </DialogHeader>
        <form ref={formRef} action={handleSubmit}>
          <input type="hidden" name="pipelineId" value={pipelineId} />
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="deal-title">Title</FieldLabel>
              <Input id="deal-title" name="title" required />
            </Field>
            <Field>
              <FieldLabel htmlFor="deal-value">Value (₹)</FieldLabel>
              <Input id="deal-value" name="value" type="number" min={0} step="0.01" defaultValue={0} />
            </Field>
            <Field>
              <FieldLabel htmlFor="deal-stage">Stage</FieldLabel>
              <Select name="stageId" defaultValue={stages[0]?.id}>
                <SelectTrigger id="deal-stage" className="w-full">
                  <SelectValue>
                    {(value: string) => stages.find((s) => s.id === value)?.name ?? value}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {stages.map((stage) => (
                    <SelectItem key={stage.id} value={stage.id}>
                      {stage.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="deal-lead">Linked Lead</FieldLabel>
              <Select name="leadId">
                <SelectTrigger id="deal-lead" className="w-full">
                  <SelectValue placeholder="None">
                    {(value: string) => leads.find((l) => l.id === value)?.name ?? "None"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {leads.map((lead) => (
                    <SelectItem key={lead.id} value={lead.id}>
                      {lead.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </FieldGroup>
          <DialogFooter className="mt-4">
            <Button type="submit" disabled={pending}>
              {pending ? "Creating..." : "Create Deal"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
