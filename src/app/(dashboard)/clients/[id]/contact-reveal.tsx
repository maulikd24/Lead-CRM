"use client";

import { useState, useTransition } from "react";
import { Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";

import { revealClientContactAction } from "./contact-actions";

/**
 * A masked contact value. The server sends only the masked text; for an Admin or the assigned RM there is a reveal button that
 * asks the server (which logs the access) and shows the raw value until it is hidden again.
 */
export function ContactValue({ clientId, field, masked, canReveal, empty = "—" }: { clientId: string; field: "mobile" | "email" | "ckycRef" | "pan"; masked: string | null; canReveal: boolean; empty?: string }) {
  const [raw, setRaw] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!masked) return <>{empty}</>;
  const reveal = () =>
    start(async () => {
      try {
        setRaw((await revealClientContactAction(clientId, field)).value);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not reveal this value");
      }
    });
  return (
    <span className="inline-flex items-center gap-1">
      <span>{raw ?? masked}</span>
      {canReveal && (
        <button
          type="button"
          onClick={raw ? () => setRaw(null) : reveal}
          disabled={pending}
          aria-label={raw ? `Hide ${field}` : `Show ${field} (this is logged)`}
          title={raw ? "Hide" : "Show (this is logged)"}
          className="rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {raw ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        </button>
      )}
    </span>
  );
}
