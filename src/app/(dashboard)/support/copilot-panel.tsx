"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { CopilotState } from "@/lib/support/copilot/service";
import { formatDateTime } from "@/lib/utils/format";
import { getCopilotAction, requestReplyApprovalAction, sendApprovedReplyAction } from "./copilot-actions";

const SOURCE_LABEL = { model: "AI draft", template: "Template reply" } as const;

/**
 * The Support co-pilot for one hand-off, opened on demand. It shows the facts, the escalation suggestion and a suggested reply. It never
 * sends: "Send for approval" stores the reply for an approver, and the approver's "Send approved reply" is the only way it reaches Freshdesk.
 */
export function CopilotPanel({ activityId }: { activityId: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [state, setState] = useState<CopilotState | null>(null);
  const [draft, setDraft] = useState("");
  const [original, setOriginal] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const panelId = `copilot-${activityId}`;

  /** Opening the panel drafts a reply. Later refreshes (after an approval step) keep the reply the person is editing. */
  async function load(withDraft: boolean) {
    setLoading(true);
    try {
      const next = await getCopilotAction(activityId, { draft: withDraft });
      setState((prev) => (next.status === "ready" && next.draft === null && prev?.status === "ready" ? { ...next, draft: prev.draft } : next));
      if (withDraft && next.status === "ready" && next.draft?.status === "draft") {
        setDraft(next.draft.body);
        setOriginal(next.draft.body);
      }
    } catch {
      toast.error("Could not load the co-pilot right now.");
    } finally {
      setLoading(false);
    }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) void load(true);
  }

  async function sendForApproval(source: "model" | "template") {
    setBusy(true);
    setNotice(null);
    try {
      const result = await requestReplyApprovalAction(activityId, draft, source, draft.trim() !== original.trim());
      if (result.status === "requested") {
        setNotice("Sent for approval. Nothing has gone to the customer yet.");
        await load(false);
      } else {
        setNotice(result.message);
      }
    } catch {
      setNotice("Could not send the reply for approval right now.");
    } finally {
      setBusy(false);
    }
  }

  async function sendApproved(approvalId: string) {
    setBusy(true);
    setNotice(null);
    try {
      const result = await sendApprovedReplyAction(approvalId);
      setNotice(result.status === "sent" ? "Reply sent to Freshdesk." : result.message);
      await load(false);
    } catch {
      setNotice("Could not send the reply right now.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Button type="button" size="sm" variant="outline" aria-expanded={open} aria-controls={panelId} onClick={toggle}>
          {open ? "Hide copilot" : "Copilot"}
        </Button>
      </div>
      {open && (
        <section id={panelId} aria-label="Support co-pilot" aria-live="polite" className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-3 text-sm">
          {loading && !state && <p className="text-muted-foreground">Preparing the summary</p>}
          {state?.status === "off" && <p className="text-muted-foreground">The support co-pilot is off.</p>}
          {state?.status === "not_found" && <p className="text-muted-foreground">This hand-off is not available to you.</p>}

          {(state?.status === "ready" || state?.status === "closed") && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{state.facts.category.replace(/_/g, " ")}</Badge>
                {state.facts.escalate && <Badge variant="destructive">Escalate</Badge>}
              </div>
              <ul className="list-disc space-y-1 pl-5" aria-label="Ticket facts">
                {state.lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              {state.ticketSummary && (
                <p className="text-muted-foreground">
                  <span className="font-medium text-foreground">Ticket summary: </span>
                  {state.ticketSummary}
                </p>
              )}
            </>
          )}

          {state?.status === "ready" && state.facts.escalate && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2">
              <p className="font-medium">Escalation suggested</p>
              <p className="text-muted-foreground">Hand this to a manager before replying. The suggested reply only acknowledges the concern and says a senior team member will follow up.</p>
            </div>
          )}

          {state?.status === "closed" && <p className="text-muted-foreground">This ticket is closed, so no reply is drafted.</p>}

          {state?.status === "ready" && state.draft?.status === "refused" && <p className="text-muted-foreground">No reply suggested: {state.draft.reason}</p>}
          {state?.status === "ready" && state.draft?.status === "blocked" && <p className="text-muted-foreground">No reply suggested: the AI step is not allowed for this customer right now ({state.draft.reason}).</p>}

          {state?.status === "ready" && state.draft?.status === "draft" && (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">Suggested reply</p>
                <Badge variant="secondary">{SOURCE_LABEL[state.draft.source]}</Badge>
                {state.draft.note && <span className="text-xs text-muted-foreground">{state.draft.note}</span>}
              </div>
              <label htmlFor={`${panelId}-draft`} className="sr-only">
                Reply text
              </label>
              <Textarea id={`${panelId}-draft`} value={draft} onChange={(e) => setDraft(e.target.value)} rows={4} maxLength={1200} disabled={busy} />
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" disabled={busy || draft.trim().length === 0} onClick={() => void sendForApproval(state.draft?.status === "draft" ? state.draft.source : "template")}>
                  Send for approval
                </Button>
                {draft.trim() !== original.trim() && (
                  <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setDraft(original)}>
                    Reset to suggestion
                  </Button>
                )}
              </div>
            </div>
          )}

          {state?.status === "ready" && state.approval && (
            <div className="flex flex-col gap-2 border-t border-border pt-3">
              <p>
                <span className="font-medium">Approval: </span>
                {approvalWords(state.approval.status, state.approval.appliedAt)}
                {state.approval.expiresAt && state.approval.status === "PENDING" ? ` (expires ${formatDateTime(state.approval.expiresAt)})` : ""}
              </p>
              {state.canSend && (
                <div>
                  <Button type="button" size="sm" disabled={busy} onClick={() => void sendApproved(state.approval!.id)}>
                    Send approved reply
                  </Button>
                </div>
              )}
            </div>
          )}

          {notice && (
            <p role="status" className="text-muted-foreground">
              {notice}
            </p>
          )}
        </section>
      )}
    </div>
  );
}

function approvalWords(status: string, appliedAt: Date | null): string {
  if (appliedAt) return "sent to Freshdesk";
  if (status === "PENDING") return "waiting for an approver";
  if (status === "APPROVED") return "approved, not yet sent";
  if (status === "REJECTED") return "rejected";
  if (status === "EXPIRED") return "expired";
  return status.toLowerCase();
}
