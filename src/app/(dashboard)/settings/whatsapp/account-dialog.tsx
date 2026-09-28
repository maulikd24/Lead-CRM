"use client";

import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { upsertWhatsAppAccountAction } from "./actions";

export type AccountFormValue = { id: string; label: string; sessionId: string; ownerUserId: string | null };
export type OwnerOption = { id: string; name: string };

export function AccountDialog({ account, owners }: { account?: AccountFormValue; owners: OwnerOption[] }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const editing = Boolean(account);

  async function handleSubmit(formData: FormData) {
    setPending(true);
    try {
      await upsertWhatsAppAccountAction(formData);
      toast.success(editing ? "Account updated" : "Account added");
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save account");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant={editing ? "outline" : "default"} />}>
        {editing ? <Pencil className="size-3.5" /> : <Plus className="size-3.5" />}
        {editing ? "Edit" : "Add account"}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Edit WhatsApp account" : "Add WhatsApp account"}</DialogTitle>
        </DialogHeader>
        <form action={handleSubmit} className="flex flex-col gap-4">
          {account && <input type="hidden" name="id" value={account.id} />}
          <Field>
            <FieldLabel htmlFor="wa-label">Label</FieldLabel>
            <Input id="wa-label" name="label" placeholder="RM 1" defaultValue={account?.label} required />
          </Field>
          <Field>
            <FieldLabel htmlFor="wa-session">Session ID</FieldLabel>
            <Input
              id="wa-session"
              name="sessionId"
              placeholder="rm_1"
              defaultValue={account?.sessionId}
              readOnly={editing}
              className={editing ? "bg-muted" : undefined}
              required
            />
            <p className="text-xs text-muted-foreground">
              Must match an entry in the worker&apos;s SESSION_IDS. {editing ? "Can't be changed after creation." : "Letters, numbers, - and _ only."}
            </p>
          </Field>
          <Field>
            <FieldLabel htmlFor="wa-owner">Owner (RM)</FieldLabel>
            <Select name="ownerUserId" defaultValue={account?.ownerUserId ?? "none"}>
              <SelectTrigger id="wa-owner" className="w-full">
                <SelectValue>{(v: string) => (v === "none" ? "No owner" : (owners.find((o) => o.id === v)?.name ?? "No owner"))}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No owner</SelectItem>
                {owners.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              New leads that message this number are assigned to this RM, and they can scan its QR code from their own Settings page.
            </p>
          </Field>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
