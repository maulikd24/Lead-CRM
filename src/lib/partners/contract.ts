import { z } from "zod";

/**
 * Bump this whenever schemas.ts changes shape. A saved "contract verified" mark only counts while it carries
 * the current version, so changing the schema after verification brings the warning banner back.
 */
export const CONTRACT_VERSION = "2026-10-r1";

export const REFERRAL_API_PROVIDER = "referral_api";

type Settings = Record<string, unknown> | null | undefined;

export function isContractVerified(settings: Settings): boolean {
  if (!settings) return false;
  const at = settings.contractVerifiedAt;
  if (typeof at !== "string" || Number.isNaN(new Date(at).getTime())) return false;
  return settings.contractVersion === CONTRACT_VERSION;
}

const verifyInput = z.object({ confirm: z.literal(true) });

type Db = {
  integrationConfig: {
    findUnique(a: { where: { provider: string } }): Promise<{ settings: unknown } | null>;
    update(a: { where: { provider: string }; data: { settings: Record<string, unknown> } }): Promise<unknown>;
  };
  auditLog: { create(a: { data: Record<string, unknown> }): Promise<unknown> };
};

/** Records that an administrator ran the contract check and accepted the result. Validation and audit included; authorization is the caller's job. */
export async function markContractVerified(db: Db, input: unknown, ctx: { userId: string; now: Date }) {
  verifyInput.parse(input);
  const row = await db.integrationConfig.findUnique({ where: { provider: REFERRAL_API_PROVIDER } });
  if (!row) throw new Error("The referral API connection is not set up yet.");
  const before = (row.settings as Record<string, unknown> | null) ?? {};
  const after = { ...before, contractVerifiedAt: ctx.now.toISOString(), contractVersion: CONTRACT_VERSION };
  await db.integrationConfig.update({ where: { provider: REFERRAL_API_PROVIDER }, data: { settings: after } });
  await db.auditLog.create({
    data: {
      userId: ctx.userId,
      entity: "IntegrationConfig",
      entityId: REFERRAL_API_PROVIDER,
      action: "partner_contract_verified",
      oldValue: { contractVerifiedAt: before.contractVerifiedAt ?? null, contractVersion: before.contractVersion ?? null },
      newValue: { contractVerifiedAt: after.contractVerifiedAt, contractVersion: CONTRACT_VERSION },
    },
  });
}
