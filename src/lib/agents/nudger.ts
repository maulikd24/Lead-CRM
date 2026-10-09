import type { AgentBriefing } from "@/lib/intelligence/agent";
import type { LlmProvider } from "@/lib/ai/provider";
import { checkOutbound } from "./guardrails";
import { judgeOutbound } from "./judge";
import { reasonCategoryFor } from "./reason-category";
import { COOLDOWN_LOOKBACK_MS, isCoolingDown, type RecentProposal } from "./cooldown";

/** Returned (as a skip) when the vendor call throws; the batch counts consecutive ones to stop early. */
export const PROVIDER_ERROR_REASON = "provider error; no draft created";
export const ALREADY_HAS_DRAFT = "already has a draft";
/** Vendor timeout for the draft call. provider.ts retries once, so the worst case is about twice this. */
export const DRAFT_TIMEOUT_MS = 20_000;
export const NUDGER_KEY = "wa_nudger";
export const NUDGER_PROGRAMMES = ["Complete KYC", "Fund account", "First transaction"] as const;
const DRAFT_TTL_MS = 48 * 60 * 60 * 1000;

export type NewProposal = {
  agentKey: string;
  clientId: string;
  programme: string;
  body: string;
  originalBody: string;
  reason: string;
  status: "DRAFT" | "BLOCKED";
  blockedReason: string | null;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  expiresAt: Date;
};

export type NudgerDeps = {
  briefing: (clientId: string) => Promise<AgentBriefing | null>;
  provider: LlmProvider;
  isEnabled: () => Promise<boolean>;
  /** This customer's wa_nudger proposals created since `since` (status, createdAt, decidedAt, expiresAt only). */
  recentProposals: (clientId: string, since: Date) => Promise<RecentProposal[]>;
  /** Resolves `{ duplicate: true }` (and inserts nothing) when the customer already has an unexpired DRAFT or an APPROVED proposal. */
  save: (proposal: NewProposal) => Promise<{ id: string } | { duplicate: true }>;
  now: () => Date;
};

export type DraftResult =
  | { status: "skipped"; reason: string }
  | { status: "blocked"; reason: string; proposalId: string }
  | { status: "drafted"; proposalId: string };

const SYSTEM = [
  "You write one short WhatsApp message from an Allvest relationship manager to a customer.",
  "You receive JSON with firstName, language, programme and reasonCategory. reasonCategory is one of: kyc_pending (KYC not finished yet), kyc_stuck_in_documents (KYC waiting on documents), signed_up_not_funded (KYC done, account not yet funded), funded_no_first_transaction (account funded, nothing traded yet), other_onboarding (general onboarding follow-up).",
  "Purpose: help the customer take the next onboarding step that reasonCategory describes. Be warm, plain and brief (under 400 characters). Do not invent details beyond the category.",
  "Never give investment advice, never mention returns, performance or guarantees, never pressure the customer.",
  "Write in the requested language. Output only the message text.",
].join(" ");

/** Defence in depth for any text that might one day be shown to a vendor: strips contact and identity numbers. The nudger itself no longer sends free text. */
export function scrub(s: string): string {
  return s
    .replace(/\S+@\S+/g, "[email]")
    .replace(/\b[A-Z]{5}\d{4}[A-Z]\b/gi, "[id]")
    .replace(/\+?\d[\d\s-]{4,}\d/g, (m) => (m.replace(/\D/g, "").length >= 6 ? "[number]" : m))
    .replace(/\d{6,}/g, "[number]");
}

/** First name only, and only if it looks like a real name (a WhatsApp profile name can be a phone number or a fallback label). */
export function safeFirstName(full: string): string {
  const first = full.trim().split(/\s+/)[0] ?? "";
  return /^\p{L}[\p{L}\p{M}.'-]{0,30}$/u.test(first) && !/^whatsapp/i.test(first) ? first : "there";
}

export async function draftNudge(clientId: string, deps: NudgerDeps): Promise<DraftResult> {
  if (!(await deps.isEnabled())) return { status: "skipped", reason: "agent is disabled" };
  const b = await deps.briefing(clientId);
  if (!b) return { status: "skipped", reason: "customer not found" };
  const programme = b.whyContactingNow.programme;
  if (!(NUDGER_PROGRAMMES as readonly string[]).includes(programme)) return { status: "skipped", reason: `programme "${programme}" is not handled` };
  if (b.openIssues.length > 0 || b.mustNotDiscuss.length > 0) return { status: "skipped", reason: "customer has an open issue; resolve it before any nudge" };
  const now = deps.now();
  if (isCoolingDown(await deps.recentProposals(clientId, new Date(now.getTime() - COOLDOWN_LOOKBACK_MS)), now)) return { status: "skipped", reason: "cooling down" };

  const firstName = safeFirstName(b.customer.name);
  const language = (b.customer.preferredLanguage ?? "").toLowerCase().startsWith("hi") ? "Hindi" : "English";
  // The vendor sees only these four fields. Free text (reason, topic, talking points) never leaves; see reason-category.ts.
  const user = JSON.stringify({ firstName, language, programme, reasonCategory: reasonCategoryFor(b) });

  let res;
  try {
    res = await deps.provider.complete({ system: SYSTEM, user, maxTokens: 300, timeoutMs: DRAFT_TIMEOUT_MS });
  } catch {
    return { status: "skipped", reason: PROVIDER_ERROR_REASON };
  }

  const text = res.text.trim();
  const base = {
    agentKey: NUDGER_KEY, clientId, programme, body: text, originalBody: text, reason: b.whyContactingNow.reason,
    provider: deps.provider.name, model: res.model, inputTokens: res.inputTokens, outputTokens: res.outputTokens,
    expiresAt: new Date(deps.now().getTime() + DRAFT_TTL_MS),
  };
  const block = async (blockedReason: string, reason: string): Promise<DraftResult> => {
    const saved = await deps.save({ ...base, status: "BLOCKED", blockedReason });
    if ("duplicate" in saved) return { status: "skipped", reason: ALREADY_HAS_DRAFT };
    return { status: "blocked", reason, proposalId: saved.id };
  };

  const verdict = checkOutbound(text);
  if (!verdict.ok) return block(`${verdict.code}: ${verdict.detail}`, verdict.detail);

  const judged = await judgeOutbound(text, deps.provider);
  if (!judged.safe) return block(`JUDGE: ${judged.reason}`, judged.reason);

  const saved = await deps.save({ ...base, status: "DRAFT", blockedReason: null });
  if ("duplicate" in saved) return { status: "skipped", reason: ALREADY_HAS_DRAFT };
  return { status: "drafted", proposalId: saved.id };
}
