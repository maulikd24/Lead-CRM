export type QualityCriterion = {
  key: string;
  label: string;
  maxScore: number;
  description: string;
};

/**
 * Fixed rubric for scoring how a call or WhatsApp conversation was handled — a TS const rather
 * than an admin-configurable DB rubric, following the same house style as DEFAULT_DOCUMENT_TYPES
 * (src/lib/stage-engine/transitions.ts) and Settings → Stages' "fixed sequence" stance. An
 * admin-configurable rubric builder is a reasonable Phase 2, not needed for this pass.
 *
 * Scores sum to 100 — ConversationReview.qualityScore is the sum of the per-criterion scores
 * Claude returns in ConversationReview.qualityBreakdown.
 */
export const QUALITY_RUBRIC: QualityCriterion[] = [
  {
    key: "greeting_introduction",
    label: "Greeting & Introduction",
    maxScore: 10,
    description: "Did the RM greet the client professionally and clearly introduce themselves and the firm?",
  },
  {
    key: "needs_discovery",
    label: "Needs Discovery",
    maxScore: 25,
    description: "Did the RM ask good questions to understand the client's goals, concerns, and current situation before recommending anything?",
  },
  {
    key: "compliance_disclosure",
    label: "Compliance & Disclosure",
    maxScore: 20,
    description: "Did the RM mention required risk disclosures, fees, or other compliance-relevant information where appropriate, without making guarantees about returns?",
  },
  {
    key: "objection_handling",
    label: "Objection Handling",
    maxScore: 20,
    description: "When the client raised concerns, hesitations, or objections, did the RM address them calmly, honestly, and helpfully rather than being dismissive or pushy?",
  },
  {
    key: "clarity_and_tone",
    label: "Clarity & Professional Tone",
    maxScore: 15,
    description: "Was the RM's communication clear, polite, and easy to follow, avoiding jargon the client wouldn't understand?",
  },
  {
    key: "next_steps_closing",
    label: "Next Steps & Closing",
    maxScore: 10,
    description: "Did the conversation end with a clear next step or action item agreed with the client, rather than trailing off ambiguously?",
  },
];
