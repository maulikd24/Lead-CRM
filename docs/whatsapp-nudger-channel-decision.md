# Decision needed: which WhatsApp channel the nudger sends from

Status: open. Owner decision required. Nothing in code has changed for this. `AGENT_NUDGER_ENABLED` stays as it is.

## The question

When an RM approves a nudger draft, the message is sent by `decideDeps().send`
(`src/lib/agents/wiring.ts`), which calls `queueWhatsAppReply` (`src/lib/whatsapp/send.ts`).
That writes an OUTBOUND `Message` with `provider: "whatsapp_openwa"` and status `QUEUED`. The
`whatsapp-worker` then sends it from the RM's own linked WhatsApp account. So today every
nudge leaves from a personal number of the RM who owns the conversation.

Two options:

- **A. RM personal numbers (current path).** Keep `queueWhatsAppReply` and the per-RM
  `WhatsAppAccount` rows.
- **B. Official business number through the existing WhatsApp provider.** Use the Meta Cloud
  API adapter (`src/lib/messaging/adapters/whatsapp-meta.ts`, provider `whatsapp_meta`,
  already listed in `settings/integrations/provider-meta.ts`).

## What the code shows

Option A, RM personal numbers:

- Works today. `resolveReplyAccount` keeps a customer on the account of their latest WhatsApp
  message, so existing threads stay continuous, including after reassignment.
- Sends through Openwa v5, an unofficial WhatsApp Web automation library. `whatsapp-worker/README.md`
  says it is pinned to an alpha release, is not affiliated with WhatsApp/Meta, and that
  WhatsApp's terms do not permit it. Numbers driven this way can be restricted or banned.
- Needs the RM's session online. `isAccountOnline` requires a heartbeat within 90 seconds, and
  `replyBlockReason` blocks the send otherwise. An approved nudge can therefore fail just because
  the RM is offline.
- Puts personal phone numbers and personal chat sessions in the customer-facing path. A departing
  RM takes the number with them.
- Each RM has one account (`WhatsAppAccount.ownerUserId` is unique), so the sender identity is a person.

Option B, official business number:

- The Cloud API is the route the worker README calls supported for a regulated business.
  One business identity, one set of credentials, webhook delivery receipts, and no device session
  to keep alive.
- The adapter is already live for template messages: journeys (`src/lib/journeys/nodes/action.ts`)
  and the client page's template send (`src/app/(dashboard)/clients/actions.ts`) go through
  `src/lib/messaging/send.ts` to the Cloud API. The adapter only sends template messages
  (`templateExternalId` with variables), and the nudger's approved drafts are free text. So
  option B changes what an approved draft can be.
- The nudger's path does not use it. `queueWhatsAppReply` only writes `whatsapp_openwa` rows.
  They are claimed by the Openwa worker through `/api/internal/whatsapp/outbox`
  (`src/lib/whatsapp/outbox.ts`). Option B needs a send path from approved nudger drafts into
  the Cloud API, plus delivery-status handling for it. This is new work.
- Existing customer threads are on RM numbers. Moving the nudger to a business number means
  customers see a different sender from their RM for those threads.
- Outside general WhatsApp Business policy (not checked against code here): proactive follow-ups
  generally need pre-approved templates, and Meta business verification and per-conversation
  charges apply. Confirm these against current Meta terms before choosing B.

## What is needed to decide

1. Is it acceptable for nudges to come from RM personal numbers, given the terms and ban risk
   the worker README records?
2. If B: will the business number send free text or only approved templates? This decides
   how nudge drafts are written.
3. If B: who owns the template approvals and the Meta business account, and is the Cloud API
   adapter configured in any environment yet?

Until this is decided, approved nudges are sent as they are today and `AGENT_NUDGER_ENABLED`
should stay off in any environment where the channel is not accepted.
