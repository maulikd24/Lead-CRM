"use client";

import { useState } from "react";
import { CalendarClock } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { updateTaskAction } from "./actions";

function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function TaskRescheduleDialog({ taskId, currentDueAt }: { taskId: string; currentDueAt: Date }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleSubmit(formData: FormData) {
    const dueAt = String(formData.get("dueAt") || "");
    if (!dueAt) return;
    setPending(true);
    try {
      await updateTaskAction(taskId, { dueAt });
      toast.success("Task rescheduled");
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to reschedule task");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="ghost" />}>
        <CalendarClock className="size-3.5" />
        Reschedule
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reschedule Task</DialogTitle>
        </DialogHeader>
        <form action={handleSubmit} className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="reschedule-due">Due</FieldLabel>
            <Input id="reschedule-due" name="dueAt" type="datetime-local" defaultValue={toLocalInputValue(currentDueAt)} required />
          </Field>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
