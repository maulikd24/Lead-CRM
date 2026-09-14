"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import { formatDateTime } from "@/lib/utils/format";
import { createErasureRequestAction } from "./actions";
import type { ErasureRequest, User } from "@/generated/prisma/client";

type ErasureWithRequester = ErasureRequest & { requestedBy: Pick<User, "name"> };

export function ErasureQueuePanel({ requests }: { requests: ErasureWithRequester[] }) {
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  async function handleSubmit(formData: FormData) {
    try {
      await createErasureRequestAction(formData);
      toast.success("Erasure request submitted for approval");
      setOpen(false);
      formRef.current?.reset();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to submit request");
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Right-to-Erasure Requests</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger render={<Button size="sm" variant="outline" />}>New Request</DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Erasure Request</DialogTitle>
            </DialogHeader>
            <form ref={formRef} action={handleSubmit} className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">
                Submits for Admin approval — approving only clears it to proceed. It does not
                automatically delete or anonymize any data.
              </p>
              <Field>
                <FieldLabel htmlFor="erasure-subject-type">Subject Type</FieldLabel>
                <Select name="subjectType" defaultValue="Client">
                  <SelectTrigger id="erasure-subject-type" className="w-full">
                    <SelectValue>{(v: string) => v}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Client">Client</SelectItem>
                    <SelectItem value="PartnerProfile">PartnerProfile</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="erasure-subject-id">Subject ID</FieldLabel>
                <Input id="erasure-subject-id" name="subjectId" required />
              </Field>
              <Field>
                <FieldLabel htmlFor="erasure-notes">Notes (optional)</FieldLabel>
                <Textarea id="erasure-notes" name="notes" rows={2} />
              </Field>
              <DialogFooter>
                <Button type="submit">Submit for Approval</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Subject</TableHead>
              <TableHead>Requested By</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Requested At</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody striped>
            {requests.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="text-sm">
                  {r.subjectType} <span className="font-mono text-xs text-muted-foreground">{r.subjectId}</span>
                </TableCell>
                <TableCell className="text-sm">{r.requestedBy.name}</TableCell>
                <TableCell>
                  <Badge variant={r.status === "COMPLETED" ? "success" : r.status === "REJECTED" ? "destructive" : "outline"}>
                    {r.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{formatDateTime(r.requestedAt)}</TableCell>
              </TableRow>
            ))}
            {requests.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                  No erasure requests.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
