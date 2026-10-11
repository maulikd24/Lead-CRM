# AI gateway, agent registry and autonomy ladder

One way to call a model: `callModel()` in `src/lib/ai/gateway`. One list of agents: `src/lib/agents/registry.ts`. One ladder of autonomy per (agent, action type): `src/lib/agents/autonomy.ts`. Application code does not import a model SDK, a vendor URL or a raw provider factory; `npm run ci:ai-boundary` fails the build if it does.

## 1. Inventory of model call sites (found by grep, before the migration)

Searched: `@anthropic-ai/sdk`, `openai`, `messages.create`, `chat.completions.create`, `getProvider`, `getProviderWithKey`, `getAnthropicClient`, `getOpenAiClient`, `.complete(`, vendor hostnames, across `src`, `scripts`, `whatsapp-worker`.

| Module | Purpose | Provider | Data sent to the model | Redacted | Consent-checked | Kill switch | Token logging |
|---|---|---|---|---|---|---|---|
| `lib/ai/summaries/generate.ts` | Page summaries from a CRM fact sheet | OpenAI (`OPENAI_SUMMARY_MODEL`, default `gpt-4o-mini`), pinned regardless of `AI_PROVIDER` | Fact sheet: names, counts, amounts, dates; free text already passed through `redactPii` when the sheet was built | Yes at fact-build time (email, PAN, long digit runs) | No | None (only a missing key); per-user cap of 30 an hour | None (model name stored on the summary) |
| `lib/intelligence/ask.ts` | "Ask the system" management Q&A, tool-using, up to 5 rounds | Anthropic, fixed model | The question (500 chars) and read-only tool results: customer names, client codes, RM names, stages. Tools are scoped to the asker by the access policy | No | No | None | None |
| `lib/intelligence/extract.ts` | Insight extraction from call transcripts, chat threads, RM notes, tickets | Anthropic, fixed model, forced tool | Raw conversation text, last 12,000 characters (phone numbers and emails included) | No | No (gap: `AI_PROCESSING_OF_CHATS` was never checked) | None | None |
| `lib/ai/analyze-conversation.ts` (via `run-review.ts`) | Quality-audit scoring of a call or chat | Anthropic, fixed model, forced tool | Raw transcript, last 12,000 characters | No | No (same gap) | None | None (output kept in `aiRawResponse`) |
| `lib/agents/nudger.ts` | Draft one WhatsApp onboarding nudge | `AI_PROVIDER` switch | JSON of first name, language, programme, reason category. No free text | By construction (4 fixed fields) | `MARKETING_COMMS` via `deps.consent`, only when `CONSENT_ENFORCEMENT=1` | `AGENT_NUDGER_ENABLED` and the `wa_nudger` AgentSetting | Tokens on `AgentProposal` |
| `lib/agents/reply-assist.ts` | Suggest one inbox reply | `AI_PROVIDER` switch | JSON of first name, language, reason category, last 6 turns of the conversation | Yes (`scrubForVendor`, surname dropped, 300 chars a turn, 1,200 total) | `AI_PROCESSING_OF_CHATS` via `deps.consent`, only when `CONSENT_ENFORCEMENT=1` | `WA_ASSIST_ENABLED`, the `wa_reply` AgentSetting, the pilot allow-list and sign-off | Tokens on `AgentProposal` |
| `lib/agents/judge.ts` | Second-layer compliance judge on every drafted text (nudger, reply, social) | `AI_PROVIDER` switch | The drafted text, after the regex guardrails passed it | n/a (text the system wrote) | Inherits the caller's gate | Inherits the caller's | Not stored (fails closed on any error) |
| `lib/marketing/social/ai-draft.ts` | Draft one social post | `AI_PROVIDER` switch | Channel and the brief, scrubbed. No customer data | Yes (`scrubForVendor`) | Not applicable (no customer data) | `SOCIAL_DRAFTS_ENABLED` and the `social_drafter` AgentSetting | Returned to the caller, not stored |
| `lib/agents/pilot-wiring.ts` | Builds the reply assistant's provider from an Admin-saved key | Anthropic with that key | n/a (construction only) | n/a | n/a | Pilot allow-list and sign-off | n/a |
| `lib/agents/evals/cli.ts` | Optional live judge run (`EVALS_REAL_PROVIDER=1`) | `AI_PROVIDER` switch | Synthetic eval texts only | n/a | n/a | Explicit env opt-in, never in CI | Not stored |
| `lib/ai/provider.ts`, `client.ts`, `openai.ts` | The adapters | | | | | | |

`lib/outcomes` drafts are template based and never call a model. `autopilot/ask.ts`, `creative/ai.ts` and the planner agent live on in-flight branches that are not on this train; they must be migrated when they merge (the boundary check will fail them until they are).

## 2. After the migration

All eight call sites above go through the gateway. `summary.page`, `ask.intelligence`, `insight.extract` and `conversation.analyze` call `callModel()` directly. The nudger, the reply assistant, the judge and the social drafter keep taking an `LlmProvider` and are handed `gatewayProvider()`, so their code, kill switches and tests are unchanged; each request carries the purpose it is for.

Deliberate behaviour changes (everything else is pinned by equivalence tests):

- Extraction and quality audit now check the customer's `AI_PROCESSING_OF_CHATS` consent (when `CONSENT_ENFORCEMENT=1`). A source whose customer has not agreed is marked read, with nothing sent.
- A PAN never reaches a model, for any purpose. Transcript purposes still receive phone numbers and emails, because that is what they read.
- Every call has a timeout, a bounded retry with backoff, a budget and a trace row. Direct SDK calls used the SDK defaults (10 minute timeout, 2 retries).
- A purpose with no daily budget is refused in production. Set `AI_PURPOSE_BUDGETS_USD` or `AI_BUDGET_DEFAULT_USD` before this ships.

## 3. callModel()

`callModel(input, deps?)` returns one of four typed results. Nothing throws for an ordinary refusal.

| Result | Meaning |
|---|---|
| `ok` | text, tool uses, usage (tokens, cost estimate), `runId`, `correlationId`, optional evaluation verdict |
| `abstain` | `reason`: `do_not_know`, `evidence_conflict`, `data_stale`, `human_review_required`, `do_not_contact`. A legitimate outcome, counted on the AI tab and in the evals |
| `blocked` | `purpose_unregistered`, `kill_switch`, `invalid_input`, `consent_denied`, `consent_subject_missing`, `consent_unavailable`, `redaction_failed`, `budget_unset`, `budget_exceeded`, `budget_unavailable` |
| `failed` | `errorClass`: `not_configured`, `timeout`, `rate_limited`, `provider_error`, `network`, `invalid_request`, `unknown`, with `retryable` and `attempts` |

Gates, in order, each failing closed: registered purpose, kill switches (`AI_KILL_SWITCH=1`, then the owning agent's flag and setting), input, caller signals (stale data, conflicting evidence, do-not-contact, human review: these abstain without a model call), consent for the customer data class (the subject must be the customer; a withdrawn consent blocks, a do-not-contact flag abstains, an unreadable ledger blocks), redaction and a last-line check (anything the purpose may not receive that survives refuses the call), the daily budget, the provider call.

- **Routing:** the existing `AI_PROVIDER` / `AGENT_MODEL` switch (`anthropic`, `openai`, `fake`). A purpose can pin a provider and model (summaries pin OpenAI; Ask, extraction and quality audit pin Anthropic, as before). `AI_PROVIDER=fake` is a deterministic offline stand-in for demos and is refused in production. `FakeProvider` is the test double: no test touches the network.
- **Prompt id and version:** per purpose (`purposes.ts`); the run also stores a hash of the system prompt.
- **Budget:** a hard cap per purpose per Indian day, checked against spend so far plus the worst case for the call (input estimate plus `maxTokens`). Parallel calls can overshoot by what is in flight. Cost is an estimate from `pricing.ts`, not an invoice; an unknown model is priced at a deliberately high fallback.
- **Retry:** only for timeouts, rate limits, server and network errors; 400 ms doubling to 4 s; the vendor SDK's own retries are turned off under the gateway.
- **Evaluation hook:** `evaluate(output)` records pass, fail or error on the run; it never fails the call.

### Redaction

`redact.ts` extends and replaces the three older scrubbers (`scrub`, `scrubForVendor`, `redactPii` at fact-build time stays as the first pass); the old names are kept and their output is pinned equal by test. Removed unless the purpose is registered for them: emails, runs of six or more digits, the subject's known names. Removed always: PAN, link paths and query strings.

## 4. Purposes and data classes

`none`, `aggregate`, `customer_facts`, `customer_text`, `customer_identifiers`. `purposes.test.ts` lints the table: customer text and identifiers must name a consent ledger purpose; customer facts must name one or carry a written exemption (summaries, Ask and the judge do, and the reason is an open question below).

## 5. Trace: AgentRun

One row per call, including refusals: agent, purpose, provider, model, prompt id, version and hash, input class, redaction counts, tokens, cost estimate, latency, attempts, status (`OK`, `ABSTAINED`, `FAILED`, `BLOCKED`), reason, error class, evaluation outcome, approval reference, `correlationId`, `causationId`, an opaque subject reference (an id that looks like an email, a phone number or a PAN is dropped) and `retainUntil`. No prompt, no output, no customer text. Ask links its rounds with one correlation id and a causation chain; the nudger, reply assistant and social drafter link the draft call to its judge call.

`ai-run-retention` runs in the cron tick: rows past `retainUntil` (`AI_RUN_RETENTION_DAYS`, default 90) are folded into `AgentRunRollup` (day, agent, purpose, status) and deleted, in bounded batches. Seam: wrap it in the control plane's JobRun wrapper when that lands.

## 6. Agent registry and autonomy ladder

Each agent is code-defined data with the contract fields: purpose, allowed tools, prohibited actions (always the base six), data permissions, approval requirement, input and output schema, audit, eval suite, fallback, timeout, token budget, kill switch, flags and purposes. The kill switch is the existing flag plus `AgentSetting` row. `registry.test.ts` lints the table, including that no forbidden tool is ever allowed.

Ladder: L0 observe, L1 analyse, L2 recommend, L3 draft, L4 execute after human approval, L5 auto-execute. Stored per (agent, action type) in `AgentAutonomy`; no row means the registry default. Ceilings are enforced in code and exceeding one throws:

| Action class | Ceiling |
|---|---|
| Read only | L2 |
| Internal write, not reversible | L4 |
| Customer-facing send (including public posts) | L4, and never automatic: executing needs an approval reference |
| Ad spend change | L4 |
| Internal, reversible, non-customer | L5 |

Raising a level is an Admin action (`setAutonomyLevel`): it needs a written reason, the agent's eval gate to be green (its categories in the eval harness, run in process), and it writes an audit entry before it writes the level. An agent with no eval suite cannot be raised. Lowering is always allowed and also audited. The AI tab is read-only for levels; the only write on it is the existing agent kill-switch action.

## 7. Admin AI tab

System status, tab "AI". Behind `AI_ADMIN_TAB=1` and the `settings-ai` access area (Admin only). Runs by agent and purpose, failure, abstain and blocked rates, p50 and p95 latency, cost today against each purpose's budget, the registry with levels, ceilings and kill switches.

## 8. Configuration

| Name | Effect |
|---|---|
| `AI_KILL_SWITCH=1` | The gateway refuses every call. ON here means AI is OFF |
| `AI_PURPOSE_BUDGETS_USD` | `purpose=usd,purpose=usd` daily caps |
| `AI_BUDGET_DEFAULT_USD` | Daily cap for every purpose without its own entry |
| `AI_RUN_RETENTION_DAYS` | Detail retention, default 90 |
| `AI_ADMIN_TAB=1` | Shows the AI tab |
| `AI_PROVIDER`, `AGENT_MODEL` | The existing provider switch |

## 9. Backlog and open questions

- Link `AgentProposal` to its run (nullable `runId`) and backfill `AgentRun` from `AgentProposal`. Not done: the proposal save paths are covered by exact-shape tests and belong with the approvals work.
- Per-feature kill switches for summaries, Ask, extraction and quality audit (today only `AI_KILL_SWITCH` stops them).
- Decide whether CRM-fact summaries, Ask and the judge need a ledger purpose; today they carry written exemptions.
- Budgets in the database with an Admin editor; autonomy editing in the UI (the audited service exists).
- Migrate the in-flight branches' model calls (autopilot Ask, creative, planner) when they merge.
- The extraction and quality-audit extracts are tested for equivalence at the request level; the evals do not yet score their output quality.
- Reconcile the cost estimate with vendor invoices.
- Autonomy defaults for insight extraction and quality audit are recorded as L5 because that is how they behave today (advisory, re-runnable, internal); the owner should confirm that reading.
