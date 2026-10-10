"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/utils/format";
import { decideApprovalAction } from "./actions";
import type { ApprovalRequest, User } from "@/generated/prisma/client";

type ApprovalWithRequester = ApprovalRequest & { requestedBy: Pick<User, "name"> };

/** Shared by /settings/approval-workflows (full decide capability) and /finance-console
 * (view-only, canDecide=false) — one component, two entry points, per the design. */
export function ApprovalQueue({ requests, canDecide }: { requests: ApprovalWithRequester[]; canDecide: boolean }) {
  const [pending, startTransition] = useTransition();
  // A payout run with a hold (a suspended partner, an unverified bank) comes back blocked: the Admin may approve anyway with a typed reason, which is audited.
  const [blocked, setBlocked] = useState<{ id: string; message: string; reasons: string[] } | null>(null);
  const [reason, setReason] = useState("");

  function handleDecide(id: string, decision: "APPROVED" | "REJECTED", holdOverrideReason?: string) {
    startTransition(async () => {
      try {
        const r = await decideApprovalAction(id, decision, undefined, holdOverrideReason ? { holdOverrideReason } : undefined);
        if (r.ok) {
          setBlocked(null);
          setReason("");
          toast.success(decision === "APPROVED" ? "Approved" : "Rejected");
        } else {
          setBlocked({ id, message: r.message, reasons: r.blocked });
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to decide request");
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Pending Approvals</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Action</TableHead>
              <TableHead>Entity</TableHead>
              <TableHead>Requested By</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Requested At</TableHead>
              {canDecide && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody striped>
            {requests.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <Badge variant="outline">{r.actionType.replace(/_/g, " ")}</Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {r.entity} <span className="font-mono text-xs">{r.entityId}</span>
                </TableCell>
                <TableCell className="text-sm">{r.requestedBy.name}</TableCell>
                <TableCell className="max-w-64 truncate text-sm text-muted-foreground">{r.reason ?? "—"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{formatDateTime(r.requestedAt)}</TableCell>
                {canDecide && (
                  <TableCell className="flex gap-2">
                    <Button size="sm" disabled={pending} onClick={() => handleDecide(r.id, "APPROVED")}>
                      Approve
                    </Button>
                    <Button size="sm" variant="destructive" disabled={pending} onClick={() => handleDecide(r.id, "REJECTED")}>
                      Reject
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
            {blocked && (
              <TableRow>
                <TableCell colSpan={canDecide ? 6 : 5}>
                  <div role="alert" className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
                    <p className="font-medium text-warning">{blocked.message}</p>
                    <ul className="list-disc pl-5 text-muted-foreground">
                      {blocked.reasons.map((x) => <li key={x}>{x}</li>)}
                    </ul>
                    <label htmlFor="hold-reason" className="text-xs font-medium">To approve anyway, type the reason (at least 10 characters). It is recorded in the audit log.</label>
                    <Textarea id="hold-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
                    <div className="flex gap-2">
                      <Button size="sm" disabled={pending || reason.trim().length < 10} onClick={() => handleDecide(blocked.id, "APPROVED", reason)}>Approve with this reason</Button>
                      <Button size="sm" variant="outline" onClick={() => { setBlocked(null); setReason(""); }}>Leave it pending</Button>
                    </div>
                  </div>
                </TableCell>
              </TableRow>
            )}
            {requests.length === 0 && (
              <TableRow>
                <TableCell colSpan={canDecide ? 6 : 5} className="py-8 text-center text-muted-foreground">
                  No pending approvals.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
