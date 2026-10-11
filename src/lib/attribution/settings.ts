/** Speed-to-lead settings an Admin can change. Pure parsing and validation; the page and the sweep read them through `loadSettings`. */
export type AttributionSettings = { slaMinutes: number; graceMinutes: number };

export const DEFAULT_SETTINGS: AttributionSettings = { slaMinutes: 15, graceMinutes: 0 };
export const SLA_MIN = 5;
export const SLA_MAX = 1440;
export const GRACE_MAX = 1440;
export const SLA_KEY = "lead_sla_minutes";
export const GRACE_KEY = "escalation_grace_minutes";

function whole(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && /^-?\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
  return Number.isInteger(n) ? n : null;
}

export function parseSettings(rows: { key: string; value: string }[]): AttributionSettings {
  const get = (key: string) => rows.find((r) => r.key === key)?.value;
  const sla = whole(get(SLA_KEY));
  const grace = whole(get(GRACE_KEY));
  return {
    slaMinutes: sla !== null && sla >= SLA_MIN && sla <= SLA_MAX ? sla : DEFAULT_SETTINGS.slaMinutes,
    graceMinutes: grace !== null && grace >= 0 && grace <= GRACE_MAX ? grace : DEFAULT_SETTINGS.graceMinutes,
  };
}

export function validateSettingsInput(input: unknown): { ok: true; value: AttributionSettings } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "Enter the SLA and the grace period in whole minutes." };
  const o = input as Record<string, unknown>;
  const sla = whole(o.slaMinutes);
  const grace = whole(o.graceMinutes);
  if (sla === null || sla < SLA_MIN || sla > SLA_MAX) return { ok: false, error: `The SLA must be a whole number of minutes from ${SLA_MIN} to ${SLA_MAX}.` };
  if (grace === null || grace < 0 || grace > GRACE_MAX) return { ok: false, error: `The grace period must be a whole number of minutes from 0 to ${GRACE_MAX}.` };
  return { ok: true, value: { slaMinutes: sla, graceMinutes: grace } };
}
