/**
 * The ONE seam between this programme and the partner programme. This branch has no partner tables (another branch owns
 * them), so by default no code is a partner code. When the partner branch is merged, replace the body with a lookup of the
 * code against its own partner table (case-insensitive, any status: an inactive partner's code is still a partner code).
 * Nothing else in the referral programme imports from the partner code, and the old external-referral view under /partners
 * is not used here at all.
 */
export type PartnerProbe = (normalisedCode: string) => Promise<boolean>;

export const partnerCodeExists: PartnerProbe = async () => false;
