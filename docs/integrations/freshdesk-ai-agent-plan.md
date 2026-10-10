# Plan: the helpdesk AI agent as first line

Status: recommendation only. Nothing here is built or switched on. Supportify does not create or run this agent.

## 1. Decision

The helpdesk vendor's own AI agent builder is the first line for support chats. Supportify receives the hand-offs
(`freshdesk-handoff.md`) and keeps the customer timeline, the RM task and the SLA view. We do not build a second chat
bot inside Supportify.

## 2. Scope: what the agent should do

- Answer general questions from an approved knowledge base: how onboarding works, what each account type is, fees as
  published, how to contact the team, opening hours.
- Give the **document checklist** for the customer's stage (from approved content, not from customer data).
- Give **KYC status** after the customer has been verified in the app (section 5). Status words only: not started,
  in progress, documents needed, completed, rejected with "your relationship manager will explain".
- Take an **appointment request** (preferred day and time, topic) and hand off. It does not book.
- Hand off cleanly with a short summary, the topic and the customer's mood.

## 3. What it must never do

- Give investment advice, suggest products, compare funds, or comment on markets.
- Quote or imply returns, performance, safety or guarantees.
- Discuss account numbers, client codes, PAN, holdings, balances, portfolio values or transactions.
- Confirm or deny that a person is a customer before verification.
- Handle a complaint, a refund request, a regulator mention or a legal threat beyond acknowledging it and handing off.
- Ask for passwords, OTPs, card numbers or identity numbers in the chat.
- Promise a deadline or an outcome on behalf of the team.

## 4. Hand-off triggers

Hand off (tag `ai_handoff`, fill the summary field) when any of these is true:

- The customer asks for a person, or asks the same thing twice without being helped.
- Complaint, dissatisfaction, anger, or words such as fraud, scam, refund, legal, SEBI, ombudsman, grievance.
- Any request involving money movement, withdrawals, account data, advice or product recommendations.
- Verification fails or is declined and the customer still needs account help.
- The agent's confidence is low or the question is outside the knowledge base.
- An appointment request (always handed off).

Set sentiment to `negative` when the customer is upset; Supportify raises the priority and opens a service issue.
The summary should say what was asked, what was answered, whether the customer was verified, and what is needed from
the RM. It must not repeat account identifiers.

## 5. Identity and verification

Follow section 5 of `freshdesk-handoff.md`: the OTP check is done by the Supportify or customer app, never inside the
chat. The agent only learns "verified or not" for this chat session, and only then may it return KYC status.

## 6. Cost

The agent is billed per session pack, not per message, and the vendor's plan decides the included volume and the price
of extra packs. Before launch: estimate monthly chat sessions, count only sessions the agent handles, confirm what
counts as a session (a returning visitor, a hand-off), and set a monthly cap or alert on pack usage. No agent exists
yet, so there is no spend today.

## 7. Success measures

Track weekly, per channel:

- Containment: sessions resolved without a hand-off (target to be set after a baseline month).
- Hand-off quality: share of hand-offs where the RM did not need to re-ask the customer (RM thumbs up or down on the
  task).
- First-response and resolution SLA compliance on hand-offs (the Support SLA page).
- Complaint and compliance hand-offs, and any reply the compliance team flags. Zero tolerance for advice or return
  claims; review a weekly sample of transcripts.
- Customer satisfaction on chats, split by contained and handed off.
- Cost per contained session.

## 8. Possible later step: a status endpoint

Not built. If the agent should read live status rather than a typed answer, Supportify could offer one narrow endpoint:

- Read-only. One question only: the KYC status words and the outstanding document names for one customer.
- Needs a verified contact: the call carries a short-lived token issued by the app after OTP. No token, no answer.
- Rate limited per token and per source address, with a hard daily ceiling, and a request log that holds ids and
  outcomes but no personal data.
- Returns nothing about money, holdings or identifiers. Unknown or unverified callers get the same neutral reply as a
  customer who does not exist.
- Authenticated by a secret held by the helpdesk and rotated on a schedule, separate from the webhook secret.

Decide this only after the first month of real chats shows whether typed answers are accurate enough.
