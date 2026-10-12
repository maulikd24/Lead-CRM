import { zonedLocalToUtc } from "../zoned-time";

/** The timezone post times are entered and shown in. Defaults to India time; override with SOCIAL_TIMEZONE. */
export function socialTimezone(env: Record<string, string | undefined> = process.env): string {
  const zone = env.SOCIAL_TIMEZONE?.trim();
  if (zone && zonedLocalToUtc("2026-01-01T00:00", zone)) return zone;
  return "Asia/Kolkata";
}
