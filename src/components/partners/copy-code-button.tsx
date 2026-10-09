"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

/** Shows a referral code in a monospace chip with a one-click copy. Falls back to selecting the text if the clipboard is blocked. */
export function CopyCodeButton({ code }: { code: string | null }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  if (!code) return <span className="text-muted-foreground">—</span>;

  async function copy() {
    try {
      await navigator.clipboard.writeText(code as string);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard unavailable (insecure context or blocked): the code stays selectable in the chip.
    }
  }

  return (
    <span className="inline-flex items-center gap-1">
      <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs select-all">{code}</code>
      <Button type="button" variant="ghost" size="icon-xs" onClick={copy} aria-label={copied ? "Code copied" : `Copy referral code ${code}`}>
        {copied ? <Check className="text-success" /> : <Copy />}
      </Button>
      <span className="sr-only" role="status" aria-live="polite">{copied ? "Copied" : ""}</span>
    </span>
  );
}
