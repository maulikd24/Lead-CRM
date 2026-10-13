import type { ConsentChannel, ConsentPurpose } from "@/lib/consent/policy";

import { DATA_CLASSES, type DataClass, type Env } from "./types";

/**
 * The purpose registry: every reason the system calls a model, as code-defined data. A call names one of these ids or it is
 * refused (there is no anonymous model call). A purpose declares what the model is shown (dataClass), what consent covers it,
 * what identifying details it may receive, its prompt id and version, and its limits. purposes.test.ts lints the whole table.
 *
 * Consent: a purpose that shows customer text or identifiers MUST name a ledger purpose (and the caller must give the customer
 * as the subject). A purpose that shows customer facts names one or carries `exempt` with the reason written down.
 */

export type PurposeConsent = { purpose: ConsentPurpose; channel: ConsentChannel | null } | { exempt: string } | null;

export type PurposeDef = {
  id: string;
  label: string;
  /** The agent this purpose belongs to (agents/registry.ts); null for shared infrastructure such as the compliance judge. */
  agentKey: string | null;
  dataClass: DataClass;
  consent: PurposeConsent;
  /** Needs phone numbers and emails in the prompt (a call transcript). A PAN is never allowed. */
  allowContactIdentifiers: boolean;
  /** The content is figures (dates, amounts): digit runs are kept. Emails and PANs are still removed. */
  allowNumbers?: boolean;
  /** Needs the person's name in the prompt. */
  allowNames: boolean;
  prompt: { id: string; version: string };
  /** Pins the provider and model; without it the AI_PROVIDER / AGENT_MODEL switch decides. */
  route?: (env: Env) => { provider: string; model: string };
  maxTokens: number;
  timeoutMs: number;
  /** Total attempts including the first; the gateway backs off between them. */
  maxAttempts: number;
  /** Data older than this makes the call abstain (data_stale) when the caller says how old the data is. */
  freshnessMs?: number;
  /** The prompt tells the model it may reply "ABSTAIN: <reason>"; the gateway turns that into an abstain result. */
  abstainProtocol?: boolean;
};

const ANTHROPIC_ANALYSIS = () => ({ provider: "anthropic", model: "claude-sonnet-5-5" });

const P = (p: PurposeDef): PurposeDef => p;

export const PURPOSES: PurposeDef[] = [
  P({
    id: "rm.talking_points", label: "RM talking points (rewrite of deterministic points)", agentKey: "rm_copilot", dataClass: "customer_facts",
    consent: { exempt: "The points are built from CRM facts with no names or contact details sent; the rewrite is shown only to the RM who owns the customer, on screen, and is advisory." },
    allowContactIdentifiers: false, allowNumbers: true, allowNames: false, prompt: { id: "rm.talking_points", version: "1" },
    maxTokens: 300, timeoutMs: 20_000, maxAttempts: 2,
  }),
  P({
    id: "summary.page", label: "Page summaries (CRM fact sheets)", agentKey: "ai_summaries", dataClass: "customer_facts",
    consent: { exempt: "The fact sheet is built from CRM fields with free text already redacted, scoped to what the asking user may open; it is not chat content. Whether it needs a ledger purpose is an open question (docs/ai-gateway.md, backlog)." },
    allowContactIdentifiers: false, allowNumbers: true, allowNames: true, prompt: { id: "summary.page", version: "1" },
    route: (env) => ({ provider: "openai", model: env.OPENAI_SUMMARY_MODEL || "gpt-4o-mini" }),
    maxTokens: 600, timeoutMs: 60_000, maxAttempts: 2,
  }),
  P({
    id: "ask.intelligence", label: "Ask the system (management Q&A)", agentKey: "intelligence_ask", dataClass: "customer_facts",
    consent: { exempt: "Read-only tools return rows already scoped to the asker's own customers by the access policy; customer names are stated back to the asker. Open question: a ledger purpose for management analytics (docs/ai-gateway.md, backlog)." },
    allowContactIdentifiers: false, allowNumbers: true, allowNames: true, prompt: { id: "ask.intelligence", version: "1" },
    route: ANTHROPIC_ANALYSIS, maxTokens: 1024, timeoutMs: 60_000, maxAttempts: 2,
  }),
  P({
    id: "insight.extract", label: "Insight extraction from conversations", agentKey: "insight_extractor", dataClass: "customer_text",
    consent: { purpose: "AI_PROCESSING_OF_CHATS", channel: null },
    allowContactIdentifiers: true, allowNames: true, prompt: { id: "insight.extract", version: "1" },
    route: ANTHROPIC_ANALYSIS, maxTokens: 2048, timeoutMs: 90_000, maxAttempts: 2,
  }),
  P({
    id: "conversation.analyze", label: "Quality-audit analysis of a call or chat", agentKey: "conversation_analysis", dataClass: "customer_text",
    consent: { purpose: "AI_PROCESSING_OF_CHATS", channel: null },
    allowContactIdentifiers: true, allowNames: true, prompt: { id: "conversation.analyze", version: "1" },
    route: ANTHROPIC_ANALYSIS, maxTokens: 2048, timeoutMs: 90_000, maxAttempts: 2,
  }),
  P({
    // Quality flags over a stored call or chat. Writes AuditFinding rows for a person to review; never writes to a customer. No names, no contact details.
    id: "audit.flags", label: "Quality flags on a stored call or chat (for a person to review; writes no customer message)", agentKey: "conversation_analysis", dataClass: "customer_text",
    consent: { purpose: "AI_PROCESSING_OF_CHATS", channel: null },
    allowContactIdentifiers: false, allowNames: false, prompt: { id: "audit.flags", version: "1" },
    route: ANTHROPIC_ANALYSIS, maxTokens: 300, timeoutMs: 60_000, maxAttempts: 2,
  }),
  P({
    id: "memory.extract", label: "Customer memory drafts from conversation notes", agentKey: "memory_extractor", dataClass: "customer_text",
    consent: { purpose: "AI_PROCESSING_OF_CHATS", channel: null },
    // The notes are scrubbed of phone numbers, emails and PAN-shaped codes before they are sent (memory/propose.ts) and the model never needs the name.
    allowContactIdentifiers: false, allowNames: false, abstainProtocol: true, prompt: { id: "memory.extract", version: "1" },
    route: ANTHROPIC_ANALYSIS, maxTokens: 1500, timeoutMs: 30_000, maxAttempts: 2,
  }),
  P({
    id: "voc.tag", label: "Voice of customer: theme tags for complaint and feedback text (management summary only, never sent to a customer)", agentKey: null, dataClass: "customer_text",
    consent: { purpose: "AI_PROCESSING_OF_CHATS", channel: null },
    // The text is redacted (voc/redact.ts) before it reaches here; the model never needs the name. Only the subject's opaque id is passed.
    allowContactIdentifiers: false, allowNames: false, abstainProtocol: true, prompt: { id: "voc.tag", version: "1" },
    route: ANTHROPIC_ANALYSIS, maxTokens: 120, timeoutMs: 30_000, maxAttempts: 2,
  }),
  P({
    id: "nudger.draft", label: "WhatsApp nudge draft", agentKey: "wa_nudger", dataClass: "customer_identifiers",
    consent: { purpose: "MARKETING_COMMS", channel: "whatsapp" },
    allowContactIdentifiers: false, allowNames: true, prompt: { id: "nudger.draft", version: "1" },
    maxTokens: 300, timeoutMs: 20_000, maxAttempts: 2,
  }),
  P({
    id: "reply.suggest", label: "WhatsApp reply suggestion", agentKey: "wa_reply", dataClass: "customer_text",
    consent: { purpose: "AI_PROCESSING_OF_CHATS", channel: "whatsapp" },
    allowContactIdentifiers: false, allowNames: true, prompt: { id: "reply.suggest", version: "1" },
    maxTokens: 300, timeoutMs: 20_000, maxAttempts: 2,
  }),
  P({
    // AI execution layer (08): a draft message for a person to approve. Draft only: nothing is sent from this purpose. The agent has no per-agent switch (global_only), so it is on by default.
    id: "conversation.draft", label: "Customer conversation draft (a person approves before anything is sent)", agentKey: "conversation_drafter", dataClass: "customer_text",
    consent: { purpose: "AI_PROCESSING_OF_CHATS", channel: "whatsapp" },
    allowContactIdentifiers: false, allowNames: true, prompt: { id: "conversation.draft", version: "1" },
    maxTokens: 300, timeoutMs: 30_000, maxAttempts: 2,
  }),
  P({
    id: "social.draft", label: "Social post draft", agentKey: "social_drafter", dataClass: "none",
    consent: null, allowContactIdentifiers: false, allowNames: false, prompt: { id: "social.draft", version: "1" },
    maxTokens: 900, timeoutMs: 30_000, maxAttempts: 2,
  }),
  P({
    id: "autopilot.ask", label: "Ask Autopilot: choose read-only tools for a question about ads", agentKey: "ad_autopilot", dataClass: "aggregate",
    consent: null, allowContactIdentifiers: false, allowNames: false, prompt: { id: "autopilot.ask", version: "1" },
    route: ANTHROPIC_ANALYSIS, maxTokens: 200, timeoutMs: 15_000, maxAttempts: 1,
  }),
  P({
    id: "autopilot.rule_draft", label: "Autopilot: draft a rule from a plain-language sentence (a person reviews and saves it)", agentKey: "ad_autopilot", dataClass: "aggregate",
    consent: null, allowContactIdentifiers: false, allowNames: false, prompt: { id: "autopilot.rule_draft", version: "1" },
    route: ANTHROPIC_ANALYSIS, maxTokens: 400, timeoutMs: 20_000, maxAttempts: 1, abstainProtocol: true,
  }),
  P({
    id: "creative.brief", label: "Creative brief generation (master hook, USP, call to action)", agentKey: "creative_drafter", dataClass: "none",
    consent: null, allowContactIdentifiers: false, allowNames: false, prompt: { id: "creative.brief", version: "1" },
    maxTokens: 500, timeoutMs: 30_000, maxAttempts: 2, abstainProtocol: true,
  }),
  P({
    id: "creative.copy", label: "Ad copy drafts per channel format", agentKey: "creative_drafter", dataClass: "none",
    consent: null, allowContactIdentifiers: false, allowNames: false, prompt: { id: "creative.copy", version: "1" },
    maxTokens: 2500, timeoutMs: 45_000, maxAttempts: 2, abstainProtocol: true,
  }),
  P({
    id: "creative.tags", label: "Tag suggestions for a live ad (format, hook, offer, length, call to action)", agentKey: "creative_drafter", dataClass: "none",
    consent: null, allowContactIdentifiers: false, allowNames: false, prompt: { id: "creative.tags", version: "1" },
    maxTokens: 150, timeoutMs: 20_000, maxAttempts: 2,
  }),
  P({
    id: "planner.copy", label: "Campaign planner copy draft", agentKey: "planner_copy", dataClass: "none",
    consent: null, allowContactIdentifiers: false, allowNames: false, prompt: { id: "planner.copy", version: "1" },
    maxTokens: 700, timeoutMs: 30_000, maxAttempts: 2, abstainProtocol: true,
  }),
  P({
    id: "content.draft", label: "Content engine draft (post or ad variant from an approved brief; a person approves every draft)", agentKey: null, dataClass: "none",
    consent: null, allowContactIdentifiers: false, allowNames: false, prompt: { id: "content.draft", version: "1" },
    maxTokens: 600, timeoutMs: 45_000, maxAttempts: 2, abstainProtocol: true,
  }),
  P({
    id: "content.judge", label: "Content engine second-layer judge (reviews a draft after the ad-copy rules; can only add caution, a person decides)", agentKey: null, dataClass: "none",
    consent: null, allowContactIdentifiers: false, allowNames: false, prompt: { id: "content.judge", version: "1" },
    maxTokens: 300, timeoutMs: 30_000, maxAttempts: 1,
  }),
  P({
    id: "compliance.judge", label: "Second-layer compliance judge", agentKey: null, dataClass: "customer_facts",
    consent: { exempt: "Judges text the system itself drafted, after the drafting agent's own consent gate has passed; it fails closed on any error." },
    allowContactIdentifiers: false, allowNumbers: true, allowNames: true, prompt: { id: "compliance.judge", version: "1" },
    maxTokens: 60, timeoutMs: 20_000, maxAttempts: 1,
  }),
];

const BY_ID = new Map(PURPOSES.map((p) => [p.id, p]));
export const getPurpose = (id: string): PurposeDef | undefined => BY_ID.get(id);
export const isDataClass = (v: string): v is DataClass => (DATA_CLASSES as readonly string[]).includes(v);

/** The consent requirement as a ledger check, or null when the purpose needs none or is exempt. */
export function consentRequirement(p: PurposeDef): { purpose: ConsentPurpose; channel: ConsentChannel | null } | null {
  return p.consent && "purpose" in p.consent ? p.consent : null;
}
