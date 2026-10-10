-- Learning insights (/agents/insights): supporting indexes.
--
-- This migration is ADDITIVE and SAFE TO DROP. It only creates three plain btree indexes with IF NOT EXISTS.
-- It changes no table, column, constraint or data, and no application code depends on an index being present:
-- the insights queries return the same rows with or without them, only slower without. To undo, run
--   DROP INDEX IF EXISTS "Message_direction_channel_createdAt_idx";
--   DROP INDEX IF EXISTS "InteractionOutcome_createdAt_idx";
--   DROP INDEX IF EXISTS "AgentProposal_decidedAt_idx";
--
-- Why these three (they are the date-bounded scans in src/lib/insights/queries.ts, run on every page load):
--   Message(direction, channel, createdAt)   outbound and inbound WhatsApp messages in a date range (reply times, reply rates)
--   InteractionOutcome(createdAt)            outcomes in a date range; the existing (outcome, createdAt) index cannot serve a createdAt-only filter
--   AgentProposal(decidedAt)                 sent drafts in a date range for the conversion cohort; (status, createdAt) does not cover decidedAt
-- On a very large Message table, create them in a quiet window (a plain CREATE INDEX blocks writes while it builds).

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Message_direction_channel_createdAt_idx" ON "Message"("direction", "channel", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "InteractionOutcome_createdAt_idx" ON "InteractionOutcome"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AgentProposal_decidedAt_idx" ON "AgentProposal"("decidedAt");
