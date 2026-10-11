"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { runReplayAction } from "./actions";

export function ReplayButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await runReplayAction();
            if (r.ok) router.refresh();
            else setError(r.error);
          })
        }
      >
        {pending ? "Replaying..." : "Run replay now"}
      </Button>
      <p className="text-xs text-muted-foreground">Runs the engine over up to 60 customers at 3 past dates. Read-only on customer data.</p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
