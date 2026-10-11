"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { retryOutboxRowAction } from "./actions";

export function RetryButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      size="xs"
      variant="outline"
      className="ml-2"
      disabled={pending}
      onClick={() => start(async () => { const r = await retryOutboxRowAction(id); if (r.ok) toast.success("Queued again"); else toast.error(r.error); })}
    >
      Retry
    </Button>
  );
}
