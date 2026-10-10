"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";

import { setAiDrafterAction } from "./social-actions";

/** The AI drafter's own on/off (Admin only), on top of the SOCIAL_DRAFTS_ENABLED server flag. */
export function AiSwitch({ on }: { on: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-1">
      <Button size="sm" variant="outline" disabled={pending} aria-pressed={on} onClick={() => start(async () => {
        const r = await setAiDrafterAction(!on).catch(() => ({ ok: false as const, error: "Could not change the setting." }));
        if (!r.ok) setError(r.error);
        else router.refresh();
      })}>{on ? "Turn AI drafting off" : "Turn AI drafting on"}</Button>
      {error && <p role="status" className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
