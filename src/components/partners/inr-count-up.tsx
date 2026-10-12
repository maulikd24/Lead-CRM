"use client";

import { CountUp } from "@/components/workspace";
import { formatInr } from "@/lib/partners/view-models";

/** A rupee amount that counts up once. A client wrapper, because a format function cannot be passed from a server component. */
export function InrCountUp({ value, label }: { value: number | null; label?: string }) {
  return <CountUp value={value} format={formatInr} label={label} />;
}
