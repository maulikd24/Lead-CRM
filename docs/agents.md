# AI agents (WhatsApp drafts)

Agents prepare drafts. They never send anything on their own.

- Draft-only: an agent reads a conversation and proposes a message. The proposal waits in "Agent drafts".
- Per-message approval: nothing is sent until the assigned RM or an Admin approves that specific message.
- Kill switch: an agent runs only when BOTH the `AGENT_NUDGER_ENABLED=1` environment flag (only the exact value `1`) and its enabled row in `AgentSetting` are on. Turning either off stops new drafts.
- Guardrails: every draft passes a regex check and an LLM judge before it is shown. A draft that fails is not offered.
- Production enablement requires a recorded compliance sign-off (including the data-protection notice and lawful basis for processing chat content). That record is kept outside this repository.

## Suggested replies in the inbox (`wa_reply`)

A two-way assistant that drafts a reply to a customer's WhatsApp message. The RM reads, edits and presses Send; the assistant never sends.

- Flags (all off by default): `WA_ASSIST_ENABLED=1` (exact value `1`) AND an enabled `AgentSetting` row for `wa_reply` (same kill switch as the nudger). `WA_ASSIST_AUTO=1` additionally drafts once when an RM opens a conversation whose last message is an unanswered customer message. With the flags off the panel is not rendered at all.
- No coupling to message ingest: the model is called only from inbox server actions ("Suggest a reply", or auto on open). There is no cron batch and no change to `src/lib/whatsapp/ingest.ts`.
- What the vendor sees: first name, language (English, Hindi or Hinglish, mirrored from the customer's latest message), programme, a fixed reason category, and the last up to 6 messages labelled Customer/RM. The excerpt strips phone numbers, emails, PAN, any 6+ digit run and link query strings, drops the customer's surname, caps each message at 300 characters and the total at 1200. Briefing free text and history never leave. The briefing is the side-effect-free `buildAgentBriefing(clientId, { persist: false })`.
- Behaviour rules in the prompt: answer only the question, briefly; no advice, returns or recommendations; never invent account facts; ask a clarifying question or offer a call when unsure; conversation text is treated as untrusted.
- Safety: every draft passes the regex guardrail and the LLM judge. A failure is stored as `BLOCKED`, shown as "Could not draft safely" (the text is never shown), and never sent.
- Handover: if any unanswered customer message trips `needsHandover` (complaint, regulator, fraud, refund and similar words) no model call is made. A `BLOCKED` proposal with reason `HANDOVER: ...` is stored, the panel shows a banner, and the assigned RM gets a task and an `agent_handover` notification. This deliberately does not call `recordInteractionOutcome(RM_HANDOVER)`: that path persists intelligence and can enrol journeys that send without approval.
- One open suggestion per conversation (a conversation is one client). A newer customer message, or Regenerate, expires the previous open draft with the compare-and-set transition `DRAFT -> EXPIRED`. Drafts expire after 24 hours. The inbox hides `wa_reply` rows from the "Agent drafts" page.
- Outcome metrics use existing columns, no new enum: `SENT` with `body = originalBody` is used as is, `SENT` with a different `body` was edited, `REJECTED` is dismissed, `EXPIRED` is superseded or regenerated, `BLOCKED` is blocked or a handover (`usageOf` in `reply-assist-lifecycle.ts`). `decidedById`/`decidedAt` record who and when; `inputTokens`/`outputTokens` hold the draft call's token counts (the judge call is not counted).
- 24-hour service window (`src/lib/whatsapp/service-window.ts`): applies only to conversations carried by the Meta Cloud API provider (`Message.provider = whatsapp_meta`). Outside the window the composer is replaced by a warning and `sendReplyAction` refuses free text; only approved templates are allowed. WhatsApp-Web style (linked-device) accounts are not subject to the rule, so `templateRequired` is always false for them. The inbox currently lists linked-device accounts only.
- Production enablement needs the same recorded compliance sign-off as the nudger.
