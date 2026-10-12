import { formatCode, shareLink } from "./code";
import { signoffState } from "./disclosure";
import { checkInviteDraft, composeInviteDraft } from "./message";

export type InviteDeps = {
  loadReferrer: (referrerId: string) => Promise<{ clientId: string; firstName: string; activeCode: string | null; status: "ACTIVE" | "SUSPENDED" } | null>;
  getSetting: (key: string) => Promise<string | null>;
  linkBase: string | undefined;
  /** The consent ledger gate for marketing messages to this customer. Allowed (and `enforced: false`) while consent enforcement is off. */
  consent: (clientId: string) => Promise<{ allowed: boolean; enforced: boolean; reason?: string }>;
};

/**
 * Prepares the invitation a referrer could share. It only ever RETURNS TEXT for a person to review and send themselves;
 * nothing is sent from here. The consent ledger and the copy guardrails both have to pass, and the disclosure wording (configurable, with a safe default) must carry a compliance sign-off.
 */
export async function buildInviteDraft(i: { referrerId: string; deps: InviteDeps }): Promise<{ ok: true; text: string; code: string; consentEnforced: boolean } | { ok: false; error: string }> {
  const { deps } = i;
  const ref = await deps.loadReferrer(i.referrerId);
  if (!ref || ref.status !== "ACTIVE") return { ok: false, error: "This referrer is not active." };
  if (!ref.activeCode) return { ok: false, error: "This referrer has no active code. Issue one first." };
  const wording = signoffState({ custom: await deps.getSetting("disclaimer"), signoff: await deps.getSetting("disclaimer_signoff"), editor: await deps.getSetting("disclaimer_editor") });
  if (!wording.signedOff) return { ok: false, error: "The disclosure wording has no compliance sign-off yet. An Admin records it under Rules, Programme settings. Nothing was drafted." };
  const disclaimer = wording.text;
  const link = shareLink(deps.linkBase, ref.activeCode);
  if (!link) return { ok: false, error: "The share link base is not configured (REFERRAL_LINK_BASE, an https address)." };
  const consent = await deps.consent(ref.clientId);
  if (!consent.allowed) return { ok: false, error: `No consent to send this person marketing messages (${consent.reason ?? "consent ledger"}). Nothing was drafted.` };
  const text = composeInviteDraft({ referrerFirstName: ref.firstName, link, disclaimer });
  const check = checkInviteDraft(text, disclaimer);
  if (!check.ok) return { ok: false, error: check.detail };
  return { ok: true, text, code: formatCode(ref.activeCode), consentEnforced: consent.enforced };
}
