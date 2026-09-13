"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Pencil } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { updateClientAction } from "../actions";
import { LEAD_SOURCES, CLIENT_TYPES } from "@/lib/clients/options";
import { PAN_REGEX } from "@/lib/utils/normalize-contact";

type EditableClient = {
  id: string;
  name: string;
  mobile: string;
  email: string | null;
  pan: string | null;
  ckycRef: string | null;
  region: string | null;
  preferredLanguage: string | null;
  city: string | null;
  state: string | null;
  clientType: string | null;
  leadSource: string | null;
  productInterest: string | null;
  existingBroker: string | null;
  tradingExperience: string | null;
  expectedInvestment: number | null;
  referralSource: string | null;
  notes: string | null;
  priority: "LOW" | "MEDIUM" | "HIGH";
  operatingInstruction: "JOINTLY" | "EITHER_OR_SURVIVOR" | "ANYONE_OR_SURVIVOR" | null;
  accountHolders: { id: string }[];
};

type DuplicateInfo = {
  id: string;
  name: string;
  clientCode: string;
  mobile: string;
  email: string | null;
  pan: string | null;
};
type DuplicateState = {
  duplicate: DuplicateInfo;
  reason: "pan" | "ckycRef" | "mobile" | "email" | null;
  blocking: boolean;
};

export function EditClientDialog({ client }: { client: EditableClient }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [duplicate, setDuplicate] = useState<DuplicateState | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const pendingFormDataRef = useRef<FormData | null>(null);

  async function handleSubmit(formData: FormData) {
    const pan = String(formData.get("pan") || "").trim().toUpperCase();
    if (pan && !PAN_REGEX.test(pan)) {
      toast.error("Invalid PAN format (expected e.g. ABCDE1234F)");
      return;
    }

    setPending(true);
    try {
      const result = await updateClientAction(client.id, formData);
      if (result.status === "duplicate") {
        if (result.duplicate) {
          pendingFormDataRef.current = formData;
          setDuplicate({ duplicate: result.duplicate, reason: result.reason, blocking: result.blocking });
        }
        return;
      }
      toast.success("Client updated");
      setOpen(false);
      setDuplicate(null);
      pendingFormDataRef.current = null;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update client");
    } finally {
      setPending(false);
    }
  }

  async function handleSaveAnyway() {
    if (!pendingFormDataRef.current) return;
    const formData = pendingFormDataRef.current;
    formData.set("allowDuplicate", "true");
    setPending(true);
    try {
      await updateClientAction(client.id, formData);
      toast.success("Client updated");
      setOpen(false);
      setDuplicate(null);
      pendingFormDataRef.current = null;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update client");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setDuplicate(null);
          pendingFormDataRef.current = null;
        }
      }}
    >
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        <Pencil className="size-4" />
        Edit
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Client</DialogTitle>
        </DialogHeader>

        {duplicate && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <p className="font-medium">
              {duplicate.blocking
                ? duplicate.reason === "pan"
                  ? "PAN already belongs to an existing client"
                  : duplicate.reason === "ckycRef"
                    ? "CKYC reference already belongs to an existing client"
                    : "Mobile number already belongs to an existing client"
                : "A matching active client already exists"}
            </p>
            <p className="text-muted-foreground mt-1">
              <Link href={`/clients/${duplicate.duplicate.id}`} className="underline">
                {duplicate.duplicate.name} ({duplicate.duplicate.clientCode})
              </Link>{" "}
              — {duplicate.duplicate.mobile}
              {duplicate.duplicate.email ? ` · ${duplicate.duplicate.email}` : ""}
              {duplicate.duplicate.pan ? ` · PAN ${duplicate.duplicate.pan}` : ""}
            </p>
            {duplicate.blocking ? (
              <Button size="sm" variant="outline" className="mt-2" render={<Link href={`/clients/${duplicate.duplicate.id}`} />}>
                View existing client
              </Button>
            ) : (
              <Button size="sm" variant="outline" className="mt-2" onClick={handleSaveAnyway} disabled={pending}>
                Save Anyway
              </Button>
            )}
          </div>
        )}

        <form ref={formRef} action={handleSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="edit-name">Full Name</FieldLabel>
              <Input id="edit-name" name="name" defaultValue={client.name} required />
            </Field>
            <Field>
              <FieldLabel htmlFor="edit-mobile">Mobile</FieldLabel>
              <Input id="edit-mobile" name="mobile" defaultValue={client.mobile} required />
            </Field>
            <Field>
              <FieldLabel htmlFor="edit-email">Email</FieldLabel>
              <Input id="edit-email" name="email" type="email" defaultValue={client.email ?? ""} />
            </Field>
            <Field>
              <FieldLabel htmlFor="edit-pan">PAN</FieldLabel>
              <Input
                id="edit-pan"
                name="pan"
                maxLength={10}
                placeholder="ABCDE1234F"
                className="uppercase"
                defaultValue={client.pan ?? ""}
                onChange={(e) => { e.target.value = e.target.value.toUpperCase(); }}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="edit-ckycRef">CKYC Reference</FieldLabel>
              <Input id="edit-ckycRef" name="ckycRef" defaultValue={client.ckycRef ?? ""} />
            </Field>
            <Field>
              <FieldLabel htmlFor="edit-region">Region</FieldLabel>
              <Input id="edit-region" name="region" defaultValue={client.region ?? ""} />
            </Field>
            <Field>
              <FieldLabel htmlFor="edit-preferredLanguage">Preferred Language</FieldLabel>
              <Input id="edit-preferredLanguage" name="preferredLanguage" defaultValue={client.preferredLanguage ?? ""} />
            </Field>
            <Field>
              <FieldLabel htmlFor="edit-city">City</FieldLabel>
              <Input id="edit-city" name="city" defaultValue={client.city ?? ""} />
            </Field>
            <Field>
              <FieldLabel htmlFor="edit-state">State</FieldLabel>
              <Input id="edit-state" name="state" defaultValue={client.state ?? ""} />
            </Field>
            <Field>
              <FieldLabel htmlFor="edit-leadSource">Lead Source</FieldLabel>
              <Select name="leadSource" defaultValue={client.leadSource ?? undefined}>
                <SelectTrigger id="edit-leadSource" className="w-full">
                  <SelectValue placeholder="Select lead source">{(v: string) => v || "Select lead source"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {LEAD_SOURCES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="edit-clientType">Client Type</FieldLabel>
              <Select name="clientType" defaultValue={client.clientType ?? undefined}>
                <SelectTrigger id="edit-clientType" className="w-full">
                  <SelectValue placeholder="Select client type">{(v: string) => v || "Select client type"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {CLIENT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="edit-priority">Priority</FieldLabel>
              <Select name="priority" defaultValue={client.priority}>
                <SelectTrigger id="edit-priority" className="w-full">
                  <SelectValue>{(v: string) => v}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {["LOW", "MEDIUM", "HIGH"].map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="edit-productInterest">Product Interest</FieldLabel>
              <Input id="edit-productInterest" name="productInterest" defaultValue={client.productInterest ?? ""} />
            </Field>
            <Field>
              <FieldLabel htmlFor="edit-existingBroker">Existing Broker</FieldLabel>
              <Input id="edit-existingBroker" name="existingBroker" defaultValue={client.existingBroker ?? ""} />
            </Field>
            <Field>
              <FieldLabel htmlFor="edit-tradingExperience">Trading Experience</FieldLabel>
              <Input id="edit-tradingExperience" name="tradingExperience" defaultValue={client.tradingExperience ?? ""} />
            </Field>
            <Field>
              <FieldLabel htmlFor="edit-expectedInvestment">Expected Investment</FieldLabel>
              <Input
                id="edit-expectedInvestment"
                name="expectedInvestment"
                type="number"
                defaultValue={client.expectedInvestment ?? ""}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="edit-referralSource">Referral Source</FieldLabel>
              <Input id="edit-referralSource" name="referralSource" defaultValue={client.referralSource ?? ""} />
            </Field>
            <Field>
              <FieldLabel htmlFor="edit-notes">Notes</FieldLabel>
              <Textarea id="edit-notes" name="notes" rows={2} defaultValue={client.notes ?? ""} />
            </Field>
            {client.accountHolders.length > 0 && (
              <Field>
                <FieldLabel htmlFor="edit-operatingInstruction">Operating Instruction</FieldLabel>
                <Select name="operatingInstruction" defaultValue={client.operatingInstruction ?? undefined}>
                  <SelectTrigger id="edit-operatingInstruction" className="w-full">
                    <SelectValue placeholder="Select operating instruction">{(v: string) => v.replace(/_/g, " ")}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {["JOINTLY", "EITHER_OR_SURVIVOR", "ANYONE_OR_SURVIVOR"].map((o) => (
                      <SelectItem key={o} value={o}>
                        {o.replace(/_/g, " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          </FieldGroup>
          <DialogFooter className="mt-4">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
