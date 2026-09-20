"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { computeOpportunityPipeline, OPPORTUNITY_STAGE_ORDER } from "@/lib/opportunity-engine/pipeline";
import { createOpportunityAction, changeOpportunityStageAction } from "./opportunity-actions";
import type { OpportunityProduct, OpportunityStage } from "@/generated/prisma/client";

export type OpportunityRow = {
  id: string;
  product: OpportunityProduct;
  estimatedValue: number;
  stage: OpportunityStage;
  lostReason: string | null;
  owner: { id: string; name: string };
  createdAt: Date;
};

const PRODUCT_LABELS: Record<OpportunityProduct, string> = {
  MUTUAL_FUND: "Mutual Fund",
  BROKING: "Broking",
  PMS: "PMS",
  AIF: "AIF",
  BONDS: "Bonds",
  FIXED_INCOME: "Fixed Income",
  UNLISTED_PRE_IPO: "Unlisted / Pre-IPO",
  OTHER: "Other",
};

const STAGE_LABELS: Record<OpportunityStage, string> = {
  IDENTIFIED: "Identified",
  DISCUSSED: "Discussed",
  INTERESTED: "Interested",
  RECOMMENDATION: "Recommendation",
  DECISION_PENDING: "Decision Pending",
  COMMITTED: "Committed",
  FUNDED: "Funded",
  INVESTED: "Invested",
  LOST_DEFERRED: "Lost / Deferred",
};

function formatInr(amount: number) {
  return `₹${Math.round(amount).toLocaleString("en-IN")}`;
}

function AddOpportunityDialog({ clientId, users, defaultOwnerId }: { clientId: string; users: { id: string; name: string }[]; defaultOwnerId?: string }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleSubmit(formData: FormData) {
    formData.set("clientId", clientId);
    setPending(true);
    try {
      await createOpportunityAction(formData);
      toast.success("Opportunity added");
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to add opportunity");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>Add Opportunity</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Opportunity</DialogTitle>
        </DialogHeader>
        <form action={handleSubmit} className="flex flex-col gap-4">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="opp-product">Product</FieldLabel>
              <Select name="product" defaultValue="MUTUAL_FUND">
                <SelectTrigger id="opp-product" className="w-full">
                  <SelectValue>{(v: string) => PRODUCT_LABELS[v as OpportunityProduct] ?? v}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PRODUCT_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="opp-value">Estimated Value (₹)</FieldLabel>
              <Input id="opp-value" name="estimatedValue" type="number" min="1" step="1" required />
            </Field>
            <Field>
              <FieldLabel htmlFor="opp-owner">Owner</FieldLabel>
              <Select name="ownerId" defaultValue={defaultOwnerId}>
                <SelectTrigger id="opp-owner" className="w-full">
                  <SelectValue placeholder="Select owner">
                    {(value: string) => users.find((u) => u.id === value)?.name ?? "Select owner"}
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
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Adding..." : "Add Opportunity"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function OpportunityCard({ clientId, opportunity }: { clientId: string; opportunity: OpportunityRow }) {
  const [pending, setPending] = useState(false);
  const [reasonOpen, setReasonOpen] = useState(false);
  const [reason, setReason] = useState("");

  async function applyStageChange(toStage: OpportunityStage, changeReason?: string) {
    setPending(true);
    try {
      await changeOpportunityStageAction({ opportunityId: opportunity.id, clientId, toStage, reason: changeReason });
      toast.success(`Moved to ${STAGE_LABELS[toStage]}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update stage");
    } finally {
      setPending(false);
    }
  }

  function handleStageSelect(value: OpportunityStage | null) {
    if (!value) return;
    const toStage = value;
    if (toStage === "LOST_DEFERRED") {
      setReasonOpen(true);
      return;
    }
    void applyStageChange(toStage);
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-medium">
          {PRODUCT_LABELS[opportunity.product]} · {formatInr(opportunity.estimatedValue)}
        </p>
        <p className="text-xs text-muted-foreground">
          Owner: {opportunity.owner.name}
          {opportunity.lostReason ? ` · Lost reason: ${opportunity.lostReason}` : ""}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant={opportunity.stage === "LOST_DEFERRED" ? "destructive" : opportunity.stage === "INVESTED" ? "success" : "secondary"}>
          {STAGE_LABELS[opportunity.stage]}
        </Badge>
        <Dialog open={reasonOpen} onOpenChange={setReasonOpen}>
          <Select value={opportunity.stage} onValueChange={handleStageSelect} disabled={pending}>
            <SelectTrigger className="w-44">
              <SelectValue>{(v: string) => STAGE_LABELS[v as OpportunityStage] ?? v}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {OPPORTUNITY_STAGE_ORDER.map((stage) => (
                <SelectItem key={stage} value={stage}>
                  {STAGE_LABELS[stage]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reason for Lost / Deferred</DialogTitle>
            </DialogHeader>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="lost-reason">Reason</FieldLabel>
                <Input id="lost-reason" value={reason} onChange={(e) => setReason(e.target.value)} required />
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button
                disabled={pending || !reason.trim()}
                onClick={async () => {
                  await applyStageChange("LOST_DEFERRED", reason);
                  setReasonOpen(false);
                  setReason("");
                }}
              >
                {pending ? "Saving..." : "Mark Lost / Deferred"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

export function OpportunitiesPanel({
  clientId,
  opportunities,
  users,
  defaultOwnerId,
}: {
  clientId: string;
  opportunities: OpportunityRow[];
  users: { id: string; name: string }[];
  defaultOwnerId?: string;
}) {
  const pipeline = computeOpportunityPipeline(opportunities).filter((row) => row.count > 0);
  const totalOpenValue = pipeline.filter((row) => row.stage !== "LOST_DEFERRED" && row.stage !== "INVESTED").reduce((sum, row) => sum + row.totalValue, 0);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Opportunities</CardTitle>
        <AddOpportunityDialog clientId={clientId} users={users} defaultOwnerId={defaultOwnerId} />
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {opportunities.length === 0 ? (
          <p className="text-sm text-muted-foreground">No opportunities identified yet for this client.</p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              Open pipeline value: <span className="font-medium text-foreground">{formatInr(totalOpenValue)}</span>
            </p>
            <div className="flex flex-col gap-2">
              {opportunities.map((opportunity) => (
                <OpportunityCard key={opportunity.id} clientId={clientId} opportunity={opportunity} />
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
