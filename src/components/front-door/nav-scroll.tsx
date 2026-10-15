"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Marks the bar as scrolled once the sentinel at the top of the page leaves the viewport. One observer, no scroll listener. */
export function NavScroll({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const sentinel = document.getElementById("fd-top");
    const bar = ref.current?.querySelector<HTMLElement>(".fd-nav");
    if (!sentinel || !bar || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => bar.setAttribute("data-scrolled", e.isIntersecting ? "false" : "true"), { threshold: 0 });
    io.observe(sentinel);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} style={{ display: "contents" }}>
      {children}
    </div>
  );
}
