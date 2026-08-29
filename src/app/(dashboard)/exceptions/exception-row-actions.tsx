"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { CalendarPlus, ExternalLink } from "lucide-react";
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
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { createTaskAction } from "@/app/(dashboard)/tasks/actions";
import { reassignClientAction } from "@/app/(dashboard)/clients/actions";

function defaultDueAt(): string {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ExceptionRowActions({
  clientId,
  rmId,
  recommendedAction,
  users,
}: {
  clientId: string;
  rmId: string | null;
  recommendedAction: string;
  users: { id: string; name: string }[];
}) {
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [followUpPending, setFollowUpPending] = useState(false);
  const [reassignPending, setReassignPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  async function handleFollowUp(formData: FormData) {
    setFollowUpPending(true);
    try {
      await createTaskAction(formData);
      toast.success("Follow-up scheduled");
      setFollowUpOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to schedule follow-up");
    } finally {
      setFollowUpPending(false);
    }
  }

  async function handleReassign(newRmId: string) {
    setReassignPending(true);
    try {
      await reassignClientAction(clientId, newRmId);
      toast.success("Client reassigned");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to reassign");
    } finally {
      setReassignPending(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Select value={rmId ?? undefined} onValueChange={(v) => v && v !== rmId && handleReassign(v)} disabled={reassignPending}>
        <SelectTrigger className="h-8 w-32 text-xs">
          <SelectValue placeholder="Reassign">
            {(value: string) => users.find((u) => u.id === value)?.name ?? "Reassign"}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {users.map((u) => (
            <SelectItem key={u.id} value={u.id}>
              {u.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Dialog open={followUpOpen} onOpenChange={setFollowUpOpen}>
        <DialogTrigger render={<Button size="sm" variant="outline" title="Create follow-up" />}>
          <CalendarPlus className="size-4" />
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Follow-up</DialogTitle>
          </DialogHeader>
          <form ref={formRef} action={handleFollowUp}>
            <input type="hidden" name="clientId" value={clientId} />
            <input type="hidden" name="source" value="manual" />
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor={`exc-title-${clientId}`}>Task</FieldLabel>
                <Input id={`exc-title-${clientId}`} name="title" defaultValue={recommendedAction} required />
              </Field>
              <Field>
                <FieldLabel htmlFor={`exc-due-${clientId}`}>Due</FieldLabel>
                <Input id={`exc-due-${clientId}`} name="dueAt" type="datetime-local" defaultValue={defaultDueAt()} required />
              </Field>
              <Field>
                <FieldLabel htmlFor={`exc-assignee-${clientId}`}>Assign to</FieldLabel>
                <Select name="assignedToId" defaultValue={rmId ?? undefined}>
                  <SelectTrigger id={`exc-assignee-${clientId}`} className="w-full">
                    <SelectValue placeholder="Select assignee">
                      {(value: string) => users.find((u) => u.id === value)?.name ?? "Select assignee"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {users.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </FieldGroup>
            <DialogFooter className="mt-4">
              <Button type="submit" disabled={followUpPending}>
                {followUpPending ? "Scheduling..." : "Schedule"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Button size="sm" variant="outline" title="Open client" render={<Link href={`/clients/${clientId}`} />}>
        <ExternalLink className="size-4" />
      </Button>
    </div>
  );
}
