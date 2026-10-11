"use client";

import { useEffect, useRef } from "react";

/**
 * A native <details> that is closed on a phone and open on a laptop (set after mount, so the server markup is the closed phone
 * layout). Keeps long lists inside the phone height budget without hiding them from anyone: one tap opens it, and it stays a
 * real, keyboard-operable disclosure.
 */
export function PhoneFold({ summary, children, className }: { summary: React.ReactNode; children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (ref.current && window.matchMedia("(min-width: 1024px)").matches) ref.current.open = true;
  }, []);
  return (
    <details ref={ref} className={className}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-base font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">{summary}</summary>
      {children}
    </details>
  );
}
