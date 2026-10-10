import { other, rec } from "./builders";
import type { EvalCase } from "../types";

const D = (d: string) => `2026-${d}T08:00:00Z`;
const MK = "MARKETING_COMMS", SV = "SERVICE_COMMS", AI = "AI_PROCESSING_OF_CHATS", DNC = "DO_NOT_CONTACT";

const c = (expect: "block" | "allow", spec: Omit<Extract<EvalCase, { kind: "consent" }>, "id" | "category" | "lang" | "expect" | "kind">, note: string): EvalCase =>
  other("consent", "en", { expect, kind: "consent", note, ...spec });

/** The consent gate used by the nudger (marketing, whatsapp) and the reply assist (AI processing of chats). Enforcement is a flag; off means allow. */
export const CONSENT_CASES: EvalCase[] = [
  c("block", { purpose: MK, channel: "whatsapp", enforced: true, records: [] }, "marketing needs an opt-in: no record"),
  c("block", { purpose: MK, channel: "whatsapp", enforced: true, records: [rec(MK, "whatsapp", "WITHDRAWN", D("09-01"))] }, "withdrawn"),
  c("block", { purpose: MK, channel: "whatsapp", enforced: true, records: [rec(MK, "whatsapp", "GRANTED", D("01-01"), D("09-01"))] }, "grant expired"),
  c("block", { purpose: MK, channel: "whatsapp", enforced: true, records: [rec(MK, "whatsapp", "GRANTED", D("09-01")), rec(MK, "whatsapp", "WITHDRAWN", D("10-01"))] }, "grant then later withdrawal"),
  c("block", { purpose: MK, channel: "whatsapp", enforced: true, records: [rec(MK, "sms", "GRANTED", D("09-01"))] }, "consent for another channel does not cover whatsapp"),
  c("block", { purpose: MK, channel: "whatsapp", enforced: true, records: [rec(MK, null, "GRANTED", D("09-01")), rec(DNC, null, "GRANTED", D("09-15"))] }, "do-not-contact overrides a grant"),
  c("block", { purpose: MK, channel: "whatsapp", enforced: true, records: [rec(MK, "whatsapp", "GRANTED", "2027-01-01T00:00:00Z")] }, "a grant dated in the future is not in effect yet"),
  c("block", { purpose: SV, channel: "whatsapp", enforced: true, records: [rec(SV, "whatsapp", "WITHDRAWN", D("09-01"))] }, "service messages: explicit withdrawal still blocks"),
  c("block", { purpose: SV, channel: "whatsapp", enforced: true, records: [rec(DNC, "whatsapp", "GRANTED", D("09-01"))] }, "do-not-contact blocks service messages too"),
  c("block", { purpose: AI, channel: "whatsapp", enforced: true, records: [] }, "AI processing of chats needs an opt-in"),
  c("block", { purpose: AI, channel: "whatsapp", enforced: true, records: [rec(AI, "whatsapp", "WITHDRAWN", D("09-01"))] }, "AI processing withdrawn"),
  c("block", { purpose: AI, channel: "whatsapp", enforced: true, records: [rec(AI, "whatsapp", "GRANTED", D("01-01"), D("09-01"))] }, "AI processing grant expired"),
  c("allow", { purpose: MK, channel: "whatsapp", enforced: true, records: [rec(MK, "whatsapp", "GRANTED", D("09-01"))] }, "a current grant"),
  c("allow", { purpose: MK, channel: "whatsapp", enforced: true, records: [rec(MK, null, "GRANTED", D("09-01"))] }, "an all-channel grant covers whatsapp"),
  c("allow", { purpose: MK, channel: "whatsapp", enforced: true, records: [rec(MK, "whatsapp", "WITHDRAWN", D("08-01")), rec(MK, "whatsapp", "GRANTED", D("09-01"))] }, "re-granted after a withdrawal"),
  c("allow", { purpose: MK, channel: "whatsapp", enforced: true, records: [], legacyMarketingConsentAt: D("05-01") }, "legacy lead-form consent counts for marketing"),
  c("allow", { purpose: SV, channel: "whatsapp", enforced: true, records: [] }, "service messages are allowed without an opt-in"),
  c("allow", { purpose: AI, channel: "whatsapp", enforced: true, records: [rec(AI, "whatsapp", "GRANTED", D("09-01"))] }, "AI processing granted"),
  c("allow", { purpose: MK, channel: "whatsapp", enforced: true, records: [], recordOnly: MK }, "record-only purpose never blocks"),
  c("allow", { purpose: MK, channel: "whatsapp", enforced: false, records: [] }, "enforcement flag off: nothing is read or blocked"),
  c("allow", { purpose: AI, channel: "whatsapp", enforced: false, records: [rec(AI, "whatsapp", "WITHDRAWN", D("09-01"))] }, "flag off ignores even a withdrawal (default-off rollout)"),
  c("block", { purpose: MK, channel: "whatsapp", enforced: true, records: [rec(MK, "whatsapp", "GRANTED", D("09-01")), rec(DNC, "whatsapp", "GRANTED", D("09-20")), rec(DNC, "whatsapp", "WITHDRAWN", D("09-25")), rec(MK, "whatsapp", "WITHDRAWN", D("09-26"))] }, "do-not-contact lifted, but marketing withdrawn after"),
  c("allow", { purpose: MK, channel: "whatsapp", enforced: true, records: [rec(MK, "whatsapp", "GRANTED", D("09-01")), rec(DNC, "whatsapp", "GRANTED", D("09-20")), rec(DNC, "whatsapp", "WITHDRAWN", D("09-25"))] }, "do-not-contact lifted again"),
];

const w = (expect: "block" | "allow", provider: string | null, lastInboundMinutesAgo: number | null, enforced: boolean, note: string): EvalCase =>
  other("out_of_window", "en", { expect, kind: "window", provider, lastInboundMinutesAgo, enforced, note });

/** WhatsApp's 24-hour customer-service window (Meta Cloud API only, behind WA_META_WINDOW=1). */
export const WINDOW_CASES: EvalCase[] = [
  w("block", "whatsapp_meta", 24 * 60, true, "exactly 24h: the window is strictly shorter than 24h"),
  w("block", "whatsapp_meta", 24 * 60 + 1, true, "just past 24h"),
  w("block", "whatsapp_meta", 3 * 24 * 60, true, "three days"),
  w("block", "whatsapp_meta", 30 * 24 * 60, true, "a month"),
  w("block", "whatsapp_meta", null, true, "the customer never wrote: only a template may start"),
  w("allow", "whatsapp_meta", 24 * 60 - 1, true, "one minute left"),
  w("allow", "whatsapp_meta", 1, true, "a minute ago"),
  w("allow", "whatsapp_meta", 0, true, "just now"),
  w("allow", "whatsapp_meta", 12 * 60, true, "twelve hours"),
  w("allow", "whatsapp_web", 5 * 24 * 60, true, "linked-device account: the window rule does not apply"),
  w("allow", null, 5 * 24 * 60, true, "unknown provider: the window rule does not apply (documented)"),
  w("allow", "whatsapp_meta", 5 * 24 * 60, false, "flag off: no enforcement (default)"),
  w("allow", "whatsapp_meta", null, false, "flag off, never wrote: no enforcement (default)"),
  w("block", "whatsapp_meta", 25 * 60, true, "25 hours"),
];
