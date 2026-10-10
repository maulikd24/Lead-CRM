"use client";

import { useEffect } from "react";

/**
 * The print version is read on screen in the user's theme, but a dark page prints as light text on white paper. For the
 * duration of a print the dark class is taken off the root element and put back afterwards, so the same theme tokens
 * give dark text on a light page. Nothing is hard-coded.
 */
export function LightWhilePrinting() {
  useEffect(() => {
    const root = document.documentElement;
    let wasDark = false;
    const before = () => {
      wasDark = root.classList.contains("dark");
      root.classList.remove("dark");
    };
    const after = () => {
      if (wasDark) root.classList.add("dark");
    };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);
  return null;
}

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="inline-flex h-9 items-center rounded-md bg-primary px-3.5 text-xs font-semibold text-primary-foreground hover:bg-primary/80 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none print:hidden">
      Print or save as PDF
    </button>
  );
}
