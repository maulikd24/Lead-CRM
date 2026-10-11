import { z } from "zod";

import type { DataClass } from "@/lib/ai/gateway/types";
import type { ConsentPurpose } from "@/lib/consent/policy";

import { ENV_FLAG_BY_AGENT } from "./enabled";
import { AUTONOMY_LEVELS, type ActionTypeId, type AutonomyLevel } from "./autonomy";

/**
 * THE agent registry: every agent as code-defined data with the contract fields from the agent architecture (ADR-6). It is data,
 * not behaviour. Runtime state lives elsewhere and is read, never defaulted here: the kill switch is the existing AgentSetting row
 * plus the agent's env flag (enabled.ts), and the autonomy level per (agent, action type) is the AgentAutonomy row, capped by the
 * ceilings in autonomy.ts. registry.test.ts lints the whole table.
 */

/** Always prohibited for every agent. An agent entry may add to this list, never remove from it. */
export const BASE_PROHIBITED = ["send_message", "change_ad_spend", "move_money", "write_consent", "delete_data", "change_roles"] as const;

/** The tools an agent may be given (AGENT_ARCHITECTURE section 4). Typed functions with a declared scope, never free API access. */
export const TOOL_REGISTRY = ["read_customer_context", "read_conversation_window", "propose_message_draft", "propose_memory_item", "propose_task", "propose_ad_action", "classify_text"] as const;
export type ToolName = (typeof TOOL_REGISTRY)[number];
/** Never registered, never allowed: humans and approved workflows do these through their existing guarded routes. */
export const FORBIDDEN_TOOLS = /^(send_|apply_ad_change|create_payout|write_consent|merge_clients|delete_)/;

export type KillSwitch =
  | { kind: "flag_and_setting"; envFlag: string; settingKey: string }
  | { kind: "global_only"; note: string };

export type AgentActionEntry = { actionType: ActionTypeId; defaultLevel: AutonomyLevel; maxLevel: AutonomyLevel };

export type AgentDef = {
  key: string;
  version: string;
  /** A role, never a person's name. */
  owner: string;
  purpose: string;
  allowedTools: ToolName[];
  prohibitedActions: string[];
  dataPermissions: { entities: string[]; maskedFields: string[]; dataClassCeiling: DataClass; roles: string[]; consent: ConsentPurpose | "exempt" | "none" };
  approval: { required: "always" | "policy" | "none"; approverRole: string | null; via: string };
  inputSchema: z.ZodType;
  outputSchema: z.ZodType;
  audit: { agentRun: boolean; auditAction: string | null };
  /** Eval categories (agents/evals) that must be green before this agent's autonomy can be raised. null = no suite yet, so no raise is possible. */
  evalSuite: { categories: string[]; ref: string } | null;
  fallback: string;
  timeoutMs: number;
  tokenBudgetPerRun: number;
  killSwitch: KillSwitch;
  flags: string[];
  /** Gateway purposes this agent may use (ai/gateway/purposes.ts). Empty: the agent never calls a model. */
  purposes: string[];
  actions: AgentActionEntry[];
};

const draftSchema = z.object({ text: z.string().min(1).max(1000) });
const reasonSchema = z.object({ clientId: z.string(), reasonCategory: z.string().optional() });
const GUARDRAIL_SUITE = ["guaranteed_returns", "advice", "performance_claim", "pii_echo_outbound", "benign", "evasion", "judge"];
const flagAndSetting = (key: string): KillSwitch => ({ kind: "flag_and_setting", envFlag: ENV_FLAG_BY_AGENT[key], settingKey: key });

export const AGENTS: AgentDef[] = [
  {
    key: "wa_nudger", version: "1", owner: "growth-lead",
    purpose: "Draft one short WhatsApp onboarding nudge for a customer whose next best action is KYC, funding or a first transaction.",
    allowedTools: ["read_customer_context", "propose_message_draft"], prohibitedActions: [...BASE_PROHIBITED],
    dataPermissions: { entities: ["Client", "CustomerIntelligence"], maskedFields: ["phone", "email", "pan", "surname"], dataClassCeiling: "customer_identifiers", roles: ["RM", "MANAGER", "ADMIN"], consent: "MARKETING_COMMS" },
    approval: { required: "always", approverRole: "RM", via: "AgentProposal (approve in Agent drafts)" },
    inputSchema: reasonSchema, outputSchema: draftSchema, audit: { agentRun: true, auditAction: "agent.proposal.decide" },
    evalSuite: { categories: [...GUARDRAIL_SUITE, "consent", "pipeline_nudger", "pii_vendor_payload"], ref: "evals: guardrails, judge, consent, nudger pipeline, vendor payload" },
    fallback: "Skip the customer: no draft is created and the next tick may try again.", timeoutMs: 20_000, tokenBudgetPerRun: 700,
    killSwitch: flagAndSetting("wa_nudger"), flags: ["AGENT_NUDGER_ENABLED"], purposes: ["nudger.draft", "compliance.judge"],
    actions: [{ actionType: "draft_customer_message", defaultLevel: 3, maxLevel: 4 }],
  },
  {
    key: "wa_reply", version: "1", owner: "growth-lead",
    purpose: "Suggest one reply in the WhatsApp inbox for the assigned RM to edit and send, and detect when a person must take over.",
    allowedTools: ["read_conversation_window", "propose_message_draft"], prohibitedActions: [...BASE_PROHIBITED],
    dataPermissions: { entities: ["Message", "Client", "CustomerIntelligence"], maskedFields: ["phone", "email", "pan", "surname"], dataClassCeiling: "customer_text", roles: ["RM", "MANAGER", "ADMIN"], consent: "AI_PROCESSING_OF_CHATS" },
    approval: { required: "always", approverRole: "RM", via: "the RM presses send in the inbox composer" },
    inputSchema: reasonSchema, outputSchema: draftSchema, audit: { agentRun: true, auditAction: null },
    evalSuite: { categories: [...GUARDRAIL_SUITE, "consent", "handover", "handover_benign", "out_of_window", "pipeline_reply", "pii_vendor_scrub", "pii_vendor_payload"], ref: "evals: guardrails, judge, consent, handover, window, reply pipeline, vendor scrub" },
    fallback: "Show no suggestion; a person answers.", timeoutMs: 20_000, tokenBudgetPerRun: 900,
    killSwitch: flagAndSetting("wa_reply"), flags: ["WA_ASSIST_ENABLED", "WA_ASSIST_AUTO"], purposes: ["reply.suggest", "compliance.judge"],
    actions: [{ actionType: "suggest_reply", defaultLevel: 3, maxLevel: 4 }],
  },
  {
    key: "social_drafter", version: "1", owner: "marketing-lead",
    purpose: "Draft one educational social post that a compliance officer reviews; mandatory disclosures are added by code.",
    allowedTools: ["propose_message_draft", "classify_text"], prohibitedActions: [...BASE_PROHIBITED, "publish_post"],
    dataPermissions: { entities: [], maskedFields: [], dataClassCeiling: "none", roles: ["MARKETING", "ADMIN"], consent: "none" },
    approval: { required: "always", approverRole: "COMPLIANCE", via: "SocialPost four-eyes approval" },
    inputSchema: z.object({ brief: z.string().max(500), channel: z.string() }), outputSchema: draftSchema, audit: { agentRun: true, auditAction: "social.post.decide" },
    evalSuite: { categories: GUARDRAIL_SUITE, ref: "evals: guardrails and judge" },
    fallback: "Return no draft; the author writes the post.", timeoutMs: 30_000, tokenBudgetPerRun: 1500,
    killSwitch: flagAndSetting("social_drafter"), flags: ["SOCIAL_DRAFTS_ENABLED"], purposes: ["social.draft", "compliance.judge"],
    actions: [{ actionType: "draft_public_post", defaultLevel: 3, maxLevel: 4 }],
  },
  {
    key: "creative_drafter", version: "1", owner: "marketing-lead",
    purpose: "Draft a creative brief (master hook, USP, call to action), ad copy for each channel format, and tag suggestions for live ads. L3 draft only: every variant passes the shared ad copy check and a human approval, the disclaimers are added by code, nothing is published or placed.",
    allowedTools: ["propose_message_draft", "classify_text"], prohibitedActions: [...BASE_PROHIBITED, "publish_ad"],
    dataPermissions: { entities: [], maskedFields: [], dataClassCeiling: "none", roles: ["MARKETING", "ADMIN"], consent: "none" },
    approval: { required: "always", approverRole: "MARKETING", via: "CreativeVariant approval (canonical kind ad-creative: review in the Briefs tab or the Approvals inbox)" },
    inputSchema: z.object({ brief: z.string().max(500), formats: z.array(z.string()).min(1) }), outputSchema: draftSchema, audit: { agentRun: true, auditAction: "creative_variant_approved" },
    evalSuite: { categories: [...GUARDRAIL_SUITE, "ad_returns", "ad_advice", "ad_performance", "ad_testimonial", "ad_pressure", "ad_claims", "ad_identifier", "ad_benign"], ref: "evals: guardrails, judge and ad copy" },
    fallback: "Return no draft; the author writes the copy from the templates.", timeoutMs: 45_000, tokenBudgetPerRun: 3500,
    killSwitch: flagAndSetting("creative_drafter"), flags: ["NEXT_PUBLIC_CREATIVE_INTEL"], purposes: ["creative.brief", "creative.copy", "creative.tags", "compliance.judge"],
    actions: [{ actionType: "draft_ad_copy", defaultLevel: 3, maxLevel: 3 }],
  },
  {
    key: "planner_copy", version: "1", owner: "marketing-lead",
    purpose: "Draft one piece of campaign copy for a plan's channel from the plan's promise and audience; the disclaimer is added by code. L3 draft only: a person reviews every draft, and it can never be approved by the person who asked for it.",
    allowedTools: ["propose_message_draft", "classify_text"], prohibitedActions: [...BASE_PROHIBITED, "publish_post"],
    dataPermissions: { entities: [], maskedFields: [], dataClassCeiling: "none", roles: ["MARKETING", "ADMIN"], consent: "none" },
    approval: { required: "always", approverRole: "COMPLIANCE", via: "PlannerCopy review by a different person, then plan approval through the canonical planner-plan approval" },
    inputSchema: z.object({ planId: z.string(), channel: z.string() }), outputSchema: draftSchema, audit: { agentRun: true, auditAction: null },
    evalSuite: { categories: GUARDRAIL_SUITE, ref: "evals: guardrails and judge" },
    fallback: "Return no draft; the author writes the copy.", timeoutMs: 30_000, tokenBudgetPerRun: 1500,
    killSwitch: flagAndSetting("planner_copy"), flags: ["PLANNER_AI_COPY_ENABLED"], purposes: ["planner.copy", "compliance.judge"],
    actions: [{ actionType: "draft_public_post", defaultLevel: 3, maxLevel: 3 }],
  },
  {
    key: "outcomes_review", version: "1", owner: "growth-lead",
    purpose: "Draft goal check-in messages from templates. Rule-based: it never calls a model.",
    allowedTools: ["propose_message_draft"], prohibitedActions: [...BASE_PROHIBITED],
    dataPermissions: { entities: ["Client", "Goal"], maskedFields: ["phone", "email", "pan"], dataClassCeiling: "customer_facts", roles: ["RM", "MANAGER", "ADMIN"], consent: "MARKETING_COMMS" },
    approval: { required: "always", approverRole: "RM", via: "AgentProposal (approve in Agent drafts)" },
    inputSchema: reasonSchema, outputSchema: draftSchema, audit: { agentRun: false, auditAction: "agent.proposal.decide" },
    evalSuite: { categories: GUARDRAIL_SUITE, ref: "evals: guardrails" },
    fallback: "Create no draft.", timeoutMs: 5_000, tokenBudgetPerRun: 0,
    killSwitch: flagAndSetting("outcomes_review"), flags: ["OUTCOMES_DRAFTS_ENABLED"], purposes: [],
    actions: [{ actionType: "draft_customer_message", defaultLevel: 3, maxLevel: 4 }],
  },
  {
    key: "lead_first_message", version: "1", owner: "growth-lead",
    purpose: "Draft one short first message for the assigned RM when a new lead arrives, from a fixed template. Rule-based: it never calls a model. L3 draft only; the RM approves, and consent is checked again at send.",
    allowedTools: ["propose_message_draft"], prohibitedActions: [...BASE_PROHIBITED],
    dataPermissions: { entities: ["Client", "LeadPush"], maskedFields: ["phone", "email", "pan", "surname"], dataClassCeiling: "customer_facts", roles: ["RM", "ADMIN"], consent: "MARKETING_COMMS" },
    approval: { required: "always", approverRole: "RM", via: "AgentProposal, canonical kind lead-push-draft (approve in Agent drafts or the Approvals inbox)" },
    inputSchema: z.object({ clientId: z.string(), campaign: z.string().nullable() }), outputSchema: draftSchema, audit: { agentRun: false, auditAction: "agent.proposal.decide" },
    evalSuite: { categories: GUARDRAIL_SUITE, ref: "evals: guardrails" },
    fallback: "Create no draft; the RM still gets the lead push notification and calls.", timeoutMs: 5_000, tokenBudgetPerRun: 0,
    killSwitch: flagAndSetting("lead_first_message"), flags: ["LEAD_PUSH_DRAFTS_ENABLED"], purposes: [],
    actions: [{ actionType: "draft_customer_message", defaultLevel: 3, maxLevel: 3 }],
  },
  {
    key: "ad_autopilot", version: "1", owner: "growth-lead",
    purpose: "Audit the ad accounts daily from campaign aggregates and propose fixes (pause, trim a budget, add negatives, exclude placements, adjust a schedule). Also answers questions by choosing read-only tools and drafts a rule from a sentence. It only PROPOSES: a person approves each action (L4), the apply step to a live ad account is blocked by default, and a launch draft is created paused.",
    allowedTools: ["propose_ad_action", "classify_text"], prohibitedActions: [...BASE_PROHIBITED],
    dataPermissions: { entities: ["CampaignOutcome", "CampaignDay"], maskedFields: ["name", "phone", "email", "pan", "customer id"], dataClassCeiling: "aggregate", roles: ["MARKETING", "ADMIN"], consent: "none" },
    approval: { required: "always", approverRole: "MARKETING", via: "canonical kind autopilot-action (Autopilot Actions tab or the Approvals inbox); ADMIN may also decide" },
    inputSchema: z.object({ question: z.string().max(500) }), outputSchema: z.object({ tools: z.array(z.object({ tool: z.string(), args: z.record(z.string(), z.unknown()) })).max(3) }), audit: { agentRun: true, auditAction: "autopilot_approved" },
    evalSuite: null, fallback: "Ask answers from a fixed keyword router; rule drafting says it is unavailable; the daily audit and every proposal are rule-based and unaffected.", timeoutMs: 20_000, tokenBudgetPerRun: 1000,
    killSwitch: { kind: "global_only", note: "AUTOPILOT_ASK_ENABLED off stops Ask and rule drafting (checked before the gateway is called); AI_KILL_SWITCH stops every model call. The audit and every proposal are rule-based and need no model." }, flags: ["NEXT_PUBLIC_AUTOPILOT", "AUTOPILOT_ASK_ENABLED", "AUTOPILOT_DAILY_AUDIT_ENABLED"], purposes: ["autopilot.ask", "autopilot.rule_draft"],
    actions: [{ actionType: "answer_question", defaultLevel: 2, maxLevel: 2 }, { actionType: "change_ad_spend", defaultLevel: 2, maxLevel: 4 }],
  },
  {
    key: "ai_summaries", version: "1", owner: "platform-lead",
    purpose: "Summarise a CRM page from a redacted fact sheet, cached by content hash.",
    allowedTools: ["read_customer_context"], prohibitedActions: [...BASE_PROHIBITED],
    dataPermissions: { entities: ["Client", "Task", "Activity"], maskedFields: ["phone", "email", "pan"], dataClassCeiling: "customer_facts", roles: ["RM", "MANAGER", "ADMIN"], consent: "exempt" },
    approval: { required: "none", approverRole: null, via: "read-only summary shown to the asker" },
    inputSchema: z.object({ kind: z.string(), subjectKey: z.string(), facts: z.string() }), outputSchema: z.object({ summary: z.string().min(1) }), audit: { agentRun: true, auditAction: null },
    evalSuite: null, fallback: "Show an error; no summary is stored.", timeoutMs: 60_000, tokenBudgetPerRun: 1500,
    killSwitch: { kind: "global_only", note: "No per-feature kill switch exists today; only AI_KILL_SWITCH stops it (backlog)." }, flags: [], purposes: ["summary.page"],
    actions: [{ actionType: "summarise_page", defaultLevel: 2, maxLevel: 2 }],
  },
  {
    key: "intelligence_ask", version: "1", owner: "platform-lead",
    purpose: "Answer a management question by choosing from a fixed set of read-only tools scoped to the asker's customers.",
    allowedTools: ["read_customer_context", "classify_text"], prohibitedActions: [...BASE_PROHIBITED],
    dataPermissions: { entities: ["Client", "CustomerIntelligence"], maskedFields: ["phone", "email", "pan"], dataClassCeiling: "customer_facts", roles: ["RM", "MANAGER", "ADMIN"], consent: "exempt" },
    approval: { required: "none", approverRole: null, via: "read-only answer shown to the asker" },
    inputSchema: z.object({ question: z.string().max(500) }), outputSchema: z.object({ answer: z.string() }), audit: { agentRun: true, auditAction: null },
    evalSuite: null, fallback: "Say the question could not be answered.", timeoutMs: 60_000, tokenBudgetPerRun: 6000,
    killSwitch: { kind: "global_only", note: "No per-feature kill switch exists today; only AI_KILL_SWITCH stops it (backlog)." }, flags: [], purposes: ["ask.intelligence"],
    actions: [{ actionType: "answer_question", defaultLevel: 2, maxLevel: 2 }],
  },
  {
    key: "insight_extractor", version: "1", owner: "platform-lead",
    purpose: "Read calls, chats, RM notes and tickets and extract structured insights, each stored with its source.",
    allowedTools: ["read_conversation_window", "propose_memory_item", "propose_task"], prohibitedActions: [...BASE_PROHIBITED],
    dataPermissions: { entities: ["ConversationReview", "Activity"], maskedFields: ["pan"], dataClassCeiling: "customer_text", roles: ["ADMIN"], consent: "AI_PROCESSING_OF_CHATS" },
    approval: { required: "none", approverRole: null, via: "insights are advisory records; tasks created are the RM's own follow-ups" },
    inputSchema: z.object({ text: z.string(), sourceLabel: z.string() }), outputSchema: z.object({ insights: z.array(z.object({ kind: z.string(), text: z.string() })) }), audit: { agentRun: true, auditAction: null },
    evalSuite: null, fallback: "Leave the source unprocessed; the next tick retries.", timeoutMs: 90_000, tokenBudgetPerRun: 6000,
    killSwitch: { kind: "global_only", note: "No per-feature kill switch exists today; only AI_KILL_SWITCH stops it (backlog)." }, flags: [], purposes: ["insight.extract"],
    // As built: advisory rows written without waiting for a person. Recorded as L5 because the class is internal and reversible; owner to confirm.
    actions: [{ actionType: "extract_insights", defaultLevel: 5, maxLevel: 5 }],
  },
  {
    key: "conversation_analysis", version: "1", owner: "compliance-lead",
    purpose: "Score a call or chat against the quality rubric and recommend one follow-up for the RM.",
    allowedTools: ["read_conversation_window", "classify_text"], prohibitedActions: [...BASE_PROHIBITED],
    dataPermissions: { entities: ["ConversationReview"], maskedFields: ["pan"], dataClassCeiling: "customer_text", roles: ["ADMIN", "MANAGER"], consent: "AI_PROCESSING_OF_CHATS" },
    approval: { required: "none", approverRole: null, via: "advisory score; the follow-up task is the RM's own" },
    inputSchema: z.object({ transcript: z.string(), sourceType: z.enum(["CALL", "WHATSAPP_THREAD"]) }), outputSchema: z.object({ qualityScore: z.number() }), audit: { agentRun: true, auditAction: null },
    evalSuite: null, fallback: "Mark the review FAILED with the reason; a person can retry.", timeoutMs: 90_000, tokenBudgetPerRun: 6000,
    killSwitch: { kind: "global_only", note: "No per-feature kill switch exists today; only AI_KILL_SWITCH stops it (backlog)." }, flags: [], purposes: ["conversation.analyze"],
    actions: [{ actionType: "analyse_conversation", defaultLevel: 5, maxLevel: 5 }],
  },
  {
    key: "nba_engine", version: "1", owner: "growth-lead",
    purpose: "Compute one next-best-action decision per customer in SHADOW (stored for review, never shown to RMs by default, never sent). Rule-based: it never calls a model.",
    allowedTools: ["read_customer_context"], prohibitedActions: [...BASE_PROHIBITED],
    dataPermissions: { entities: ["Client", "CustomerIntelligence", "CustomerMemoryItem", "Complaint", "Commitment"], maskedFields: ["phone", "email", "pan"], dataClassCeiling: "customer_facts", roles: ["MANAGER", "ADMIN"], consent: "exempt" },
    approval: { required: "none", approverRole: null, via: "shadow decisions are reviewed on /decisions; accepting one creates a task, never a send" },
    inputSchema: z.object({ clientId: z.string() }), outputSchema: z.object({ result: z.enum(["RECOMMEND", "NO_ACTION", "ABSTAIN"]) }), audit: { agentRun: false, auditAction: null },
    evalSuite: { categories: ["decision_suppression", "decision_policy", "decision_abstain", "decision_allow"], ref: "evals: decision (suppression, policy, abstain, must-allow golden customers)" },
    fallback: "Store no decision; the existing next best action is unaffected.", timeoutMs: 10_000, tokenBudgetPerRun: 0,
    killSwitch: flagAndSetting("nba_engine"), flags: ["NBA_ENGINE_V2"], purposes: [],
    actions: [{ actionType: "propose_internal_record", defaultLevel: 2, maxLevel: 2 }],
  },
  {
    key: "memory_extractor", version: "1", owner: "platform-lead",
    purpose: "Read conversation notes about one customer and propose memory items (preferences, declared facts, goals, do-not-do requests). Draft only: every item is born UNCONFIRMED and a person confirms or rejects it in the Memory panel.",
    allowedTools: ["read_conversation_window", "propose_memory_item"], prohibitedActions: [...BASE_PROHIBITED],
    dataPermissions: { entities: ["ConversationInsight", "CustomerMemoryItem"], maskedFields: ["phone", "email", "pan", "surname"], dataClassCeiling: "customer_text", roles: ["ADMIN"], consent: "AI_PROCESSING_OF_CHATS" },
    approval: { required: "always", approverRole: "RM", via: "the Memory panel: a person confirms, edits, rejects or disputes every item" },
    inputSchema: z.object({ clientId: z.string() }), outputSchema: z.object({ items: z.array(z.object({ insightId: z.string(), class: z.string(), key: z.string(), quote: z.string() })) }), audit: { agentRun: true, auditAction: "memory.item.proposed" },
    evalSuite: { categories: ["memory_extract", "memory_vendor"], ref: "evals: memory extraction guards and what reaches the vendor" },
    fallback: "Propose nothing from the model; the deterministic mapping of existing insights still runs.", timeoutMs: 30_000, tokenBudgetPerRun: 1500,
    killSwitch: { kind: "global_only", note: "MEMORY_EXTRACTION_ENABLED switches the job off; AI_KILL_SWITCH stops the model call. No per-agent setting row yet (backlog)." }, flags: ["MEMORY_EXTRACTION_ENABLED"], purposes: ["memory.extract"],
    // Draft only (L3): the model's output is never stored as confirmed and never acted on.
    actions: [{ actionType: "propose_internal_record", defaultLevel: 3, maxLevel: 3 }],
  },
];

const BY_KEY = new Map(AGENTS.map((a) => [a.key, a]));
export const getAgent = (key: string): AgentDef | undefined => BY_KEY.get(key);
export const agentForPurpose = (purposeId: string): AgentDef | undefined => AGENTS.find((a) => a.purposes.includes(purposeId));
export const levelsOf = AUTONOMY_LEVELS;
