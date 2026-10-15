import { z } from "zod";

/**
 * Where a second person must approve. Ad copy: a person's own copy may not be approved by its author (the rule social posts follow); an Admin can
 * switch that off for a one-person team. A director report link: off by default, an Admin can require a second person. Stored as one small JSON
 * value in CreativeSetting ("approvals"), changed only by an Admin (area marketing-reports, manage). Pure.
 */
export const approvalSettingsSchema = z.object({ adCreativeFourEyes: z.boolean(), reportFourEyes: z.boolean() });
export type ApprovalSettings = z.infer<typeof approvalSettingsSchema>;
export const DEFAULT_APPROVAL_SETTINGS: ApprovalSettings = { adCreativeFourEyes: true, reportFourEyes: false };

export function parseApprovalSettings(raw: unknown): ApprovalSettings {
  const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const pick = (key: keyof ApprovalSettings) => (typeof obj[key] === "boolean" ? (obj[key] as boolean) : DEFAULT_APPROVAL_SETTINGS[key]);
  return { adCreativeFourEyes: pick("adCreativeFourEyes"), reportFourEyes: pick("reportFourEyes") };
}
