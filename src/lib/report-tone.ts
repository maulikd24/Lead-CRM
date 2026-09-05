export function thresholdTone(value: number, badAt: number): string {
  return value >= badAt ? "text-destructive font-medium" : "";
}
