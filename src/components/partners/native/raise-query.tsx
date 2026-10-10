"use client";

import { useState, useTransition } from "react";
import { MessageSquareWarning } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { raiseStatementQueryAction } from "@/app/(dashboard)/partners/statements/actions";
import { MAX_QUERY_MESSAGE } from "@/lib/partners/statement-query";

/** "Raise a query" on one statement line: a short message that lands on Finance as a task. */
export function RaiseQuery({ partnerId, period, lineRef, label }: { partnerId: string; period: string; lineRef: string; label: string }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await raiseStatementQueryAction({ partnerId, period, lineRef, message });
      if (r.ok) {
        toast.success(r.duplicate ? "You already have an open query on this line. Finance has it." : "Your query has gone to Finance.");
        setOpen(false);
        setMessage("");
      } else setError(r.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button type="button" size="sm" variant="ghost" aria-label={`Raise a query about ${label}`} />}>
        <MessageSquareWarning /> <span className="max-sm:sr-only">Query</span>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Raise a query</DialogTitle>
            <DialogDescription>About {label}. Finance will see this as a task and answer you.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`q-${lineRef}`}>What looks wrong?</Label>
            <Textarea id={`q-${lineRef}`} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={MAX_QUERY_MESSAGE} rows={4} required />
            <p className="text-xs text-muted-foreground">{message.length} of {MAX_QUERY_MESSAGE}</p>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={pending || message.trim().length < 5}>Send to Finance</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
