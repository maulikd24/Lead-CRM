"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { editPartnerProfileAction } from "./actions";
import type { PartnerProfile } from "@/generated/prisma/client";

export function EditPartnerProfileDialog({ profile }: { profile: Pick<PartnerProfile, "id" | "region" | "arnCode" | "euinCode"> }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  async function handleSubmit(formData: FormData) {
    setPending(true);
    try {
      await editPartnerProfileAction(profile.id, formData);
      toast.success("Partner profile updated");
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update profile");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>Edit Profile</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Partner Profile</DialogTitle>
        </DialogHeader>
        <form ref={formRef} action={handleSubmit} className="flex flex-col gap-4">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="edit-region">Region</FieldLabel>
              <Input id="edit-region" name="region" defaultValue={profile.region ?? ""} />
            </Field>
            <Field>
              <FieldLabel htmlFor="edit-arn">ARN Code</FieldLabel>
              <Input id="edit-arn" name="arnCode" defaultValue={profile.arnCode ?? ""} />
            </Field>
            <Field>
              <FieldLabel htmlFor="edit-euin">EUIN Code</FieldLabel>
              <Input id="edit-euin" name="euinCode" defaultValue={profile.euinCode ?? ""} />
            </Field>
            <Field>
              <FieldLabel htmlFor="edit-pan">PAN Number</FieldLabel>
              <Input id="edit-pan" name="panNumber" placeholder="Leave blank to keep unchanged" />
            </Field>
            <Field>
              <FieldLabel htmlFor="edit-gstin">GSTIN</FieldLabel>
              <Input id="edit-gstin" name="gstin" placeholder="Leave blank to keep unchanged" />
            </Field>
          </FieldGroup>
          <p className="text-xs text-muted-foreground">
            PAN and GSTIN are encrypted at rest and shown masked until revealed.
          </p>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
