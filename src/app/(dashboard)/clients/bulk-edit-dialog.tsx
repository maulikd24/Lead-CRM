"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { CLIENT_TYPES, LEAD_SOURCES, REFERRAL_SOURCES } from "@/lib/clients/options";
import { bulkUpdateClientFieldsAction, type BulkEditableClientFields } from "./actions";
import type { Priority } from "@/generated/prisma/client";

const PRIORITIES: Priority[] = ["LOW", "MEDIUM", "HIGH"];

/** One dialog with every field optional, not eleven toolbar dropdowns. Only a field the user
 * actually sets gets applied — a blank field is left untouched on every selected client. */
export function BulkEditDialog({ selectedCount, clientIds, onDone }: { selectedCount: number; clientIds: string[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  async function handleSubmit(formData: FormData) {
    const fields: BulkEditableClientFields = {};
    for (const key of [
      "region",
      "city",
      "state",
      "preferredLanguage",
      "clientType",
      "leadSource",
      "productInterest",
      "existingBroker",
      "tradingExperience",
      "referralSource",
    ] as const) {
      const value = String(formData.get(key) ?? "").trim();
      if (value) fields[key] = value;
    }
    const priority = String(formData.get("priority") ?? "");
    if (priority) fields.priority = priority as Priority;

    if (Object.keys(fields).length === 0) {
      toast.error("Set at least one field to update");
      return;
    }

    setPending(true);
    try {
      const { updated } = await bulkUpdateClientFieldsAction(clientIds, fields);
      toast.success(`${updated.length} client(s) updated`);
      setOpen(false);
      formRef.current?.reset();
      onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update clients");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>Bulk Edit ({selectedCount})</DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Bulk Edit {selectedCount} Client(s)</DialogTitle>
          <DialogDescription>Leave a field blank to leave it unchanged on every selected client.</DialogDescription>
        </DialogHeader>
        <form ref={formRef} action={handleSubmit} className="flex flex-col gap-4">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="bulk-priority">Priority</FieldLabel>
              <Select name="priority" defaultValue="">
                <SelectTrigger id="bulk-priority" className="w-full">
                  <SelectValue placeholder="No change">{(v: string) => v || "No change"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="bulk-region">Region</FieldLabel>
              <Input id="bulk-region" name="region" placeholder="Leave blank for no change" />
            </Field>
            <Field>
              <FieldLabel htmlFor="bulk-city">City</FieldLabel>
              <Input id="bulk-city" name="city" placeholder="Leave blank for no change" />
            </Field>
            <Field>
              <FieldLabel htmlFor="bulk-state">State</FieldLabel>
              <Input id="bulk-state" name="state" placeholder="Leave blank for no change" />
            </Field>
            <Field>
              <FieldLabel htmlFor="bulk-preferredLanguage">Preferred Language</FieldLabel>
              <Input id="bulk-preferredLanguage" name="preferredLanguage" placeholder="Leave blank for no change" />
            </Field>
            <Field>
              <FieldLabel htmlFor="bulk-clientType">Client Type</FieldLabel>
              <Select name="clientType" defaultValue="">
                <SelectTrigger id="bulk-clientType" className="w-full">
                  <SelectValue placeholder="No change">{(v: string) => v || "No change"}</SelectValue>
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
              <FieldLabel htmlFor="bulk-leadSource">Lead Source</FieldLabel>
              <Select name="leadSource" defaultValue="">
                <SelectTrigger id="bulk-leadSource" className="w-full">
                  <SelectValue placeholder="No change">{(v: string) => v || "No change"}</SelectValue>
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
              <FieldLabel htmlFor="bulk-referralSource">Referral Source</FieldLabel>
              <Select name="referralSource" defaultValue="">
                <SelectTrigger id="bulk-referralSource" className="w-full">
                  <SelectValue placeholder="No change">{(v: string) => v || "No change"}</SelectValue>
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
            <Field>
              <FieldLabel htmlFor="bulk-productInterest">Product Interest</FieldLabel>
              <Input id="bulk-productInterest" name="productInterest" placeholder="Leave blank for no change" />
            </Field>
            <Field>
              <FieldLabel htmlFor="bulk-existingBroker">Existing Broker</FieldLabel>
              <Input id="bulk-existingBroker" name="existingBroker" placeholder="Leave blank for no change" />
            </Field>
            <Field>
              <FieldLabel htmlFor="bulk-tradingExperience">Trading Experience</FieldLabel>
              <Input id="bulk-tradingExperience" name="tradingExperience" placeholder="Leave blank for no change" />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Updating..." : `Update ${selectedCount} Client(s)`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
