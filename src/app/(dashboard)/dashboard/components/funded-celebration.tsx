"use client";

import { useEffect } from "react";
import { toast } from "sonner";

import { fireConfetti } from "@/components/motion/confetti";
import { OWN_COMPLETION_EVENT, type OwnCompletionDetail } from "@/components/motion/own-completion";
import { shouldCelebrateOwn } from "@/lib/dashboard/live-funnel";

/** When this page session started. Completions from before this moment (including login) never celebrate. */
const SESSION_START_MS = Date.now();
/** Ids celebrated in this session only (in memory, never persisted). */
const celebrated = new Set<string>();

/**
 * Celebrates only the signed-in user's own completions, once each, in this session. It loads no server data, so
 * nothing about other people's customers reaches the browser.
 */
export function OwnCompletionCelebration({ userId }: { userId: string }) {
  useEffect(() => {
    function onOwnCompletion(event: Event) {
      const detail = (event as CustomEvent<OwnCompletionDetail>).detail;
      if (!detail) return;
      const ok = shouldCelebrateOwn({ id: detail.id, actorUserId: detail.actorUserId, atMs: Date.now() }, userId, SESSION_START_MS, celebrated);
      if (!ok) return;
      celebrated.add(detail.id);
      void fireConfetti(detail.id);
      toast.success("Account funded");
    }
    window.addEventListener(OWN_COMPLETION_EVENT, onOwnCompletion);
    return () => window.removeEventListener(OWN_COMPLETION_EVENT, onOwnCompletion);
  }, [userId]);
  return null;
}
