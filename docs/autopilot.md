# Autopilot (Wave 3: converged onto the foundation)

Autopilot audits the ad accounts and PROPOSES fixes. A person approves each one; nothing changes in an ad account on its own. Page `/autopilot` (area `marketing-autopilot`, ADMIN and MARKETING only), flag `NEXT_PUBLIC_AUTOPILOT`.

## How it is built on the foundation

| Concern | How |
| --- | --- |
| Access | Central registry only: `requireMarketing("marketing-autopilot", ...)` in the page and the actions; surfaces, job and notification declared in `access/surfaces.ts` and `notification-policy.ts`. There is no private role list, no `marketing-access` copy and no pseudonymiser in `lib/autopilot` (pinned by `access-conformance.test.ts`). |
| Outcomes | What came of the clicks (CRM leads, KYC, funded, revenue, cost per funded customer, return on spend) is read ONLY through `CampaignOutcomeProvider` (`lib/attribution`). The platform's own daily numbers come from `lib/marketing/daily-rows.ts`. `lib/autopilot/outcome-boundary.test.ts` fails on a spend table, an attribution internal, a second provider or private outcome arithmetic. One documented exception: `regions.ts` divides regional spend (a platform dataset with no provider grain yet) by the funded count of that region's cohort; it moves into the provider when regional spend is synced. |
| Lead cohorts | `provider.leadCohorts()` returns the facts behind the aggregates (arrival, first contact, KYC, funded, revenue, AUM, city, state) with no id or name. Blurred (arrival to the hour, contact to five minutes, amounts as bands about 1.6x apart) for everyone but a signed-in ADMIN, and for every system reader. |
| AI | `callModel()` only: purposes `autopilot.ask` and `autopilot.rule_draft` (aggregate data, no consent needed), agent `ad_autopilot` (default L2, `change_ad_spend` at most L4). Ask only chooses read-only tools and falls back to a keyword router; rule drafting returns a DISABLED, unsaved draft that a person reviews and saves. Flag `AUTOPILOT_ASK_ENABLED` plus the agent switch. |
| Approvals | Canonical kind `autopilot-action` (read-through adapter over `AutopilotRecommendation`): ADMIN and MARKETING decide, four-eyes is a Settings switch (the author of a rule cannot approve its proposal), proposals expire after 7 days unless a daily run finds them again, every decision writes an `Approval` audit row. The UI calls `approvalService().decide`; applying is a separate human click that needs the canonical state to be approved, a database claim (once only) and `AUTOPILOT_APPLY_ENABLED`, which the flag registry blocks in every environment. |
| Jobs | `autopilot-daily-audit` (every tick, runs once per 20 hours, flag `AUTOPILOT_DAILY_AUDIT_ENABLED`, safe to re-run) and `autopilot-weekly-digest` (flag `AUTOPILOT_DIGEST_ENABLED`), both through `runJob` and the job registry. |
| Events and the Action Ledger | One correlation id per audit run (`AutopilotAuditRun.correlationId`). `agent.run.started/completed/failed`, `campaign.autopilot.recommended`, `.approved` or `.denied`, `.applied` or `.apply.failed` all carry it, and each names the one before it as its cause. The ledger can walk run, proposal, approval, applied action without a lookup. |
| Weekly digest | In-app notification (`autopilot_digest`) for ADMIN and MARKETING users and a DRAFT email (`AutopilotDigest`). Nothing is emailed until a person approves the draft on the Weekly digest tab. Aggregates only. |
| Multi-account | A rule can be limited to ad accounts and campaigns; a campaign must pass both. |
| Erasure and merge | No Autopilot table has a Client foreign key or column (asserted by `no-client-fk.test.ts` and the real-database suite), so nothing is registered in the relationship registry. |

## The Meta ads connection

The real adapter is NOT wired. `getActionProvider()` returns the unconfigured provider, which refuses everything, so no code path can write to an ad account whatever the flags say. Connecting the owner's account is a separate, deliberate step done by an Admin in Settings (never in chat), and the apply flag stays blocked until the owner lifts that standing rule. A launch draft is always created PAUSED (the spec has no status to set) and turning it on needs a second person, a clear compliance checklist and the recorded annexure.

## The simulate() seam

The generic `simulate()` primitive (Addendum 1) is on the Wave 2 branches, not on this base. `previewRule()` (lib/autopilot/rules.ts) evaluates a draft rule against today's data and returns who would be proposed and who is held and why; `asSimulation()` maps it onto the eligible and suppressed shape the primitive uses, and `SIMULATE_SEAM` records that it is not on the base. When it lands, the Rules tab calls it once and `previewRule` stays as the pure evaluator behind it.

## Tests

Unit and boundary tests in `lib/autopilot`; the real-database suite is `autopilot.db.test.ts` (switch `AUTOPILOT_DB_TEST`, registered in `ci/db-suites.json`): equivalence of cost per funded customer and return on spend with the provider and the Campaign impact tab, the proposal lifecycle (claims, expiry), the canonical approval path, the correlation chain in `CustomerEvent`, the digest and the no-foreign-key guarantee. Accessibility: `e2e/axe-autopilot.spec.ts`; flows: `e2e/flows/f13-autopilot.spec.ts`.
