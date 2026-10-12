# Freshdesk AI hand-off

Audience: Admins and operations. Everything here is off until you turn it on.

## 1. What this does

The helpdesk's own AI agent is the first line for support chats. When it cannot finish a conversation it hands off to a
person by creating or tagging a ticket. Supportify receives that ticket event and:

- adds one entry to the customer timeline: "Support hand-off: <intent>", followed by the agent's short summary and a
  link to the ticket,
- creates one task for the assigned RM: "Follow up on support hand-off", due by priority,
- starts first-response and resolution clocks, shown on the customer page and on the manager view (`/support`),
- if the customer sounds unhappy or uses complaint or compliance wording, raises the priority to at least high and opens
  a service issue, so the next-best-action engine says "resolve service before any sales".

Supportify does **not** run the AI agent. See `freshdesk-ai-agent-plan.md` for how to set that agent up.

## 2. Switches

| Setting | Default | Effect |
|---|---|---|
| `FRESHDESK_HANDOFF_ENABLED=1` | off | The webhook route acts on hand-off events. When off, the route behaves exactly as before. |
| `NEXT_PUBLIC_SUPPORT_SLA=1` | off | Shows the "Support SLA" page and its sidebar item. Set at build time. |

The Freshdesk integration must be switched to live with a webhook secret (Settings, Apps and Integrations). To show
"Open in Freshdesk" links when the payload carries no ticket link, add your helpdesk address as the integration setting
`baseUrl` (for example `https://yourcompany.freshdesk.com`). Only `https` addresses are used.

## 3. The event

Freshdesk posts JSON to the existing webhook route, with the shared secret in a custom header:

```
POST /api/webhooks/freshdesk
Content-Type: application/json
X-Webhook-Secret: <the secret saved in the integration>
```

An event is treated as a hand-off when its `tags` contain `ai_handoff` (any case) or its `event` is `ai_handoff`.
Anything else on the same route is handled as an ordinary ticket event.

| Field | Required | Notes |
|---|---|---|
| `ticket_id` | yes | Letters, digits, `_` or `-`, up to 40 characters. |
| `requester_email` and/or `requester_phone` | at least one | Used to find the customer (the app's normal matching). With neither, the event is skipped. |
| `requester_name` | no | Used only if a new lead has to be opened. |
| `subject` | no | 200 characters kept. |
| `priority` | no | `1`-`4` or `low`, `medium`, `high`, `urgent`. Default medium. |
| `status` | no | `2` open, `3` pending, `4` resolved, `5` closed, or text. Default open. |
| `channel` | no | Readable label such as `Live Chat`, `WhatsApp`, `Email`. |
| `tags` | yes (or `event`) | Comma-separated string or array. Must include `ai_handoff`. |
| `ai_summary` | recommended | The AI agent's summary for the RM. 600 characters kept. |
| `ai_intent` | no | Short topic, for example `KYC status`. 80 characters kept. |
| `ai_sentiment` | no | `positive`, `neutral` or `negative`. Negative raises the priority to high. |
| `transcript` | no | Text, or a list of lines or `{role, text}`. Only an 800 character excerpt is kept. |
| `ticket_url` | no | Must be `https`. |
| `created_at`, `updated_at` | no | ISO 8601. `updated_at` makes repeats safe (below). |

Example:

```json
{
  "ticket_id": "4321",
  "ticket_url": "https://yourcompany.freshdesk.com/a/tickets/4321",
  "requester_email": "customer@example.com",
  "requester_phone": "+91 98765 43210",
  "subject": "Status of my account",
  "priority": 3,
  "status": 2,
  "channel": "Live Chat",
  "tags": "ai_handoff",
  "ai_intent": "KYC status",
  "ai_sentiment": "neutral",
  "ai_summary": "Asked about KYC status twice. Identity verified in the app. Wants a call.",
  "updated_at": "2026-10-07T04:00:00Z"
}
```

### What is kept and what is not

- The summary, intent and the capped excerpt are kept on the timeline entry. The full transcript is never stored.
- Markup and control characters are removed. PAN-shaped text and runs of 9 or more digits become `[redacted]`.
- The customer's email and phone are used to find the customer and are not copied into the entry.
- Logs carry the ticket id and a yes/no for escalation only. No names, contacts or text.

### Safe repeats

- The same ticket is one timeline entry. A later event with a newer `updated_at` updates it (status, priority,
  summary). An event that is not newer is acknowledged and ignored.
- The follow-up task is created once per ticket. The SLA clocks start when the first hand-off arrived and do not reset.

### SLA clocks and due dates

Business hours are a constant in `src/lib/integrations/freshdesk/sla.ts`: Monday to Friday, 09:30 to 18:30 India
Standard Time, with no holiday calendar. One working day is 9 business hours.

| Priority | RM task due | First response | Resolution |
|---|---|---|---|
| urgent | 2 hours (round the clock) | 1 hour (round the clock) | 4 hours (round the clock) |
| high | 1 working day | 4 business hours | 1 working day |
| medium | 2 working days | 1 working day | 3 working days |
| low | 3 working days | 2 working days | 5 working days |

"First response" is counted as met when the RM's follow-up task is completed. That is a proxy: Supportify does not
read replies inside the helpdesk.

## 4. Freshdesk setup (generic steps)

1. In Freshdesk, add a ticket field "AI agent summary" (multi-line text), and the tags `ai_handoff`. Have the AI
   agent's hand-off action set the summary field and add the `ai_handoff` tag. Optional fields for intent and
   sentiment can be added the same way.
2. Go to Admin, Workflows, Automations, Ticket Updates (and, if the agent tags at creation, Ticket Creation) and add a
   rule.
3. Condition: "Tags" "contains" `ai_handoff`.
4. Action: "Trigger Webhook". Method POST, URL `https://<your Supportify address>/api/webhooks/freshdesk`, encoding
   JSON, content "Advanced". Add the custom header `X-Webhook-Secret` with the same secret saved in the Freshdesk
   integration in Supportify.
5. Build the body from the placeholders, for example `"ticket_id": "{{ticket.id}}"`,
   `"ticket_url": "{{ticket.url}}"`, `"requester_email": "{{ticket.requester.email}}"`,
   `"requester_phone": "{{ticket.requester.phone}}"`, `"requester_name": "{{ticket.requester.name}}"`,
   `"subject": "{{ticket.subject}}"`, `"priority": "{{ticket.priority}}"`, `"status": "{{ticket.status}}"`,
   `"channel": "{{ticket.source}}"`, `"tags": "{{ticket.tags}}"`, `"ai_summary": "{{ticket.cf_ai_agent_summary}}"`,
   `"updated_at": "{{ticket.updated_at}}"`. Check the exact placeholder names in your account.
6. Send a test from Freshdesk, then confirm a "Support hand-off" entry appears on that customer.

Keep this rule separate from any rule that already posts ordinary ticket events. A hand-off event is handled as a
hand-off only, and is not also recorded as an ordinary ticket event.

## 5. Identity verification (important)

The AI agent talks to anyone who opens the chat. It must not disclose customer data to someone who has not been
verified. Recommended pattern:

1. Verification happens in the Supportify or customer app, by one-time password to the registered number. The helpdesk
   chat never asks for or checks an OTP itself.
2. Before verification the agent answers general questions only (products, process, document checklists, how to book a
   call).
3. After verification the agent may state **KYC status** and the outstanding document list for that customer, and
   nothing else about the account.
4. The agent never states portfolio values, holdings, balances, account or client numbers, PAN, or transaction details,
   verified or not. Those are for the RM.
5. An unverified request for account data is not answered. The agent offers a hand-off instead.

The hand-off summary must not contain account numbers, PAN or portfolio values. Supportify redacts PAN-shaped text and
long digit runs as a second line of defence, not as the control.

## 6. Checking it works

- Flag off: post a hand-off event. The route answers as it always did and nothing new is stored.
- Flag on: the answer is `{"ok":true,"handoff":"created"}`. Posting the identical body again answers
  `{"ok":true,"duplicate":true}`. A newer `updated_at` answers `"updated"`.
- An event without `requester_email` or `requester_phone` answers `"skipped"` and stores nothing.

## 7. Operational notes

- Hand-offs for a customer with no assigned RM still appear on the timeline, with no task.
- An unknown contact opens a lead through the app's normal matching, exactly as other inbound tickets do.
- Not built: replies from Supportify into Freshdesk, closing the ticket when the RM completes the task, and
  automatic reassignment.
