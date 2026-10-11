"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * Lets a panel change shape smoothly: when its content changes (the command bar morphing from search into a form) the height eases
 * to the new size in 200ms and the new content fades in once. No animation library; reduced motion gets an instant swap.
 */
export function MorphHeight({ children, contentKey }: { children: ReactNode; contentKey: string }) {
  const inner = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    setHeight(el.offsetHeight);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [contentKey]);
  return (
    <div style={{ height: height ?? undefined }} className="overflow-hidden transition-[height] duration-200 ease-out motion-reduce:transition-none">
      <div ref={inner} key={contentKey} className="morph-in">
        {children}
      </div>
    </div>
  );
}
