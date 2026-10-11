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
    id: "social.draft", label: "Social post draft", agentKey: "social_drafter", dataClass: "none",
    consent: null, allowContactIdentifiers: false, allowNames: false, prompt: { id: "social.draft", version: "1" },
    maxTokens: 900, timeoutMs: 30_000, maxAttempts: 2,
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
