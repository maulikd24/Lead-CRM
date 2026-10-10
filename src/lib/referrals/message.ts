import { checkCopy } from "@/lib/agents/guardrails";

/**
 * The invitation a referrer may share. It is only ever a DRAFT: nothing here sends anything. Before anyone sends it, the
 * text must pass the same guardrails as agent copy (no guaranteed or assured returns, no advice, no quoted performance, no
 * echoed identifiers), must not mention reward amounts or earnings, and must end with the firm's mandatory disclaimer,
 * which is configured by an Admin and never has a built-in default: no disclaimer, no draft.
 */
export function composeInviteDraft(i: { referrerFirstName: string; link: string; disclaimer: string }): string {
  return `Hi, it is ${i.referrerFirstName}. I use Allvest and thought you may like to look at it too. You can sign up here: ${i.link}\n\n${i.disclaimer}`;
}

export type DraftCheck = { ok: true } | { ok: false; code: "NO_DISCLAIMER" | "MISSING_DISCLAIMER" | "REWARD_PROMISE" | "EMPTY" | "TOO_LONG" | "RETURN_PROMISE" | "ADVICE" | "PERFORMANCE_CLAIM" | "PII_ECHO"; detail: string };

const REWARD = /(?:₹|\brs\.?|\binr)\s*\d|\d\s*%|\bearn(?:s|ing|ed)?\b|\bcash\s*back\b|\bbonus\b/i;

export function checkInviteDraft(text: string, disclaimer: string | undefined): DraftCheck {
  const d = disclaimer?.trim();
  if (!d) return { ok: false, code: "NO_DISCLAIMER", detail: "The mandatory disclaimer is not configured yet." };
  if (!text.includes(d)) return { ok: false, code: "MISSING_DISCLAIMER", detail: "The message must end with the mandatory disclaimer." };
  // The disclaimer is firm-approved wording and may legitimately say returns are not guaranteed, so that one rule is skipped for it;
  // everything else (identifiers, advice, reward amounts) still applies.
  const dg = checkCopy(d, 1000);
  if ((!dg.ok && dg.code !== "RETURN_PROMISE") || REWARD.test(d)) return { ok: false, code: dg.ok ? "REWARD_PROMISE" : dg.code, detail: "The configured disclaimer contains text that is not allowed in a referral message." };
  const body = text.replace(d, "").trim();
  const g = checkCopy(body, 1000);
  if (!g.ok) return { ok: false, code: g.code, detail: g.detail };
  if (REWARD.test(body)) return { ok: false, code: "REWARD_PROMISE", detail: "Do not mention reward amounts, earnings or bonuses in an invitation." };
  return { ok: true };
}
