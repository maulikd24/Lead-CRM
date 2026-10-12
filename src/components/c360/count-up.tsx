"use client";

import { formatInrCompact } from "@/lib/c360/count-up";

import { useCountUp, useInView } from "./use-motion";

/** A number that counts up when it scrolls into view. Screen readers get the final value straight away. */
export function CountUp({ value, format = "inr", className }: { value: number; format?: "inr" | "int"; className?: string }) {
  const [ref, inView] = useInView<HTMLSpanElement>();
  const shown = useCountUp(value, { start: inView });
  const text = (n: number) => (format === "inr" ? formatInrCompact(n) : Math.round(n).toLocaleString("en-IN"));
  return (
    <span ref={ref} className={className}>
      <span aria-hidden="true">{text(shown)}</span>
      <span className="sr-only">{text(value)}</span>
    </span>
  );
}
