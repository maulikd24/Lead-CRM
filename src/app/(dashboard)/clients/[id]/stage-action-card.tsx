"use client";

import { useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";

import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDateTime } from "@/lib/utils/format";
import type {
  Client,
  Stage,
  Document,
  KycRecord,
  FundingRecord,
  DealerIntroduction,
  Activity,
} from "@/generated/prisma/client";
import {
  recordRmContactAction,
  startDocumentCollectionAction,
  updateDocumentStatusAction,
  submitForKycAction,
  completeKycAction,
  updateFundingAction,
  recordDealerIntroductionAction,
} from "../actions";
import { useGateBlockers } from "./use-gate-check";
import { GateBlockerList } from "./gate-blocker-list";

export type FullClient = Omit<Client, "expectedInvestment"> & {
  expectedInvestment: number | null;
  currentStage: Stage;
  documents: Document[];
  kycRecord: KycRecord | null;
  fundingRecord: (Omit<FundingRecord, "amount"> & { amount: number | null }) | null;
  dealerIntroduction: DealerIntroduction | null;
  activities: Pick<Activity, "type" | "payload">[];
};

const CONTACT_METHODS = ["Phone", "WhatsApp", "In-person", "Email", "Other"];
const CONTACT_OUTCOMES = [
  "Connected",
  "Call back requested",
  "Interested",
  "Not interested",
  "Unreachable",
  "Wrong number",
];
const DOC_STATUSES = ["PENDING", "RECEIVED", "VERIFIED", "REJECTED", "NOT_APPLICABLE"];

export function RmContactForm({ clientId }: { clientId: string }) {
  const [outcome, setOutcome] = useState(CONTACT_OUTCOMES[0]);
  const [pending, setPending] = useState(false);
  const requiresNotes = ["Not interested", "Unreachable", "Wrong number"].includes(outcome);
  const requiresNextAction = ["Call back requested", "Interested"].includes(outcome);

  async function handleSubmit(formData: FormData) {
    setPending(true);
    try {
      await recordRmContactAction(clientId, {
        contactMethod: formData.get("contactMethod") as never,
        contactOutcome: outcome as never,
        notes: String(formData.get("notes") || "") || undefined,
        nextAction: String(formData.get("nextAction") || "") || undefined,
        nextActionDate: String(formData.get("nextActionDate") || "") || undefined,
      });
      toast.success("Contact recorded");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to record contact");
    } finally {
      setPending(false);
    }
  }

  return (
    <form action={handleSubmit}>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="contactMethod">Contact Method</FieldLabel>
          <Select name="contactMethod" defaultValue={CONTACT_METHODS[0]}>
            <SelectTrigger id="contactMethod" className="w-full">
              <SelectValue>{(v: string) => v}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {CONTACT_METHODS.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="contactOutcome">Outcome</FieldLabel>
          <Select value={outcome} onValueChange={(v) => v && setOutcome(v)}>
            <SelectTrigger id="contactOutcome" className="w-full">
              <SelectValue>{(v: string) => v}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {CONTACT_OUTCOMES.map((o) => (
                <SelectItem key={o} value={o}>
                  {o}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="notes">
            Notes {requiresNotes && <span className="text-destructive">(required)</span>}
          </FieldLabel>
          <Textarea id="notes" name="notes" rows={2} required={requiresNotes} />
        </Field>
        <Field>
          <FieldLabel htmlFor="nextAction">
            Next Action {requiresNextAction && <span className="text-destructive">(required)</span>}
          </FieldLabel>
          <Input id="nextAction" name="nextAction" required={requiresNextAction} placeholder="Call back tomorrow" />
        </Field>
        <Field>
          <FieldLabel htmlFor="nextActionDate">Next Action Date</FieldLabel>
          <Input id="nextActionDate" name="nextActionDate" type="datetime-local" />
        </Field>
      </FieldGroup>
      <Button type="submit" className="mt-4" disabled={pending}>
        {pending ? "Saving..." : "Record Contact"}
      </Button>
    </form>
  );
}

export function StartDocumentsForm({ clientId }: { clientId: string }) {
  const [pending, setPending] = useState(false);

  async function handleClick() {
    setPending(true);
    try {
      await startDocumentCollectionAction(clientId);
      toast.success("Started document collection");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to start document collection");
    } finally {
      setPending(false);
    }
  }
  return (
    <Button onClick={handleClick} disabled={pending}>
      {pending ? "Starting..." : "Start Document Collection"}
    </Button>
  );
}

export function DocumentStatusList({ documents }: { documents: Document[] }) {
  const [optimisticDocuments, applyOptimisticStatus] = useOptimistic(
    documents,
    (state, update: { documentId: string; status: string }) =>
      state.map((d) => (d.id === update.documentId ? { ...d, status: update.status as Document["status"] } : d)),
  );
  const [, startTransition] = useTransition();

  function handleStatusChange(documentId: string, status: string) {
    startTransition(async () => {
      applyOptimisticStatus({ documentId, status });
      try {
        await updateDocumentStatusAction(documentId, { status: status as never });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to update document");
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {optimisticDocuments.map((doc) => (
        <div key={doc.id} className="flex items-center justify-between gap-2 text-sm">
          <span>
            {doc.documentType}
            {doc.mandatory && <span className="text-destructive"> *</span>}
          </span>
          <Select value={doc.status} onValueChange={(v) => v && handleStatusChange(doc.id, v)}>
            <SelectTrigger className="w-40 h-8 text-xs">
              <SelectValue>{(v: string) => v}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {DOC_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ))}
    </div>
  );
}

export function SubmitForKycForm({
  clientId,
  documents,
  canOverride,
}: {
  clientId: string;
  documents: Document[];
  canOverride: boolean;
}) {
  const [override, setOverride] = useState(false);
  const [submitPending, setSubmitPending] = useState(false);

  async function handleSubmitForKyc(formData: FormData) {
    setSubmitPending(true);
    try {
      await submitForKycAction(clientId, {
        submissionMethod: String(formData.get("submissionMethod") || "") || undefined,
        kycReferenceNumber: String(formData.get("kycReferenceNumber") || "") || undefined,
        remarks: String(formData.get("remarks") || "") || undefined,
        override,
      });
      toast.success("Submitted for KYC");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to submit for KYC");
    } finally {
      setSubmitPending(false);
    }
  }

  const mandatoryIncomplete = documents.filter(
    (d) => d.mandatory && d.status !== "VERIFIED" && d.status !== "NOT_APPLICABLE",
  );
  const { blocked, messages } = useGateBlockers([
    {
      condition: mandatoryIncomplete.length > 0,
      message: `Mandatory incomplete: ${mandatoryIncomplete.map((d) => d.documentType).join(", ")}`,
    },
  ]);

  return (
    <form action={handleSubmitForKyc} className="flex flex-col gap-3">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="submissionMethod">Submission Method</FieldLabel>
          <Input id="submissionMethod" name="submissionMethod" placeholder="Online / Branch" />
        </Field>
        <Field>
          <FieldLabel htmlFor="kycReferenceNumber">KYC Reference Number</FieldLabel>
          <Input id="kycReferenceNumber" name="kycReferenceNumber" />
        </Field>
        <Field>
          <FieldLabel htmlFor="remarks">Remarks</FieldLabel>
          <Textarea id="remarks" name="remarks" rows={2} />
        </Field>
      </FieldGroup>
      <GateBlockerList messages={messages} />
      {mandatoryIncomplete.length > 0 && canOverride && (
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
          Override incomplete mandatory documents
        </label>
      )}
      <Button type="submit" disabled={submitPending || (blocked && !override)}>
        {submitPending ? "Submitting..." : "Submit for KYC"}
      </Button>
    </form>
  );
}

export function KycCompletionForm({ clientId, kycRecord }: { clientId: string; kycRecord: KycRecord | null }) {
  const [status, setStatus] = useState("APPROVED");
  const [rejectionReason, setRejectionReason] = useState("");
  const [pending, setPending] = useState(false);

  const { blocked, messages } = useGateBlockers([
    { condition: status === "REJECTED" && !rejectionReason.trim(), message: "A rejection reason is required when KYC is rejected" },
  ]);

  async function handleSubmit(formData: FormData) {
    setPending(true);
    try {
      await completeKycAction(clientId, {
        status: status as never,
        referenceNumber: String(formData.get("referenceNumber") || "") || undefined,
        rejectionReason: String(formData.get("rejectionReason") || "") || undefined,
        remarks: String(formData.get("remarks") || "") || undefined,
      });
      toast.success("KYC updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update KYC");
    } finally {
      setPending(false);
    }
  }

  return (
    <form action={handleSubmit}>
      <p className="text-xs text-muted-foreground mb-3">
        Submitted {kycRecord?.submissionDate ? formatDateTime(kycRecord.submissionDate) : "—"}
        {kycRecord?.referenceNumber ? ` · Ref ${kycRecord.referenceNumber}` : ""}
      </p>
      <FieldGroup>
        <Field>
          <FieldLabel>Status</FieldLabel>
          <Select value={status} onValueChange={(v) => v && setStatus(v)}>
            <SelectTrigger className="w-full">
              <SelectValue>{(v: string) => v.replace(/_/g, " ")}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="APPROVED">Approved</SelectItem>
              <SelectItem value="REJECTED">Rejected</SelectItem>
              <SelectItem value="ADDITIONAL_INFO_REQUIRED">Additional Info Required</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="referenceNumber">Reference Number</FieldLabel>
          <Input id="referenceNumber" name="referenceNumber" />
        </Field>
        {status === "REJECTED" && (
          <Field>
            <FieldLabel htmlFor="rejectionReason">
              Rejection Reason <span className="text-destructive">(required)</span>
            </FieldLabel>
            <Textarea
              id="rejectionReason"
              name="rejectionReason"
              rows={2}
              required
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
            />
          </Field>
        )}
        <Field>
          <FieldLabel htmlFor="remarks">Remarks</FieldLabel>
          <Textarea id="remarks" name="remarks" rows={2} />
        </Field>
      </FieldGroup>
      <GateBlockerList messages={messages} />
      <Button type="submit" className="mt-4" disabled={pending || blocked}>
        {pending ? "Saving..." : "Save"}
      </Button>
    </form>
  );
}

export function FundingForm({
  clientId,
  fundingRecord,
}: {
  clientId: string;
  fundingRecord: (Omit<FundingRecord, "amount"> & { amount: number | null }) | null;
}) {
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState(fundingRecord?.status ?? "PENDING");
  const [amount, setAmount] = useState(fundingRecord?.amount ? String(fundingRecord.amount) : "");
  const [bankAccountVerified, setBankAccountVerified] = useState(fundingRecord?.bankAccountVerified ?? false);
  const [bankAccountLast4, setBankAccountLast4] = useState(fundingRecord?.bankAccountLast4 ?? "");

  const qualifying = status === "PARTIALLY_FUNDED" || status === "FULLY_FUNDED";
  const { blocked, messages } = useGateBlockers([
    {
      condition: qualifying && !(Number(amount) >= 5_000),
      message: "A minimum initial margin of ₹5,000 is required for a funded status",
    },
    {
      condition: qualifying && !bankAccountVerified,
      message: "Bank account penny-drop verification must be completed before marking as funded",
    },
  ]);

  async function handleSubmit(formData: FormData) {
    setPending(true);
    try {
      await updateFundingAction(clientId, {
        status: formData.get("status") as never,
        amount: formData.get("amount") ? Number(formData.get("amount")) : undefined,
        fundingDate: String(formData.get("fundingDate") || "") || undefined,
        fundingMethod: String(formData.get("fundingMethod") || "") || undefined,
        referenceNumber: String(formData.get("referenceNumber") || "") || undefined,
        remarks: String(formData.get("remarks") || "") || undefined,
        bankAccountVerified: formData.get("bankAccountVerified") === "on",
        bankAccountLast4: String(formData.get("bankAccountLast4") || "") || undefined,
      });
      toast.success("Funding updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update funding");
    } finally {
      setPending(false);
    }
  }

  return (
    <form action={handleSubmit}>
      {fundingRecord && (
        <Badge variant="outline" className="mb-3">
          Current: {fundingRecord.status.replace(/_/g, " ")}
        </Badge>
      )}
      <FieldGroup>
        <Field>
          <FieldLabel>Status</FieldLabel>
          <Select name="status" value={status} onValueChange={(v) => v && setStatus(v)}>
            <SelectTrigger className="w-full">
              <SelectValue>{(v: string) => v.replace(/_/g, " ")}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="PENDING">Pending</SelectItem>
              <SelectItem value="PARTIALLY_FUNDED">Partially Funded</SelectItem>
              <SelectItem value="FULLY_FUNDED">Fully Funded</SelectItem>
              <SelectItem value="NOT_PROCEEDING">Not Proceeding</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="amount">
            Amount {qualifying && <span className="text-destructive">(minimum ₹5,000 required)</span>}
          </FieldLabel>
          <Input id="amount" name="amount" type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="fundingDate">Funding Date</FieldLabel>
          <Input id="fundingDate" name="fundingDate" type="date" />
        </Field>
        <Field>
          <FieldLabel htmlFor="fundingMethod">Funding Method</FieldLabel>
          <Input id="fundingMethod" name="fundingMethod" />
        </Field>
        <Field>
          <FieldLabel htmlFor="referenceNumber">Reference Number</FieldLabel>
          <Input id="referenceNumber" name="referenceNumber" />
        </Field>
        <Field>
          <FieldLabel htmlFor="bankAccountVerified" className="flex items-center gap-2">
            <input
              id="bankAccountVerified"
              name="bankAccountVerified"
              type="checkbox"
              checked={bankAccountVerified}
              onChange={(e) => setBankAccountVerified(e.target.checked)}
            />
            Bank account penny-drop verified
          </FieldLabel>
        </Field>
        <Field>
          <FieldLabel htmlFor="bankAccountLast4">Bank Account (last 4 digits)</FieldLabel>
          <Input
            id="bankAccountLast4"
            name="bankAccountLast4"
            maxLength={4}
            value={bankAccountLast4}
            onChange={(e) => setBankAccountLast4(e.target.value.replace(/\D/g, "").slice(0, 4))}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="remarks">Remarks</FieldLabel>
          <Textarea id="remarks" name="remarks" rows={2} />
        </Field>
      </FieldGroup>
      <GateBlockerList messages={messages} />
      <Button type="submit" className="mt-4" disabled={pending || blocked}>
        {pending ? "Saving..." : "Save"}
      </Button>
    </form>
  );
}

export function DealerIntroForm({
  clientId,
  dealerIntroduction,
}: {
  clientId: string;
  dealerIntroduction: DealerIntroduction | null;
}) {
  const [pending, setPending] = useState(false);
  const [dealerName, setDealerName] = useState(dealerIntroduction?.dealerName ?? "");

  const { blocked, messages } = useGateBlockers([
    { condition: !dealerName.trim(), message: "Dealer name is required before recording a dealer introduction" },
  ]);

  async function handleSubmit(formData: FormData) {
    setPending(true);
    try {
      await recordDealerIntroductionAction(clientId, {
        dealerId: String(formData.get("dealerId") || "") || undefined,
        dealerName: String(formData.get("dealerName") || "") || undefined,
        introductionMethod: String(formData.get("introductionMethod") || "") || undefined,
        status: formData.get("status") as never,
        scheduledDate: String(formData.get("scheduledDate") || "") || undefined,
        remarks: String(formData.get("remarks") || "") || undefined,
      });
      toast.success("Dealer introduction updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update dealer introduction");
    } finally {
      setPending(false);
    }
  }

  return (
    <form action={handleSubmit}>
      {dealerIntroduction && (
        <Badge variant="outline" className="mb-3">
          Current: {dealerIntroduction.status}
        </Badge>
      )}
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="dealerName">
            Dealer Name <span className="text-destructive">(required)</span>
          </FieldLabel>
          <Input id="dealerName" name="dealerName" value={dealerName} onChange={(e) => setDealerName(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="dealerId">Dealer ID</FieldLabel>
          <Input id="dealerId" name="dealerId" defaultValue={dealerIntroduction?.dealerId ?? ""} />
        </Field>
        <Field>
          <FieldLabel htmlFor="introductionMethod">Method</FieldLabel>
          <Select name="introductionMethod" defaultValue={dealerIntroduction?.introductionMethod ?? "Phone"}>
            <SelectTrigger id="introductionMethod" className="w-full">
              <SelectValue>{(v: string) => v}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {["Phone", "WhatsApp", "In-person", "Video Call", "Other"].map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel>Status</FieldLabel>
          <Select name="status" defaultValue={dealerIntroduction?.status ?? "PENDING"}>
            <SelectTrigger className="w-full">
              <SelectValue>{(v: string) => v}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="PENDING">Pending</SelectItem>
              <SelectItem value="SCHEDULED">Scheduled</SelectItem>
              <SelectItem value="COMPLETED">Completed</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="scheduledDate">Scheduled Date</FieldLabel>
          <Input id="scheduledDate" name="scheduledDate" type="date" />
        </Field>
        <Field>
          <FieldLabel htmlFor="remarks">Remarks</FieldLabel>
          <Textarea id="remarks" name="remarks" rows={2} />
        </Field>
      </FieldGroup>
      <GateBlockerList messages={messages} />
      <Button type="submit" className="mt-4" disabled={pending || blocked}>
        {pending ? "Saving..." : "Save"}
      </Button>
    </form>
  );
}
