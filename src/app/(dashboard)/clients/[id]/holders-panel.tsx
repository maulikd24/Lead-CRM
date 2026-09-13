"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import type { Role } from "@/generated/prisma/client";
import { addHolderAction, updateHolderAction, removeHolderAction, type HolderInput } from "../holder-actions";
import { DocumentStatusList, type AccountHolderWithDocuments } from "./stage-action-card";

const HOLDER_FIELDS: { name: string; label: string; required?: boolean }[] = [
  { name: "name", label: "Full Name", required: true },
  { name: "mobile", label: "Mobile" },
  { name: "email", label: "Email" },
  { name: "pan", label: "PAN" },
  { name: "ckycRef", label: "CKYC Reference" },
  { name: "relationToFirstHolder", label: "Relation to First Holder" },
];

function AddHolderDialog({ clientId, position }: { clientId: string; position: "SECOND" | "THIRD" }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleSubmit(formData: FormData) {
    const input: HolderInput = {
      position,
      name: String(formData.get("name") || ""),
      mobile: String(formData.get("mobile") || ""),
      email: String(formData.get("email") || ""),
      pan: String(formData.get("pan") || ""),
      ckycRef: String(formData.get("ckycRef") || ""),
      relationToFirstHolder: String(formData.get("relationToFirstHolder") || ""),
    };
    setPending(true);
    try {
      await addHolderAction(clientId, input);
      toast.success(`${position === "SECOND" ? "Second" : "Third"} holder added`);
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to add holder");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        Add {position === "SECOND" ? "Second" : "Third"} Holder
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add {position === "SECOND" ? "Second" : "Third"} Holder</DialogTitle>
        </DialogHeader>
        <form action={handleSubmit} className="flex flex-col gap-4">
          <FieldGroup>
            {HOLDER_FIELDS.map((f) => (
              <Field key={f.name}>
                <FieldLabel htmlFor={`holder-${f.name}`}>{f.label}</FieldLabel>
                <Input id={`holder-${f.name}`} name={f.name} required={f.required} />
              </Field>
            ))}
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Adding..." : "Add Holder"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditHolderDialog({ holder }: { holder: AccountHolderWithDocuments }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleSubmit(formData: FormData) {
    setPending(true);
    try {
      await updateHolderAction(holder.id, {
        name: String(formData.get("name") || ""),
        mobile: String(formData.get("mobile") || ""),
        email: String(formData.get("email") || ""),
        pan: String(formData.get("pan") || ""),
        ckycRef: String(formData.get("ckycRef") || ""),
        relationToFirstHolder: String(formData.get("relationToFirstHolder") || ""),
      });
      toast.success("Holder updated");
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update holder");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>Edit</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Holder</DialogTitle>
        </DialogHeader>
        <form action={handleSubmit} className="flex flex-col gap-4">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="edit-holder-name">Full Name</FieldLabel>
              <Input id="edit-holder-name" name="name" defaultValue={holder.name} required />
            </Field>
            <Field>
              <FieldLabel htmlFor="edit-holder-mobile">Mobile</FieldLabel>
              <Input id="edit-holder-mobile" name="mobile" defaultValue={holder.mobile ?? ""} />
            </Field>
            <Field>
              <FieldLabel htmlFor="edit-holder-email">Email</FieldLabel>
              <Input id="edit-holder-email" name="email" defaultValue={holder.email ?? ""} />
            </Field>
            <Field>
              <FieldLabel htmlFor="edit-holder-pan">PAN</FieldLabel>
              <Input id="edit-holder-pan" name="pan" defaultValue={holder.pan ?? ""} />
            </Field>
            <Field>
              <FieldLabel htmlFor="edit-holder-ckycRef">CKYC Reference</FieldLabel>
              <Input id="edit-holder-ckycRef" name="ckycRef" defaultValue={holder.ckycRef ?? ""} />
            </Field>
            <Field>
              <FieldLabel htmlFor="edit-holder-relation">Relation to First Holder</FieldLabel>
              <Input id="edit-holder-relation" name="relationToFirstHolder" defaultValue={holder.relationToFirstHolder ?? ""} />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RemoveHolderButton({ holder }: { holder: AccountHolderWithDocuments }) {
  const [isPending, startTransition] = useTransition();

  function handleRemove() {
    startTransition(async () => {
      try {
        await removeHolderAction(holder.id);
        toast.success("Holder removed");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to remove holder");
      }
    });
  }

  return (
    <Button size="sm" variant="destructive" onClick={handleRemove} disabled={isPending}>
      Remove
    </Button>
  );
}

export function HoldersPanel({
  clientId,
  holders,
  currentUserRole,
}: {
  clientId: string;
  holders: AccountHolderWithDocuments[];
  currentUserRole: Role;
}) {
  const canRemove = currentUserRole === "ADMIN" || currentUserRole === "MANAGER";
  const takenPositions = new Set(holders.map((h) => h.position));
  const nextPosition: "SECOND" | "THIRD" | null = !takenPositions.has("SECOND")
    ? "SECOND"
    : !takenPositions.has("THIRD")
      ? "THIRD"
      : null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Joint Holders</CardTitle>
        {nextPosition && <AddHolderDialog clientId={clientId} position={nextPosition} />}
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {holders.length === 0 && (
          <p className="text-sm text-muted-foreground">
            This is a single-holder account. Add a Second Holder to make it joint.
          </p>
        )}
        {holders.map((holder) => (
          <div key={holder.id} className="flex flex-col gap-3 border-t pt-4 first:border-0 first:pt-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold">
                  {holder.position === "SECOND" ? "Second Holder" : "Third Holder"} — {holder.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {holder.relationToFirstHolder ?? "Relation not set"}
                  {holder.pan ? ` · PAN ${holder.pan}` : ""}
                  {holder.mobile ? ` · ${holder.mobile}` : ""}
                </p>
              </div>
              <div className="flex gap-2">
                <EditHolderDialog holder={holder} />
                {canRemove && <RemoveHolderButton holder={holder} />}
              </div>
            </div>
            <DocumentStatusList documents={holder.documents} clientId={clientId} holderId={holder.id} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
