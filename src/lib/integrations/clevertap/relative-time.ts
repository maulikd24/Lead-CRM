/** "3 days ago" style label; falls back to nothing for unparseable input. */
export function relativeTime(iso: string, now: Date): string | null {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const sec = Math.round((now.getTime() - t) / 1000);
  if (sec < 60) return "just now";
  const units: [number, string][] = [[60, "minute"], [3600, "hour"], [86400, "day"], [2592000, "month"], [31536000, "year"]];
  let value = Math.floor(sec / 60), unit = "minute";
  for (let i = 0; i < units.length; i++) {
    const [size, name] = units[i];
    if (sec >= size) { value = Math.floor(sec / size); unit = name; }
  }
  return `${value} ${unit}${value === 1 ? "" : "s"} ago`;
}
