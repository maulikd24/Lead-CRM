"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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

type FullClient = Omit<Client, "expectedInvestment"> & {
  expectedInvestment: number | null;
  currentStage: Stage;
  documents: Document[];
  kycRecord: KycRecord | null;
  fundingRecord: (Omit<FundingRecord, "amount"> & { amount: number | null }) | null;
  dealerIntroduction: DealerIntroduction | null;
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

export function StageActionCard({ client, canOverride }: { client: FullClient; canOverride: boolean }) {
  const stageName = client.currentStage.name;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Current Stage: {stageName}</CardTitle>
        <CardDescription>Complete this step to move the client forward.</CardDescription>
      </CardHeader>
      <CardContent>
        {stageName === "Lead Created" && <RmContactForm clientId={client.id} />}
        {stageName === "RM Reaches Out" && <StartDocumentsForm clientId={client.id} />}
        {stageName === "Documents Collected" && (
          <DocumentChecklist clientId={client.id} documents={client.documents} canOverride={canOverride} />
        )}
        {stageName === "Documents Submitted for KYC" && (
          <KycCompletionForm clientId={client.id} kycRecord={client.kycRecord} />
        )}
        {stageName === "KYC Completed" && <FundingForm clientId={client.id} fundingRecord={client.fundingRecord} />}
        {stageName === "Funds Added" && (
          <DealerIntroForm clientId={client.id} dealerIntroduction={client.dealerIntroduction} />
        )}
        {stageName === "Introduced with Dealer" && (
          <DealerIntroForm clientId={client.id} dealerIntroduction={client.dealerIntroduction} />
        )}
        {stageName === "Completed" && (
          <p className="text-sm text-muted-foreground">
            Onboarding completed{client.completedAt ? ` on ${formatDateTime(client.completedAt)}` : ""}.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function RmContactForm({ clientId }: { clientId: string }) {
  const [outcome, setOutcome] = useState(CONTACT_OUTCOMES[0]);
  const requiresNotes = ["Not interested", "Unreachable", "Wrong number"].includes(outcome);
  const requiresNextAction = ["Call back requested", "Interested"].includes(outcome);

  async function handleSubmit(formData: FormData) {
    try {
      await recordRmContactAction(clientId, {
        contactMethod: formData.get("contactMethod") as never,
        contactOutcome: outcome as never,
        notes: String(formData.get("notes") || "") || undefined,
        nextAction: String(formData.get("nextAction") || "") || undefined,
        nextActionDate: String(formData.get("nextActionDate") || "") || undefined,
      });
      toast.success("Contact recorded — moved to RM Reaches Out");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to record contact");
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
      <Button type="submit" className="mt-4">
        Record Contact
      </Button>
    </form>
  );
}

function StartDocumentsForm({ clientId }: { clientId: string }) {
  async function handleClick() {
    try {
      await startDocumentCollectionAction(clientId);
      toast.success("Started document collection");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to start document collection");
    }
  }
  return (
    <Button onClick={handleClick}>Start Document Collection</Button>
  );
}

function DocumentChecklist({
  clientId,
  documents,
  canOverride,
}: {
  clientId: string;
  documents: Document[];
  canOverride: boolean;
}) {
  const [override, setOverride] = useState(false);

  async function handleStatusChange(documentId: string, status: string) {
    try {
      await updateDocumentStatusAction(documentId, { status: status as never });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update document");
    }
  }

  async function handleSubmitForKyc(formData: FormData) {
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
    }
  }

  const mandatoryIncomplete = documents.filter(
    (d) => d.mandatory && d.status !== "VERIFIED" && d.status !== "NOT_APPLICABLE",
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        {documents.map((doc) => (
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

      <form action={handleSubmitForKyc} className="flex flex-col gap-3 border-t pt-4">
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
        {mandatoryIncomplete.length > 0 && (
          <p className="text-xs text-destructive">
            Mandatory incomplete: {mandatoryIncomplete.map((d) => d.documentType).join(", ")}
          </p>
        )}
        {mandatoryIncomplete.length > 0 && canOverride && (
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
            Override incomplete mandatory documents
          </label>
        )}
        <Button type="submit" disabled={mandatoryIncomplete.length > 0 && !override}>
          Submit for KYC
        </Button>
      </form>
    </div>
  );
}

function KycCompletionForm({ clientId, kycRecord }: { clientId: string; kycRecord: KycRecord | null }) {
  const [status, setStatus] = useState("APPROVED");

  async function handleSubmit(formData: FormData) {
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
            <Textarea id="rejectionReason" name="rejectionReason" rows={2} required />
          </Field>
        )}
        <Field>
          <FieldLabel htmlFor="remarks">Remarks</FieldLabel>
          <Textarea id="remarks" name="remarks" rows={2} />
        </Field>
      </FieldGroup>
      <Button type="submit" className="mt-4">
        Save
      </Button>
    </form>
  );
}

function FundingForm({
  clientId,
  fundingRecord,
}: {
  clientId: string;
  fundingRecord: (Omit<FundingRecord, "amount"> & { amount: number | null }) | null;
}) {
  async function handleSubmit(formData: FormData) {
    try {
      await updateFundingAction(clientId, {
        status: formData.get("status") as never,
        amount: formData.get("amount") ? Number(formData.get("amount")) : undefined,
        fundingDate: String(formData.get("fundingDate") || "") || undefined,
        fundingMethod: String(formData.get("fundingMethod") || "") || undefined,
        referenceNumber: String(formData.get("referenceNumber") || "") || undefined,
        remarks: String(formData.get("remarks") || "") || undefined,
      });
      toast.success("Funding updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update funding");
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
          <Select name="status" defaultValue={fundingRecord?.status ?? "PENDING"}>
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
          <FieldLabel htmlFor="amount">Amount</FieldLabel>
          <Input id="amount" name="amount" type="number" step="0.01" />
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
          <FieldLabel htmlFor="remarks">Remarks</FieldLabel>
          <Textarea id="remarks" name="remarks" rows={2} />
        </Field>
      </FieldGroup>
      <Button type="submit" className="mt-4">
        Save
      </Button>
    </form>
  );
}

function DealerIntroForm({
  clientId,
  dealerIntroduction,
}: {
  clientId: string;
  dealerIntroduction: DealerIntroduction | null;
}) {
  async function handleSubmit(formData: FormData) {
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
          <FieldLabel htmlFor="dealerName">Dealer Name</FieldLabel>
          <Input id="dealerName" name="dealerName" defaultValue={dealerIntroduction?.dealerName ?? ""} />
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
      <Button type="submit" className="mt-4">
        Save
      </Button>
    </form>
  );
}
