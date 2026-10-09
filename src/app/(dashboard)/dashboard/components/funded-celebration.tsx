"use client";

import { useEffect } from "react";
import { toast } from "sonner";

import { fireConfetti } from "@/components/motion/confetti";
import { decideCelebration, type FundedLatest } from "@/lib/dashboard/live-funnel";

const KEY = (userId: string) => `motion.funded-seen.${userId}`;

/** Once per customer: subtle confetti and a toast with the first name only. Never blocks on storage errors. */
export function FundedCelebration({ userId, latest }: { userId: string; latest: FundedLatest | null }) {
  useEffect(() => {
    let seen: string | null = null;
    try {
      seen = localStorage.getItem(KEY(userId));
    } catch {
      return; // storage unavailable: skip rather than celebrate on every load
    }
    const { celebrate, record } = decideCelebration(latest, seen, new Date());
    if (record && record !== seen) {
      try {
        localStorage.setItem(KEY(userId), record);
      } catch {
        /* ignore */
      }
    }
    if (celebrate && latest) {
      void fireConfetti(latest.id);
      toast.success(`${latest.firstName ? `${latest.firstName}'s` : "A customer's"} account is funded`);
    }
  }, [userId, latest]);
  return null;
}
