"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/utils/format";
import { decideApprovalAction } from "./actions";
import type { ApprovalRequest, User } from "@/generated/prisma/client";

type ApprovalWithRequester = ApprovalRequest & { requestedBy: Pick<User, "name"> };

/** Shared by /settings/approval-workflows (full decide capability) and /finance-console
 * (view-only, canDecide=false) — one component, two entry points, per the design. */
export function ApprovalQueue({ requests, canDecide }: { requests: ApprovalWithRequester[]; canDecide: boolean }) {
  const [pending, startTransition] = useTransition();

  function handleDecide(id: string, decision: "APPROVED" | "REJECTED") {
    startTransition(async () => {
      try {
        await decideApprovalAction(id, decision);
        toast.success(decision === "APPROVED" ? "Approved" : "Rejected");
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
