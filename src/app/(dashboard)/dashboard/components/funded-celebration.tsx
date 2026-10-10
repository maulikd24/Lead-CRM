"use client";

import { useEffect } from "react";
import { toast } from "sonner";

import { fireConfetti } from "@/components/motion/confetti";
import { decideCelebration, type FundedLatest } from "@/lib/dashboard/live-funnel";

const KEY = (userId: string) => `motion.funded-seen.${userId}`;

function readSeen(userId: string): string[] | null {
  try {
    const raw = localStorage.getItem(KEY(userId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return null; // storage unavailable or corrupt: skip rather than celebrate on every load
  }
}

/** Once per customer (bounded set of the last 50 ids): subtle confetti and a toast with the first name only. Never blocks. */
export function FundedCelebration({ userId, latest }: { userId: string; latest: FundedLatest | null }) {
  useEffect(() => {
    const seen = readSeen(userId);
    if (!seen) return;
    const decision = decideCelebration(latest, seen, new Date());
    if (decision.seen !== seen) {
      try {
        localStorage.setItem(KEY(userId), JSON.stringify(decision.seen));
      } catch {
        /* ignore */
      }
    }
    if (decision.celebrate && latest) {
      void fireConfetti(latest.id);
      toast.success(`${latest.firstName ? `${latest.firstName}'s` : "A customer's"} account is funded`);
    }
  }, [userId, latest]);
  return null;
}
