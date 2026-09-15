"use client";

import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatNumber } from "@/lib/utils/format";
import { PayoutTraceDrawer, type PayoutLineTrace } from "./payout-trace-drawer";
import { AdjustmentDialog } from "./adjustment-dialog";
import type { PayoutRunStatus, PayoutStatus } from "@/generated/prisma/client";

type PayoutRow = {
  id: string;
  partnerProfileId: string;
  partnerName: string;
  totalAccrualAmount: number;
  adjustmentAmount: number;
  netPayableAmount: number;
  status: PayoutStatus;
  externalPayoutRef: string | null;
  lines: PayoutLineTrace[];
  adjustments: { id: string; amount: number; reason: string; createdAt: Date }[];
};

const PAYOUT_STATUS_VARIANT: Record<PayoutStatus, "outline" | "default" | "success"> = {
  ESTIMATED: "outline",
  APPROVED: "default",
  RECONCILED_EXTERNALLY: "success",
};

export function PayoutTable({ payouts, runStatus }: { payouts: PayoutRow[]; runStatus: PayoutRunStatus }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Card>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead />
              <TableHead>Partner</TableHead>
              <TableHead>Accrued</TableHead>
              <TableHead>Adjustments</TableHead>
              <TableHead>Net Payable</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody striped>
            {payouts.map((payout) => (
              <Fragment key={payout.id}>
                <TableRow>
                  <TableCell>
                    <button type="button" onClick={() => toggle(payout.id)} className="text-muted-foreground hover:text-foreground">
                      {expanded.has(payout.id) ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                    </button>
                  </TableCell>
                  <TableCell className="font-medium">{payout.partnerName}</TableCell>
                  <TableCell className="text-sm">₹{formatNumber(payout.totalAccrualAmount)}</TableCell>
                  <TableCell className="text-sm">₹{formatNumber(payout.adjustmentAmount)}</TableCell>
                  <TableCell className="text-sm font-medium">₹{formatNumber(payout.netPayableAmount)}</TableCell>
                  <TableCell>
                    <Badge variant={PAYOUT_STATUS_VARIANT[payout.status]}>{payout.status.replace(/_/g, " ")}</Badge>
                  </TableCell>
                  <TableCell>
                    {runStatus !== "CANCELLED" && <AdjustmentDialog partnerProfileId={payout.partnerProfileId} payoutId={payout.id} />}
                  </TableCell>
                </TableRow>
                {expanded.has(payout.id) && (
                  <TableRow>
                    <TableCell colSpan={7} className="bg-muted/30">
                      <div className="flex flex-col gap-3 py-2">
                        <div>
                          <p className="mb-1.5 text-xs font-medium text-muted-foreground">Payout Lines</p>
                          <div className="flex flex-col gap-1">
                            {payout.lines.map((line) => (
                              <div key={line.id} className="flex items-center justify-between rounded-md border bg-background px-3 py-1.5 text-sm">
                                <span>₹{formatNumber(line.amount)}</span>
                                <PayoutTraceDrawer line={line} />
                              </div>
                            ))}
                            {payout.lines.length === 0 && <p className="text-sm text-muted-foreground">No accrual lines.</p>}
                          </div>
                        </div>
                        {payout.adjustments.length > 0 && (
                          <div>
                            <p className="mb-1.5 text-xs font-medium text-muted-foreground">Applied Adjustments</p>
                            <div className="flex flex-col gap-1">
                              {payout.adjustments.map((a) => (
                                <div key={a.id} className="flex items-center justify-between rounded-md border bg-background px-3 py-1.5 text-sm">
                                  <span>
                                    ₹{formatNumber(a.amount)} · {a.reason}
                                  </span>
                                  <span className="text-xs text-muted-foreground">{formatDate(a.createdAt)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))}
            {payouts.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                  No payouts in this run.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
