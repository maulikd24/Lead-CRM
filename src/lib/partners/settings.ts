/**
 * Settings for the Partner workspace that Finance and Admin edit in Settings: the statement letterhead and registration text, the
 * public form link and the attribution lapse window, and who receives statement queries. Stored in the database, so nothing that
 * identifies the firm lives in the repository. Defaults exist only where they are harmless (no letterhead, a 90 day lapse window).
 */
export const DEFAULT_LAPSE_DAYS = 90;
export const MAX_LETTERHEAD_LINES = 6;
const MAX_LINE = 120;
const MAX_REGISTRATION = 400;

export type WorkspaceSettings = {
  letterhead: { lines: string[] };
  registration: { text: string };
  referral: { linkBase: string | null; lapseDays: number };
  queries: { assigneeUserId: string | null };
};
export type SettingKey = keyof WorkspaceSettings;
export const SETTING_KEYS: SettingKey[] = ["letterhead", "registration", "referral", "queries"];

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export function validateSetting(key: string, input: Record<string, unknown>): { ok: true; value: WorkspaceSettings[SettingKey] } | { ok: false; errors: string[] } {
  const fail = (...errors: string[]) => ({ ok: false as const, errors });
  switch (key) {
    case "letterhead": {
      const lines = (Array.isArray(input.lines) ? input.lines : []).map(str).filter(Boolean);
      if (lines.length > MAX_LETTERHEAD_LINES) return fail(`At most ${MAX_LETTERHEAD_LINES} letterhead lines.`);
      if (lines.some((l) => l.length > MAX_LINE)) return fail(`Each letterhead line is at most ${MAX_LINE} characters.`);
      return { ok: true, value: { lines } };
    }
    case "registration": {
      const text = str(input.text);
      if (text.length > MAX_REGISTRATION) return fail(`The registration text is at most ${MAX_REGISTRATION} characters.`);
      return { ok: true, value: { text } };
    }
    case "referral": {
      const errors: string[] = [];
      const raw = typeof input.lapseDays === "number" ? String(input.lapseDays) : str(input.lapseDays);
      const days = /^\d{1,3}$/.test(raw) ? Number(raw) : NaN;
      if (!Number.isInteger(days) || days < 1 || days > 730) errors.push("The lapse window is a whole number of days from 1 to 730.");
      const baseRaw = str(input.linkBase);
      let linkBase: string | null = null;
      if (baseRaw) {
        try {
          const u = new URL(baseRaw);
          if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash || baseRaw.length > 200) throw new Error("bad");
          linkBase = baseRaw;
        } catch {
          errors.push("The form link must be an https address with no credentials, query or fragment.");
        }
      }
      return errors.length ? { ok: false, errors } : { ok: true, value: { linkBase, lapseDays: days } };
    }
    case "queries": {
      const id = str(input.assigneeUserId);
      return { ok: true, value: { assigneeUserId: id || null } };
    }
    default:
      return fail("Unknown setting.");
  }
}

/** The saved settings with defaults where a default is harmless. A saved row that no longer validates is ignored. */
export function readSettings(rows: { key: string; value: unknown }[]): WorkspaceSettings {
  const out: WorkspaceSettings = { letterhead: { lines: [] }, registration: { text: "" }, referral: { linkBase: null, lapseDays: DEFAULT_LAPSE_DAYS }, queries: { assigneeUserId: null } };
  for (const row of rows) {
    if (!SETTING_KEYS.includes(row.key as SettingKey) || typeof row.value !== "object" || row.value === null) continue;
    const v = validateSetting(row.key, row.value as Record<string, unknown>);
    if (v.ok) (out as Record<string, unknown>)[row.key] = v.value;
  }
  return out;
}

const CODE = /^[A-Za-z0-9-]{3,40}$/;

/** The link a partner shares: the configured form address with their code as `ref`. Null without a configured address or with a malformed code. */
export function buildReferralLink(linkBase: string | null, code: string): string | null {
  if (!linkBase || !CODE.test(code)) return null;
  const u = new URL(linkBase);
  u.searchParams.set("ref", code);
  return u.toString();
}

export type SettingsDb = {
  partnerWorkspaceSetting: {
    findMany(): Promise<{ key: string; value: unknown }[]>;
    findUnique(a: { where: { key: string } }): Promise<{ key: string; value: unknown } | null>;
    upsert(a: { where: { key: string }; create: { key: string; value: unknown; updatedById: string }; update: { value: unknown; updatedById: string } }): Promise<unknown>;
  };
  auditLog: { create(a: { data: Record<string, unknown> }): Promise<unknown> };
};

export async function loadWorkspaceSettings(db: Pick<SettingsDb, "partnerWorkspaceSetting">): Promise<WorkspaceSettings> {
  return readSettings(await db.partnerWorkspaceSetting.findMany());
}

/** Validates, stores and audits one setting (old and new value, who). Nothing is stored or audited for an invalid value. */
export async function saveWorkspaceSetting(db: SettingsDb, actor: { id: string }, key: string, input: Record<string, unknown>): Promise<{ ok: true } | { ok: false; errors: string[] }> {
  const v = validateSetting(key, input);
  if (!v.ok) return v;
  const before = await db.partnerWorkspaceSetting.findUnique({ where: { key } });
  await db.partnerWorkspaceSetting.upsert({ where: { key }, create: { key, value: v.value, updatedById: actor.id }, update: { value: v.value, updatedById: actor.id } });
  await db.auditLog.create({ data: { userId: actor.id, entity: "PartnerWorkspaceSetting", entityId: key, action: "partner_setting_changed", oldValue: (before?.value ?? null) as never, newValue: v.value as never } });
  return { ok: true };
}
