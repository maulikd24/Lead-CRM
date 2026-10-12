import { createHash } from "node:crypto";

export type CustomerSignals = {
  lifecycleStage: string;
  kycApproved: boolean;
  funded: boolean;
  nbaProgramme: string | null;
  priority: string | null;
  acceptance: Record<string, "HIGH" | "MEDIUM" | "LOW">;
  /** True while the customer has an open service issue; CleverTap campaigns should suppress sales messages. */
  salesPaused: boolean;
};

export type CleverTapUpload = { d: { identity: string; type: "profile"; profileData: Record<string, string | boolean> }[] };

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

// Built from named fields only: anything else on the input object is never copied.
function profileData(s: CustomerSignals): Record<string, string | boolean> {
  const data: Record<string, string | boolean> = {
    av_lifecycle_stage: s.lifecycleStage,
    av_kyc_approved: s.kycApproved,
    av_funded: s.funded,
    av_sales_paused: s.salesPaused,
  };
  if (s.nbaProgramme) data.av_nba_programme = s.nbaProgramme;
  if (s.priority) data.av_priority = s.priority;
  const LEVELS = new Set(["HIGH", "MEDIUM", "LOW"]);
  // Sorted so that, when two names slug to the same key, the first (by name) deterministically wins.
  for (const asset of Object.keys(s.acceptance ?? {}).sort()) {
    const level = (s.acceptance as Record<string, unknown>)[asset];
    if (typeof level !== "string" || !LEVELS.has(level.toUpperCase())) continue;
    const key = slug(asset);
    if (!key) continue;
    const prop = `av_accept_${key}`;
    if (Object.hasOwn(data, prop)) continue;
    data[prop] = level.toLowerCase();
  }
  return data;
}

export function buildProfileUpload(identity: string, s: CustomerSignals): CleverTapUpload {
  return { d: [{ identity, type: "profile", profileData: profileData(s) }] };
}

export function signalsHash(s: CustomerSignals): string {
  const data = profileData(s);
  const canonical = JSON.stringify(Object.keys(data).sort().map((k) => [k, data[k]]));
  return createHash("sha256").update(canonical).digest("hex");
}

export function pickIdentity(c: { email: string | null; mobile: string | null }): string | null {
  const email = c.email?.trim();
  if (email) return email;
  const mobile = c.mobile?.trim();
  return mobile ? mobile : null;
}
