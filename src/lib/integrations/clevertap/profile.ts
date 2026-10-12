export type AppProfile = {
  found: true;
  platforms: string[];
  lastSeen: string | null;
  pushEnabled: boolean | null;
  properties: Record<string, string | number | boolean>;
};

const MAX_PLATFORMS = 10;
const MAX_PROPERTIES = 200;
const MAX_STRING = 200;

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Tolerant parser for CleverTap's single-profile response (GET /1/profile.json). Every field is optional; bounded on hostile input. */
export function parseProfile(json: unknown): AppProfile | null {
  if (!isObject(json) || json.status !== "success" || !isObject(json.record)) return null;
  const rec = json.record;

  const platformInfo = Array.isArray(rec.platformInfo) ? rec.platformInfo.filter(isObject) : [];
  const platforms: string[] = [];
  for (const p of platformInfo) {
    if (typeof p.platform === "string" && p.platform && !platforms.includes(p.platform.slice(0, 40))) platforms.push(p.platform.slice(0, 40));
    if (platforms.length >= MAX_PLATFORMS) break;
  }
  const pushEnabled = platformInfo.length === 0 ? null : platformInfo.some((p) => typeof p.push_token === "string" && p.push_token.length > 0);

  const properties: Record<string, string | number | boolean> = {};
  if (isObject(rec.profileData)) {
    let n = 0;
    for (const k in rec.profileData) {
      if (n >= MAX_PROPERTIES) break;
      const v = rec.profileData[k];
      if (typeof v === "string") properties[k.slice(0, 80)] = v.slice(0, MAX_STRING);
      else if (typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v))) properties[k.slice(0, 80)] = v;
      else continue;
      n++;
    }
  }

  let lastSeen: string | null = null;
  const launched = isObject(rec.events) ? rec.events["App Launched"] : undefined;
  if (isObject(launched) && typeof launched.last_seen === "number") {
    const d = new Date(launched.last_seen * 1000);
    if (!Number.isNaN(d.getTime())) lastSeen = d.toISOString();
  }

  return { found: true, platforms, lastSeen, pushEnabled, properties };
}
