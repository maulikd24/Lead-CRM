# AI agents (WhatsApp drafts)

Agents prepare drafts. They never send anything on their own.

- Draft-only: an agent reads a conversation and proposes a message. The proposal waits in "Agent drafts".
- Per-message approval: nothing is sent until the assigned RM or an Admin approves that specific message.
- Kill switch: an agent runs only when BOTH the `AGENT_NUDGER_ENABLED=1` environment flag (only the exact value `1`) and its enabled row in `AgentSetting` are on. Turning either off stops new drafts.
- Guardrails: every draft passes a regex check and an LLM judge before it is shown. A draft that fails is not offered.
- Production enablement requires a recorded compliance sign-off (including the data-protection notice and lawful basis for processing chat content). That record is kept outside this repository.
- Insights: with `NEXT_PUBLIC_INSIGHTS=1`, Admins and Managers get `/agents/insights` (link on the Agent drafts page and in Cmd+K). It shows aggregate response analytics, agent quality and an ESTIMATED cost per approved message from the price table in `src/lib/insights/pricing.ts` (assumed list prices, not billing data; unknown models show n/a). Suggestions are rule-based. `assignVariant` in `src/lib/insights/variant.ts` is ready for future experiments and is not used by the nudger.
