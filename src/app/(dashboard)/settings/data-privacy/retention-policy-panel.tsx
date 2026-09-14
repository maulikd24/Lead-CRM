"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { createRetentionPolicyAction, togglePolicyActiveAction } from "./actions";
import type { DataRetentionPolicy } from "@/generated/prisma/client";

const RETENTION_ACTIONS = ["ARCHIVE", "ANONYMIZE", "DELETE"] as const;

export function RetentionPolicyPanel({ policies }: { policies: DataRetentionPolicy[] }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  async function handleSubmit(formData: FormData) {
    try {
      await createRetentionPolicyAction(formData);
      toast.success("Retention policy created");
      setOpen(false);
      formRef.current?.reset();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create policy");
    }
  }

  function handleToggle(id: string, isActive: boolean) {
    startTransition(async () => {
      try {
        await togglePolicyActiveAction(id, isActive);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to update policy");
      }
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Data Retention Policies</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger render={<Button size="sm" variant="outline" />}>New Policy</DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Retention Policy</DialogTitle>
            </DialogHeader>
            <form ref={formRef} action={handleSubmit} className="flex flex-col gap-4">
              <Field>
                <FieldLabel htmlFor="policy-entity">Entity</FieldLabel>
                <Input id="policy-entity" name="entity" placeholder="e.g. Client, PartnerProfile" required />
              </Field>
              <Field>
                <FieldLabel htmlFor="policy-days">Retention Days</FieldLabel>
                <Input id="policy-days" name="retentionDays" type="number" min={1} required />
              </Field>
              <Field>
                <FieldLabel htmlFor="policy-action">Action</FieldLabel>
                <Select name="action" defaultValue="ARCHIVE">
                  <SelectTrigger id="policy-action" className="w-full">
                    <SelectValue>{(v: string) => v}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {RETENTION_ACTIONS.map((a) => (
                      <SelectItem key={a} value={a}>
                        {a}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <DialogFooter>
                <Button type="submit">Create Policy</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Entity</TableHead>
              <TableHead>Retention</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody striped>
            {policies.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="text-sm">{p.entity}</TableCell>
                <TableCell className="text-sm">{p.retentionDays} days</TableCell>
                <TableCell>
                  <Badge variant="outline">{p.action}</Badge>
                </TableCell>
                <TableCell>
                  <Badge variant={p.isActive ? "success" : "outline"}>{p.isActive ? "Active" : "Inactive"}</Badge>
                </TableCell>
                <TableCell>
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => handleToggle(p.id, !p.isActive)}>
                    {p.isActive ? "Deactivate" : "Activate"}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {policies.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  No retention policies defined.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
