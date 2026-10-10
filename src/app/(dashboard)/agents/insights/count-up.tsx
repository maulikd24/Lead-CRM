"use client";

import { CountUp as WorkspaceCountUp } from "@/components/workspace";

/** The text shown once the number has settled. Also the text-to-speech version, so assistive tech never hears the tween. */
export function formatCount(value: number, decimals = 0, prefix = "", suffix = ""): string {
  return `${prefix}${value.toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${suffix}`;
}

/** Counts up once in 300ms on the shared workspace CountUp (final value on the server and for reduced motion). */
export function CountUp({ value, decimals = 0, prefix = "", suffix = "" }: { value: number; decimals?: number; prefix?: string; suffix?: string }) {
  return <WorkspaceCountUp value={value} format={(n) => formatCount(n, decimals, prefix, suffix)} />;
}
