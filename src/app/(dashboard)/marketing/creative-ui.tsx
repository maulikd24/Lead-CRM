"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Small shared pieces for the creative and report screens: field styles and one way to run a server action and show its answer. */

export const fieldClass = "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";
export const areaClass = "w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

export type Message = { tone: "ok" | "error"; text: string } | null;
type Result = { ok: true } | { ok: false; error: string };

/** Runs a server action, shows its answer, and refreshes the page data. `message` is announced politely. */
export function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<Message>(null);
  function run<T extends Result>(fn: () => Promise<T>, okText: string, after?: (r: Extract<T, { ok: true }>) => void) {
    setMessage(null);
    start(async () => {
      try {
        const r = await fn();
        if (r.ok) {
          setMessage({ tone: "ok", text: okText });
          after?.(r as Extract<T, { ok: true }>);
          router.refresh();
        } else setMessage({ tone: "error", text: r.error });
      } catch {
        setMessage({ tone: "error", text: "Something went wrong. Please try again." });
      }
    });
  }
  return { run, pending, message, setMessage };
}

export function StatusLine({ message }: { message: Message }) {
  return (
    <div role="status" aria-live="polite" className="min-h-5 text-sm">
      {message && <p className={message.tone === "error" ? "text-destructive" : "text-success"}>{message.text}</p>}
    </div>
  );
}

export function Labelled({ label, hint, children, className, htmlFor }: { label: string; hint?: string; children: ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export const TAG_LABELS: Record<string, string> = {
  video: "Video", image: "Image", carousel: "Carousel", text: "Text", other: "Other",
  question: "Question", process: "How it works", myth_fact: "Myth or fact", checklist: "Checklist", number: "Number", story: "Story",
  call: "Call", webinar: "Webinar", guide: "Guide", calculator: "Calculator", free_review: "Free review", none: "No offer",
  short: "Short", medium: "Medium", long: "Long",
  book_call: "Book a call", learn_more: "Learn more", sign_up: "Sign up", download: "Download",
};
export const tagLabel = (v: string) => TAG_LABELS[v] ?? v.replace(/_/g, " ");
