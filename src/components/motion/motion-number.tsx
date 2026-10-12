import { cn } from "@/lib/utils";
import { LazyCountUp } from "./lazy";
import { formatCount, type CountFormat } from "./format-count";
import { motionEnabled } from "./tokens";

/** A number that counts up to its value (and between values when it changes) with motion on; plain text with it off. */
export function MotionNumber({ value, format = "number", delay, className }: { value: number; format?: CountFormat; delay?: number; className?: string }) {
  if (motionEnabled()) return <LazyCountUp value={value} format={format} delay={delay} className={className} />;
  return <span className={cn("tabular-nums", className)}>{formatCount(value, format)}</span>;
}
