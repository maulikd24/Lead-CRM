/** "expires in 31 h" / "expires in 20 min" / "expired". Whole hours (floored) from one hour up, minutes (min 1) below. */
export function expiresInLabel(expiresAt: Date, now: Date): string {
  const ms = expiresAt.getTime() - now.getTime();
  if (ms <= 0) return "expired";
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return `expires in ${hours} h`;
  return `expires in ${Math.max(1, Math.floor(ms / 60_000))} min`;
}
