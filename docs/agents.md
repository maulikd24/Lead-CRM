# AI agents (WhatsApp drafts)

Agents prepare drafts. They never send anything on their own.

- Draft-only: an agent reads a conversation and proposes a message. The proposal waits in "Agent drafts".
- Per-message approval: nothing is sent until the assigned RM or an Admin approves that specific message.
- Kill switch: an agent runs only when BOTH the `AGENT_NUDGER_ENABLED=1` environment flag (only the exact value `1`) and its enabled row in `AgentSetting` are on. Turning either off stops new drafts.
- Guardrails: every draft passes a regex check and an LLM judge before it is shown. A draft that fails is not offered.
- Production enablement requires a recorded compliance sign-off (including the data-protection notice and lawful basis for processing chat content). That record is kept outside this repository.
