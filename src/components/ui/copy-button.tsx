"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Copies a short value (a client code, a referral link) and says so: the icon turns into a tick for 1.5 seconds and a polite live
 * region announces "Copied". 44px target, a real button. The idea follows Cult UI's copy button (MIT, https://www.cult-ui.com), in our tokens.
 */
export function CopyButton({ value, label, className }: { value: string; label: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false); // clipboard blocked: nothing to claim
    }
  }

  const Icon = copied ? Check : Copy;
  return (
    <>
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy ${label}`}
        className={cn("inline-flex size-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring motion-reduce:transition-none", copied && "text-[var(--primary-ink)]", className)}
      >
        <Icon aria-hidden className="size-4" />
      </button>
      <span role="status" aria-live="polite" className="sr-only">{copied ? `${label} copied` : ""}</span>
    </>
  );
}
