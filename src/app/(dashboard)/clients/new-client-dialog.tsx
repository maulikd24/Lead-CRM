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
import { LEAD_SOURCES, CLIENT_TYPES } from "@/lib/clients/options";
import { PAN_REGEX } from "@/lib/utils/normalize-contact";

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
  reason: "pan" | "ckycRef" | "mobile_or_email" | null;
  blocking: boolean;
};

export function NewClientDialog({ users }: { users: UserOption[] }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [duplicate, setDuplicate] = useState<DuplicateState | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  // React resets a form's uncontrolled fields once its `action` function returns, even when
  // that action didn't create anything (a detected duplicate). Capture the exact submitted
  // data here so "Create Anyway" retries with what the user typed, not the now-blanked form.
  const pendingFormDataRef = useRef<FormData | null>(null);

  async function handleSubmit(formData: FormData) {
    const pan = String(formData.get("pan") || "").trim().toUpperCase();
    if (!PAN_REGEX.test(pan)) {
      toast.error("Invalid PAN format (expected e.g. ABCDE1234F)");
      return;
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
                  : "CKYC reference already belongs to an existing client"
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
                required
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
              <Input id="referralSource" name="referralSource" />
            </Field>
            <Field>
              <FieldLabel htmlFor="notes">Notes</FieldLabel>
              <Textarea id="notes" name="notes" rows={2} />
            </Field>
          </FieldGroup>
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
