"use client";

import { Clock } from "lucide-react";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { speedTimer } from "@/lib/attribution/timer";

/** The speed-to-lead clock. The words update every 30 seconds; nothing animates. Server render shows the same words from the server's clock. */
export function SpeedTimer({ dueAtIso, nowIso }: { dueAtIso: string; nowIso: string }) {
  const due = Date.parse(dueAtIso);
  const [now, setNow] = useState(Date.parse(nowIso));
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, []);
  const t = speedTimer(due, now);
  return (
    <Badge variant={t.state === "breached" ? "destructive" : t.urgent ? "warning" : "outline"} className="gap-1">
      <Clock className="size-3" aria-hidden="true" />
      <span role="timer" aria-live="off">{t.label}</span>
    </Badge>
  );
}
