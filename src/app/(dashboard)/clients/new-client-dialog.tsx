"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
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
import { createClientAction } from "./actions";
import { LEAD_SOURCES, CLIENT_TYPES, REFERRAL_SOURCES } from "@/lib/clients/options";
import { PAN_REGEX } from "@/lib/utils/normalize-contact";
import type { HolderInput } from "./holder-actions";

type UserOption = { id: string; name: string };
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

export function NewClientDialog({ users }: { users: UserOption[] }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [duplicate, setDuplicate] = useState<DuplicateState | null>(null);
  const [holders, setHolders] = useState<HolderInput[]>([]);
  const [referralChoice, setReferralChoice] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  function addHolderRow() {
    if (holders.length >= 2) return;
    const position = holders.length === 0 ? "SECOND" : "THIRD";
    setHolders((prev) => [...prev, { position, name: "", mobile: "", email: "", pan: "", relationToFirstHolder: "" }]);
  }

  function updateHolderRow(index: number, field: keyof HolderInput, value: string) {
    setHolders((prev) => prev.map((h, i) => (i === index ? { ...h, [field]: value } : h)));
  }

  function removeHolderRow(index: number) {
    setHolders((prev) => prev.filter((_, i) => i !== index));
  }
  // React resets a form's uncontrolled fields once its `action` function returns, even when
  // that action didn't create anything (a detected duplicate). Capture the exact submitted
  // data here so "Create Anyway" retries with what the user typed, not the now-blanked form.
  const pendingFormDataRef = useRef<FormData | null>(null);

  async function handleSubmit(formData: FormData) {
    const pan = String(formData.get("pan") || "").trim().toUpperCase();
    if (pan && !PAN_REGEX.test(pan)) {
      toast.error("Invalid PAN format (expected e.g. ABCDE1234F)");
      return;
    }
    if (holders.some((h) => !h.name.trim())) {
      toast.error("Every joint holder needs a name");
      return;
    }

    formData.set("holdersJson", JSON.stringify(holders));
    if (formData.get("referralSource") === "Other") {
      formData.set("referralSource", String(formData.get("referralSourceOther") || ""));
    }

    setPending(true);
    try {
      const result = await createClientAction(formData);
      if (result.status === "duplicate") {
        if (result.duplicate) {
          pendingFormDataRef.current = formData;
          setDuplicate({ duplicate: result.duplicate, reason: result.reason, blocking: result.blocking });
        }
        return;
      }
      toast.success(result.unassigned ? "Client created — no eligible RM, left unassigned" : "Client created");
      setOpen(false);
      setDuplicate(null);
      pendingFormDataRef.current = null;
      formRef.current?.reset();
      setHolders([]);
      setReferralChoice("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create client");
    } finally {
      setPending(false);
    }
  }

  async function handleCreateAnyway() {
    if (!pendingFormDataRef.current) return;
    const formData = pendingFormDataRef.current;
    formData.set("allowDuplicate", "true");
    setPending(true);
    try {
      await createClientAction(formData);
      toast.success("Client created");
      setOpen(false);
      setDuplicate(null);
      pendingFormDataRef.current = null;
      formRef.current?.reset();
      setHolders([]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create client");
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
          setHolders([]);
          setReferralChoice("");
        }
      }}
    >
      <DialogTrigger render={<Button size="sm" />}>
        <Plus className="size-4" />
        New Client
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New Client</DialogTitle>
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
              <Button size="sm" variant="outline" className="mt-2" onClick={handleCreateAnyway} disabled={pending}>
                Create Anyway
              </Button>
            )}
          </div>
        )}

        <form ref={formRef} action={handleSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="name">Full Name</FieldLabel>
              <Input id="name" name="name" required />
            </Field>
            <Field>
              <FieldLabel htmlFor="mobile">Mobile</FieldLabel>
              <Input id="mobile" name="mobile" required />
            </Field>
            <Field>
              <FieldLabel htmlFor="email">Email</FieldLabel>
              <Input id="email" name="email" type="email" />
            </Field>
            <Field>
              <FieldLabel htmlFor="pan">PAN</FieldLabel>
              <Input
                id="pan"
                name="pan"
                maxLength={10}
                placeholder="ABCDE1234F"
                className="uppercase"
                onChange={(e) => { e.target.value = e.target.value.toUpperCase(); }}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="ckycRef">CKYC Reference</FieldLabel>
              <Input id="ckycRef" name="ckycRef" placeholder="Optional" />
            </Field>
            <Field>
              <FieldLabel htmlFor="region">Region</FieldLabel>
              <Input id="region" name="region" placeholder="Optional — used for RM routing" />
            </Field>
            <Field>
              <FieldLabel htmlFor="preferredLanguage">Preferred Language</FieldLabel>
              <Input id="preferredLanguage" name="preferredLanguage" placeholder="Optional — used for RM routing" />
            </Field>
            <Field>
              <FieldLabel htmlFor="leadSource">Lead Source</FieldLabel>
              <Select name="leadSource">
                <SelectTrigger id="leadSource" className="w-full">
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
              <FieldLabel htmlFor="clientType">Client Type</FieldLabel>
              <Select name="clientType">
                <SelectTrigger id="clientType" className="w-full">
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
              <FieldLabel htmlFor="assignedToId">Assigned RM</FieldLabel>
              <Select name="assignedToId">
                <SelectTrigger id="assignedToId" className="w-full">
                  <SelectValue placeholder="Auto-assign (routing engine)">
                    {(value: string) => users.find((u) => u.id === value)?.name ?? "Auto-assign (routing engine)"}
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
            <Field>
              <FieldLabel htmlFor="referralSource">Referral Source</FieldLabel>
              <Select name="referralSource" value={referralChoice} onValueChange={(v) => v && setReferralChoice(v)}>
                <SelectTrigger id="referralSource" className="w-full">
                  <SelectValue placeholder="Select referral source">{(v: string) => v || "Select referral source"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {REFERRAL_SOURCES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {referralChoice === "Other" && (
              <Field>
                <FieldLabel htmlFor="referralSourceOther">Other Referral Source</FieldLabel>
                <Input id="referralSourceOther" name="referralSourceOther" placeholder="Enter referral source" />
              </Field>
            )}
            <Field>
              <FieldLabel htmlFor="notes">Notes</FieldLabel>
              <Textarea id="notes" name="notes" rows={2} />
            </Field>
          </FieldGroup>

          <div className="mt-4 flex flex-col gap-3 border-t pt-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Joint Holders (optional)</p>
              <Button type="button" size="sm" variant="outline" onClick={addHolderRow} disabled={holders.length >= 2}>
                Add Holder
              </Button>
            </div>
            {holders.map((holder, index) => (
              <div key={index} className="flex flex-col gap-2 rounded-lg border p-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-muted-foreground">
                    {holder.position === "SECOND" ? "Second Holder" : "Third Holder"}
                  </p>
                  <Button type="button" size="sm" variant="ghost" onClick={() => removeHolderRow(index)}>
                    Remove
                  </Button>
                </div>
                <Input
                  placeholder="Full Name"
                  value={holder.name}
                  onChange={(e) => updateHolderRow(index, "name", e.target.value)}
                  required
                />
                <Input
                  placeholder="Mobile (optional)"
                  value={holder.mobile}
                  onChange={(e) => updateHolderRow(index, "mobile", e.target.value)}
                />
                <Input
                  placeholder="Email (optional)"
                  value={holder.email}
                  onChange={(e) => updateHolderRow(index, "email", e.target.value)}
                />
                <Input
                  placeholder="PAN (optional)"
                  value={holder.pan}
                  className="uppercase"
                  onChange={(e) => updateHolderRow(index, "pan", e.target.value.toUpperCase())}
                />
                <Input
                  placeholder="Relation to First Holder (e.g. Spouse)"
                  value={holder.relationToFirstHolder}
                  onChange={(e) => updateHolderRow(index, "relationToFirstHolder", e.target.value)}
                />
              </div>
            ))}
            {holders.length > 0 && (
              <Field>
                <FieldLabel htmlFor="operatingInstruction">Operating Instruction</FieldLabel>
                <Select name="operatingInstruction" defaultValue="ANYONE_OR_SURVIVOR">
                  <SelectTrigger id="operatingInstruction" className="w-full">
                    <SelectValue>{(v: string) => v.replace(/_/g, " ")}</SelectValue>
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
          </div>

          <DialogFooter className="mt-4">
            <Button type="submit" disabled={pending}>
              {pending ? "Creating..." : "Create Client"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
