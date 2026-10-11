"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { setKillSwitchAction } from "./actions";

/** One button. Turning it on is for Admin and Marketing; turning it off again is an Admin's call (the server enforces it, this only hides the button). */
export function KillSwitch({ on, envOn, canTurnOff }: { on: boolean; envOn: boolean; canTurnOff: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (envOn) return <p className="text-muted-foreground">The kill switch is on in the server settings. Only the server owner can turn it off.</p>;
  if (on && !canTurnOff) return <p className="text-muted-foreground">Stopped. An Admin turns it back on.</p>;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        size="sm"
        variant={on ? "outline" : "destructive"}
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await setKillSwitchAction(!on);
            if (r.ok) toast.success(on ? "Sending resumed" : "Everything stopped");
            else setError(r.error);
          })
        }
      >
        {on ? "Resume sending" : "Stop everything now"}
      </Button>
      {error && <p role="alert" className="text-destructive">{error}</p>}
    </div>
  );
}
