"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { executeClientErasureAction } from "./actions";

/** Type-to-confirm, not a plain confirm click — this is the one point where an approved erasure
 * request actually becomes an irreversible delete. */
export function ExecuteErasureDialog({ erasureRequestId, clientName, clientCode }: { erasureRequestId: string; clientName: string; clientCode: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  async function handleExecute() {
    setPending(true);
    try {
      await executeClientErasureAction(erasureRequestId);
      toast.success("Client permanently deleted");
      setOpen(false);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to execute deletion");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) setConfirmText(""); }}>
      <DialogTrigger render={<Button size="sm" variant="destructive" />}>Execute Deletion</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Permanently Delete {clientName}?</DialogTitle>
          <DialogDescription>
            This cannot be undone. It refuses automatically if this client has any household, trading
            account, revenue, or advisory history — use Archive for those instead.
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="confirm-client-code">
            Type <span className="font-mono font-semibold">{clientCode}</span> to confirm
          </FieldLabel>
          <Input id="confirm-client-code" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" />
        </Field>
        <DialogFooter>
          <Button variant="destructive" disabled={pending || confirmText !== clientCode} onClick={handleExecute}>
            {pending ? "Deleting..." : "Permanently Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
