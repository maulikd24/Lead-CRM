# AI reply-assist pilot

The reply assistant writes a draft answer inside the Inbox. A relationship manager reads it, edits it and presses Send; the system never sends anything by itself. The pilot limits who sees it and keeps it off until three things are recorded.

## What must be true, in this order

1. **The agent is on.** `WA_ASSIST_ENABLED=1` in the environment and the Reply assistant kill switch on the Agents page (existing behaviour, unchanged).
2. **An AI provider key is saved in Settings.** An Admin pastes it on Settings, Reply assistant pilot. It is stored encrypted in the existing credentials table (provider name `ai_provider`) and is never shown again; only its last four characters are displayed. The pilot uses this key, not an environment key.
3. **Compliance sign-off is recorded.** The page shows the exact wording (versioned: `PILOT_STATEMENT_VERSION` in `src/lib/agents/pilot.ts`). Two different people sign (Wave 1, four-eyes): the compliance reviewer ticks the box first, then a DIFFERENT Admin countersigns, and only then does the pilot unlock; the database keeps who, when and the wording that was on screen for each signature. If the wording changes in a later release the old sign-off stops counting and must be recorded again. An Admin can withdraw it at any time.
4. **The person is on the list.** The list is empty by default, which means nobody. Only active relationship managers and Admins can be added (managers have a view-only inbox and cannot reply). Admins are not exempt: an Admin who is not listed does not see the assistant either.

The consent gate (`CONSENT_ENFORCEMENT`) and the draft-only rule sit underneath all of this and are unchanged.

## Where it is enforced

`src/lib/agents/reply-assist-service.ts` asks `pilotAccessFor(user.id)` before it reads a customer or builds a provider, for both the panel state and the draft request (including auto-draft). A user outside the pilot gets the same answer as when the feature is off: no panel, no model call, no message read.

Handover detection at message ingest (a model-free word check for complaints and regulator words) is a separate, flag-guarded job and is not part of the pilot: it writes a marker and notifies a person, and calls no AI provider.

## Settings and audit

- Page: `/settings/ai-pilot` (Admin only). The Agents page, Rules tab, tells every user whether they are in the pilot and why not.
- Every change writes an audit row (`entity = AiPilot`): `pilot_user_added`, `pilot_user_removed`, `pilot_signoff_recorded`, `pilot_signoff_revoked`, `ai_key_saved`, `ai_key_replaced`, `ai_key_removed`, with the Admin who did it. A key is never written to the audit log; only its last four characters.
- Tables (additive migration `20270405000000_ai_pilot`): `AiPilotUser`, `AiPilotSignoff`. The key lives in `IntegrationConfig`.

## Turning it off

Any one of these stops it at once: remove the key, withdraw the sign-off, empty the list, switch the kill switch off, or unset `WA_ASSIST_ENABLED`.
