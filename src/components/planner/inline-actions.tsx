"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";

import type { ActionOutcome } from "./action-form";

/** A button that calls one server action and shows its words. `confirm` asks first (a destructive step). */
export function ActionButton({ action, label, pendingLabel, variant = "default", confirm, size = "sm", redirectTo }: { action: () => Promise<ActionOutcome>; label: string; pendingLabel?: string; variant?: "default" | "outline" | "destructive" | "secondary"; confirm?: string; size?: "sm" | "default"; redirectTo?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button type="button" size={size} variant={variant} disabled={pending} onClick={() => {
        if (confirm && !window.confirm(confirm)) return;
        setMsg(null);
        start(async () => {
          const r = await action();
          setMsg(r.ok ? { tone: "ok", text: r.message ?? "Done." } : { tone: "error", text: r.error });
          if (r.ok) {
            if (redirectTo) router.push(redirectTo);
            else router.refresh();
          }
        });
      }}>{pending ? pendingLabel ?? "Working" : label}</Button>
      {msg && <span role={msg.tone === "error" ? "alert" : "status"} className={msg.tone === "error" ? "text-sm text-destructive" : "text-sm text-success"}>{msg.text}</span>}
    </span>
  );
}

/** Approve (with the reader's tick) or send back (with a note): the canonical approval path. The server decides who may; the buttons never guess. */
export function DecisionBox({ decide, approveLabel = "Approve", tickText }: { decide: (decision: "approve" | "reject", input: { confirmed?: boolean; reason?: string }) => Promise<ActionOutcome>; approveLabel?: string; tickText: string }) {
  const router = useRouter();
  const uid = useId();
  const [confirmed, setConfirmed] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const go = (d: "approve" | "reject") =>
    start(async () => {
      setMsg(null);
      const r = await decide(d, { confirmed, reason });
      setMsg(r.ok ? { tone: "ok", text: r.message ?? "Done." } : { tone: "error", text: r.error });
      if (r.ok) router.refresh();
    });
  return (
    <div className="grid max-w-xl gap-3 text-sm">
      <div className="flex items-start gap-2">
        <input id={`${uid}-tick`} type="checkbox" className="mt-1 size-4" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        <label htmlFor={`${uid}-tick`}>{tickText}</label>
      </div>
      <div className="grid gap-1">
        <label htmlFor={`${uid}-note`} className="font-medium">Note (needed to ask for changes)</label>
        <textarea id={`${uid}-note`} className="native-control min-h-16 w-full py-2" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" disabled={pending} onClick={() => go("approve")}>{approveLabel}</Button>
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => go("reject")}>Ask for changes</Button>
        {msg && <p role={msg.tone === "error" ? "alert" : "status"} className={msg.tone === "error" ? "text-sm text-destructive" : "text-sm text-success"}>{msg.text}</p>}
      </div>
    </div>
  );
}

/** Copies a link to the clipboard. Falls back to selecting nothing: the link is also shown in full next to it. */
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button type="button" size="sm" variant="outline" onClick={async () => {
      try {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 2000);
      } catch {
        setDone(false);
      }
    }}>{done ? "Copied" : label}</Button>
  );
}
