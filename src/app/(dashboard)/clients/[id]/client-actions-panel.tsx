"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  Pause,
  PlayCircle,
  XCircle,
  RotateCcw,
  GitMerge,
  ArrowRightLeft,
  Archive as ArchiveIcon,
  ArchiveRestore,
  Trash2,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import type { Client, ErasureRequest, Role, Stage, User } from "@/generated/prisma/client";
import {
  reassignClientAction,
  putOnHoldAction,
  resumeFromHoldAction,
  markNotProceedingAction,
  reopenClientAction,
  searchClientsForMergeAction,
  mergeClientsAction,
  archiveClientAction,
  restoreClientAction,
  correctStageAction,
} from "../actions";
import { HOLD_REASONS, NOT_PROCEEDING_REASONS } from "@/lib/clients/options";
import { createErasureRequestAction } from "@/app/(dashboard)/settings/data-privacy/actions";
import { formatDateTime } from "@/lib/utils/format";

function actionRowClass(variant: "default" | "destructive" = "default") {
  return cn(
    "inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-muted",
    variant === "destructive" && "border-destructive/30 text-destructive hover:bg-destructive/10",
  );
}

export function ClientActionsPanel({
  client,
  users,
  currentUserRole,
  stages,
  erasureRequest,
}: {
  client: Omit<Client, "expectedInvestment"> & { expectedInvestment: number | null };
  users: Pick<User, "id" | "name">[];
  currentUserRole: Role;
  stages: Stage[];
  erasureRequest: ErasureRequest | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [assignedToId, setAssignedToId] = useState(client.assignedToId ?? "");
  const [holdOpen, setHoldOpen] = useState(false);
  const [notProceedingOpen, setNotProceedingOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeQuery, setMergeQuery] = useState("");
  const [mergeResults, setMergeResults] = useState<
    { id: string; name: string; clientCode: string; mobile: string | null; email: string | null }[]
  >([]);
  const [mergeSearching, setMergeSearching] = useState(false);
  const [selectedMergeIds, setSelectedMergeIds] = useState<Set<string>>(new Set());
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [correctStageOpen, setCorrectStageOpen] = useState(false);
  const [eraseOpen, setEraseOpen] = useState(false);

  const [prevClient, setPrevClient] = useState(client);
  if (prevClient.assignedToId !== client.assignedToId || prevClient.status !== client.status) {
    setPrevClient(client);
    setAssignedToId(client.assignedToId ?? "");
  }

  function handleReassign(value: string | null) {
    if (!value) return;
    setAssignedToId(value);
    startTransition(async () => {
      try {
        await reassignClientAction(client.id, value);
        toast.success("Client reassigned");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to reassign client");
      }
    });
  }

  async function handleHoldSubmit(formData: FormData) {
    try {
      await putOnHoldAction(client.id, {
        reason: String(formData.get("reason")),
        notes: String(formData.get("notes") || "") || undefined,
        expectedResumeDate: String(formData.get("expectedResumeDate") || "") || undefined,
      });
      toast.success("Client put on hold");
      setHoldOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to put client on hold");
    }
  }

  function handleResume() {
    startTransition(async () => {
      try {
        await resumeFromHoldAction(client.id);
        toast.success("Client resumed");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to resume client");
      }
    });
  }

  async function handleNotProceedingSubmit(formData: FormData) {
    try {
      await markNotProceedingAction(client.id, {
        reason: String(formData.get("reason")),
        notes: String(formData.get("notes") || "") || undefined,
      });
      toast.success("Client marked not proceeding");
      setNotProceedingOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update client");
    }
  }

  function handleReopen() {
    startTransition(async () => {
      try {
        await reopenClientAction(client.id, { reason: "Reopened by manager" });
        toast.success("Client reopened");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to reopen client");
      }
    });
  }

  async function handleMergeSearch(query: string) {
    setMergeQuery(query);
    if (!query.trim()) {
      setMergeResults([]);
      return;
    }
    setMergeSearching(true);
    try {
      const results = await searchClientsForMergeAction(query, client.id);
      setMergeResults(results);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Search failed");
    } finally {
      setMergeSearching(false);
    }
  }

  function toggleMergeSelection(id: string) {
    setSelectedMergeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleMergeSelected() {
    startTransition(async () => {
      try {
        const { merged } = await mergeClientsAction(client.id, [...selectedMergeIds]);
        const conflictCount = merged.reduce((sum, m) => sum + m.conflicts.length, 0);
        toast.success(
          `Merged ${merged.length} client(s)${conflictCount ? `, ${conflictCount} field conflict(s) need review` : ""}`,
        );
        setMergeOpen(false);
        setMergeQuery("");
        setMergeResults([]);
        setSelectedMergeIds(new Set());
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to merge clients");
      }
    });
  }

  function handleArchive(formData: FormData) {
    startTransition(async () => {
      try {
        await archiveClientAction(client.id, String(formData.get("reason") || "") || undefined);
        toast.success("Client archived");
        setArchiveOpen(false);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to archive client");
      }
    });
  }

  function handleRestore() {
    startTransition(async () => {
      try {
        await restoreClientAction(client.id);
        toast.success("Client restored");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to restore client");
      }
    });
  }

  async function handleEraseSubmit(formData: FormData) {
    try {
      formData.set("subjectType", "Client");
      formData.set("subjectId", client.id);
      await createErasureRequestAction(formData);
      toast.success("Submitted for Admin approval");
      setEraseOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to submit deletion request");
    }
  }

  async function handleCorrectStageSubmit(formData: FormData) {
    try {
      const { pendingApproval } = await correctStageAction(
        client.id,
        String(formData.get("toStageId")),
        String(formData.get("reason")),
      );
      toast.success(pendingApproval ? "Submitted for Admin approval" : "Stage corrected");
      setCorrectStageOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to correct stage");
    }
  }

  const canReopen = currentUserRole === "ADMIN" || currentUserRole === "MANAGER";
  const canPutOnHold = currentUserRole === "ADMIN" || currentUserRole === "MANAGER";
  const canMerge = currentUserRole === "ADMIN" || currentUserRole === "MANAGER" || currentUserRole === "RM";
  const canArchive = currentUserRole === "ADMIN";
  const canCorrectStage = currentUserRole === "ADMIN" || currentUserRole === "MANAGER";
  const canRequestErasure = currentUserRole === "ADMIN" || currentUserRole === "FINANCE";
  const openErasureRequest = erasureRequest && erasureRequest.status !== "REJECTED" && erasureRequest.status !== "COMPLETED" ? erasureRequest : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Actions</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Field>
          <FieldLabel className="text-xs">Assigned RM</FieldLabel>
          <Select value={assignedToId} onValueChange={handleReassign} disabled={isPending}>
            <SelectTrigger size="sm" className="w-full text-xs">
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

        <div className="flex flex-wrap gap-2">
        {client.status === "ON_HOLD" ? (
          <button type="button" className={actionRowClass()} onClick={handleResume} disabled={isPending}>
            <PlayCircle className="size-3.5 shrink-0" />
            <span>Resume from Hold</span>
          </button>
        ) : client.status === "ACTIVE" && canPutOnHold ? (
          <Dialog open={holdOpen} onOpenChange={setHoldOpen}>
            <DialogTrigger render={<button type="button" className={actionRowClass()} />}>
              <Pause className="size-3.5 shrink-0" />
              <span>Put On Hold</span>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Put On Hold</DialogTitle>
              </DialogHeader>
              <form action={handleHoldSubmit} className="flex flex-col gap-4">
                <Field>
                  <FieldLabel htmlFor="hold-reason">Reason</FieldLabel>
                  <Select name="reason" defaultValue={HOLD_REASONS[0]}>
                    <SelectTrigger id="hold-reason" className="w-full">
                      <SelectValue>{(v: string) => v}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {HOLD_REASONS.map((r) => (
                        <SelectItem key={r} value={r}>
                          {r}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="hold-resume-date">Expected Resume Date</FieldLabel>
                  <Input id="hold-resume-date" name="expectedResumeDate" type="date" />
                </Field>
                <Field>
                  <FieldLabel htmlFor="hold-notes">Notes</FieldLabel>
                  <Textarea id="hold-notes" name="notes" rows={2} />
                </Field>
                <DialogFooter>
                  <Button type="submit">Put On Hold</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        ) : null}

        {client.status !== "NOT_PROCEEDING" && client.status !== "COMPLETED" && (
          <Dialog open={notProceedingOpen} onOpenChange={setNotProceedingOpen}>
            <DialogTrigger render={<button type="button" className={actionRowClass("destructive")} />}>
              <XCircle className="size-3.5 shrink-0" />
              <span>Mark Not Proceeding</span>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Mark Not Proceeding</DialogTitle>
              </DialogHeader>
              <form action={handleNotProceedingSubmit} className="flex flex-col gap-4">
                <Field>
                  <FieldLabel htmlFor="np-reason">Reason</FieldLabel>
                  <Select name="reason" defaultValue={NOT_PROCEEDING_REASONS[0]}>
                    <SelectTrigger id="np-reason" className="w-full">
                      <SelectValue>{(v: string) => v}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {NOT_PROCEEDING_REASONS.map((r) => (
                        <SelectItem key={r} value={r}>
                          {r}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="np-notes">Notes</FieldLabel>
                  <Textarea id="np-notes" name="notes" rows={2} />
                </Field>
                <DialogFooter>
                  <Button type="submit" variant="destructive">
                    Mark Not Proceeding
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}

        {client.status === "NOT_PROCEEDING" && canReopen && (
          <button type="button" className={actionRowClass()} onClick={handleReopen} disabled={isPending}>
            <RotateCcw className="size-3.5 shrink-0" />
            <span>Reopen Client</span>
          </button>
        )}

        {canMerge && (
          <Dialog
            open={mergeOpen}
            onOpenChange={(next) => {
              setMergeOpen(next);
              if (!next) {
                setMergeQuery("");
                setMergeResults([]);
                setSelectedMergeIds(new Set());
              }
            }}
          >
            <DialogTrigger render={<button type="button" className={actionRowClass()} />}>
              <GitMerge className="size-3.5 shrink-0" />
              <span>Merge Duplicate</span>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Merge Duplicates Into This Client</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col gap-3">
                <Field>
                  <FieldLabel htmlFor="merge-search">Find duplicate client(s)</FieldLabel>
                  <Input
                    id="merge-search"
                    placeholder="Search by name, mobile, email, client ID..."
                    value={mergeQuery}
                    onChange={(e) => handleMergeSearch(e.target.value)}
                  />
                </Field>
                <div className="flex flex-col gap-2">
                  {mergeSearching && <p className="text-sm text-muted-foreground">Searching...</p>}
                  {!mergeSearching && mergeQuery && mergeResults.length === 0 && (
                    <p className="text-sm text-muted-foreground">No matching clients found.</p>
                  )}
                  {mergeResults.map((candidate) => (
                    <label
                      key={candidate.id}
                      className="flex items-center gap-3 rounded-lg border p-2 text-sm cursor-pointer"
                    >
                      <Checkbox
                        checked={selectedMergeIds.has(candidate.id)}
                        onCheckedChange={() => toggleMergeSelection(candidate.id)}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium">
                          {candidate.name} <span className="text-muted-foreground font-mono">({candidate.clientCode})</span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {candidate.mobile}
                          {candidate.email ? ` · ${candidate.email}` : ""}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
                {selectedMergeIds.size > 0 && (
                  <Button variant="destructive" onClick={handleMergeSelected} disabled={isPending}>
                    Merge {selectedMergeIds.size} Selected
                  </Button>
                )}
              </div>
            </DialogContent>
          </Dialog>
        )}

        {canCorrectStage && (
          <Dialog open={correctStageOpen} onOpenChange={setCorrectStageOpen}>
            <DialogTrigger render={<button type="button" className={actionRowClass()} />}>
              <ArrowRightLeft className="size-3.5 shrink-0" />
              <span>Correct Stage</span>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Correct Stage</DialogTitle>
              </DialogHeader>
              <form action={handleCorrectStageSubmit} className="flex flex-col gap-4">
                <p className="text-sm text-muted-foreground">
                  Moves this client directly to any stage, bypassing the normal sequence.
                  {currentUserRole === "MANAGER" && " Manager corrections require Admin approval before they take effect."}
                </p>
                <Field>
                  <FieldLabel htmlFor="correct-stage-to">Move to Stage</FieldLabel>
                  <Select name="toStageId" defaultValue={client.currentStageId}>
                    <SelectTrigger id="correct-stage-to" className="w-full">
                      <SelectValue>{(v: string) => stages.find((s) => s.id === v)?.name ?? v}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {stages.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="correct-stage-reason">Reason</FieldLabel>
                  <Textarea id="correct-stage-reason" name="reason" rows={2} required />
                </Field>
                <DialogFooter>
                  <Button type="submit">
                    {currentUserRole === "MANAGER" ? "Submit for Approval" : "Correct Stage"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}

        {canArchive &&
          (client.isDeleted ? (
            <button type="button" className={actionRowClass()} onClick={handleRestore} disabled={isPending}>
              <ArchiveRestore className="size-3.5 shrink-0" />
              <span>Restore Client</span>
            </button>
          ) : (
            <Dialog open={archiveOpen} onOpenChange={setArchiveOpen}>
              <DialogTrigger render={<button type="button" className={actionRowClass("destructive")} />}>
                <ArchiveIcon className="size-3.5 shrink-0" />
                <span>Archive Client</span>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Archive Client</DialogTitle>
                </DialogHeader>
                <form action={handleArchive} className="flex flex-col gap-4">
                  <Field>
                    <FieldLabel htmlFor="archive-reason">Reason (optional)</FieldLabel>
                    <Textarea id="archive-reason" name="reason" rows={2} />
                  </Field>
                  <DialogFooter>
                    <Button type="submit" variant="destructive">
                      Archive Client
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          ))}

        {canRequestErasure && !client.isDeleted && !openErasureRequest && (
          <Dialog open={eraseOpen} onOpenChange={setEraseOpen}>
            <DialogTrigger render={<button type="button" className={actionRowClass("destructive")} />}>
              <Trash2 className="size-3.5 shrink-0" />
              <span>Request Permanent Deletion</span>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Request Permanent Deletion</DialogTitle>
              </DialogHeader>
              <form action={handleEraseSubmit} className="flex flex-col gap-4">
                <p className="text-sm text-muted-foreground">
                  Unlike Archive, this permanently removes the client and its onboarding data — it
                  cannot be undone. Requires a different Admin&apos;s approval, and refuses to execute
                  if this client has any household, trading account, or advisory history.
                </p>
                <Field>
                  <FieldLabel htmlFor="erase-notes">Reason</FieldLabel>
                  <Textarea id="erase-notes" name="notes" rows={2} required />
                </Field>
                <DialogFooter>
                  <Button type="submit" variant="destructive">
                    Submit for Approval
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
        </div>

        {canRequestErasure && !client.isDeleted && openErasureRequest && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <p className="font-medium text-destructive">
              Permanent deletion {openErasureRequest.status === "APPROVED" ? "approved, awaiting execution" : "requested"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Submitted {formatDateTime(openErasureRequest.requestedAt)} ·{" "}
              {openErasureRequest.status === "APPROVED"
                ? "an Admin can execute it from Settings > Data Privacy"
                : "awaiting Admin approval in Settings > Approval Workflows"}
              .
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
