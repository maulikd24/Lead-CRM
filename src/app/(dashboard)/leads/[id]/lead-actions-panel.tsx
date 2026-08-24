"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import type { Lead, LeadStatus, User } from "@/generated/prisma/client";
import {
  updateLeadStatusAction,
  reassignLeadAction,
  convertLeadToContactAction,
} from "../actions";

const STATUSES: LeadStatus[] = ["NEW", "CONTACTED", "QUALIFIED", "CONVERTED", "LOST", "JUNK"];

export function LeadActionsPanel({
  lead,
  users,
}: {
  lead: Lead;
  users: Pick<User, "id" | "name">[];
}) {
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<LeadStatus>(lead.status);
  const [assignedToId, setAssignedToId] = useState(lead.assignedToId ?? "");

  // Re-sync local (optimistic) state during render when the server-provided
  // lead prop changes underneath us — e.g. after revalidatePath refreshes this
  // page following a mutation made elsewhere. Adjusting state while rendering
  // (rather than in an Effect) avoids an extra render pass; see React docs on
  // "Adjusting state when a prop changes."
  const [prevLead, setPrevLead] = useState(lead);
  if (prevLead.status !== lead.status || prevLead.assignedToId !== lead.assignedToId) {
    setPrevLead(lead);
    setStatus(lead.status);
    setAssignedToId(lead.assignedToId ?? "");
  }

  function handleStatusChange(value: string | null) {
    if (!value) return;
    const next = value as LeadStatus;
    setStatus(next);
    startTransition(async () => {
      try {
        await updateLeadStatusAction(lead.id, next);
        toast.success("Status updated");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to update status");
      }
    });
  }

  function handleReassign(value: string | null) {
    if (!value) return;
    setAssignedToId(value);
    startTransition(async () => {
      try {
        await reassignLeadAction(lead.id, value);
        toast.success("Lead reassigned");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to reassign lead");
      }
    });
  }

  function handleConvert() {
    startTransition(async () => {
      try {
        await convertLeadToContactAction(lead.id);
        toast.success("Lead converted to contact");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to convert lead");
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Actions</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Field>
          <FieldLabel>Status</FieldLabel>
          <Select value={status} onValueChange={handleStatusChange} disabled={isPending}>
            <SelectTrigger className="w-full">
              <SelectValue>{(value: string) => value}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field>
          <FieldLabel>Assigned To</FieldLabel>
          <Select value={assignedToId} onValueChange={handleReassign} disabled={isPending}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Unassigned">
                {(value: string) => users.find((u) => u.id === value)?.name ?? "Unassigned"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {users.map((user) => (
                <SelectItem key={user.id} value={user.id}>
                  {user.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        {lead.status !== "CONVERTED" && (
          <Button variant="secondary" onClick={handleConvert} disabled={isPending}>
            Convert to Contact
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
