# Campaign outcome provider

`CampaignOutcomeProvider` is the **only** way any module reads what marketing brought in: spend, leads, contacted in time, KYC, funded customers and revenue, by campaign, ad and period, each with its data age and a confidence label. Autopilot, creative intelligence, the planner, closed-loop conversions and director reports read it from here. None of them computes its own funded, contacted or cost-per-lead numbers, and none reads the ad spend tables.

Code: `src/lib/attribution/outcome-provider.ts` (the interface, the definitions, the access rule, the confidence rule; no database), `outcome-provider-db.ts` (the implementation over the attribution loader), `outcome-provider.testkit.ts` (a provider over a fixture for other modules' tests), `index.ts` (the public surface).

## Use

```ts
import { getCampaignOutcomeProvider } from "@/lib/attribution";

const report = await getCampaignOutcomeProvider().outcomes(
  { grain: "campaign", period: { from: "2027-04-01", to: "2027-04-30" } },
  { kind: "system", consumer: "autopilot" },
);
```

- **Query**: `grain` (`campaign`, `ad` or `adset`), `period` (`YYYY-MM-DD` to `YYYY-MM-DD`, inclusive, in the ad account's day), optional `channel` and `campaignKey`.
- **Caller**: a signed-in user (`ADMIN` or `MARKETING` only, checked by the access module's `canAccessMarketing`) or a registered system consumer (`autopilot`, `creative`, `planner`, `closed-loop`, `director-reports`, `control-plane`). Anyone else is refused with `OutcomeAccessError` before anything is read.
- **Result**: aggregates only. Never a customer name, id, RM or an answer a lead typed; a module that needs one customer asks the Customer 360 Journey, which has its own access rules.

## Definitions (one each, `OUTCOME_DEFINITIONS`)

| Number | Meaning |
| --- | --- |
| spend | What the platform reported for the campaign (or ad) in the period. Absent when none was synced or another currency would have to be added |
| leads | Customers whose **first touch** is this campaign, created in the period |
| contactedInSla | Leads a person reached within the speed-to-lead SLA (first-contact rule); the rate leaves out leads still inside their window |
| kyc | Leads with KYC approved |
| funded | Leads with a successful funds-in payment or a partly or fully funded record |
| revenue | Net brokerage and advisory revenue to date, reversals netted off |
| costPerLead, costPerFunded, roas | Only for a campaign with spend; otherwise `null`, never zero and never estimated |

## Honest about what it cannot say

- `adset`: not supported (`supported: false` and a reason, no rows). Spend is synced per campaign, and per ad for Google only.
- `ad` rows carry leads, funded and revenue, and spend only where the platform reports per ad. Contact and KYC are not computed per ad and are `null`.
- Partner, referral, website and unattributed buckets are listed (`rowKind`) with no spend and no cost figure.
- **Data age**: `dataAge.spend` says per channel when spend was last synced and whether it is `fresh`, `stale` (over 36 hours), `partial` (days missing) or `missing`. `truncated` says the lead window (5,000 leads) was cut.
- **Confidence**: `high`, `medium`, `low` or `insufficient`, always with the reasons. Defaults (`CONFIDENCE_DEFAULTS`, labelled configurable): at least 10 leads, at least 60% of leads attributed on strong evidence, fresh and complete spend.

## Rules for other modules

1. Do not declare another `CampaignOutcomeProvider` or implement it (a boundary test, `outcome-boundary.test.ts`, fails the build).
2. Do not import attribution's internals (`impact`, `db`, `model` and so on); import the public surface only.
3. Do not read ad spend tables or compute cost per lead or funded rates (the access segregation test and the boundary test fail).
4. Need a number the provider does not carry? Add it to the provider so every module reads the same one.
5. In tests use `createFakeOutcomeProvider(fixture)` from `outcome-provider.testkit.ts`: it is the real provider over an in-memory source, so the same fixture gives the same funded and cost-per-lead numbers in every module. A module's own tests should assert its screen shows what the provider returns for one shared fixture.

The Campaign impact tab uses the same loader, so the tab and every consumer show the same numbers (`outcomes.db.test.ts` pins this on a real database).

## Lead cohorts (Wave 3)

`provider.leadCohorts({ period, channel? }, caller)` returns the customer-level facts behind the aggregates for engines that analyse timing and regions (Autopilot): arrival, first contact in minutes, KYC approved, funded, net revenue, AUM, city and state, and the campaign key. There is no id, name, contact detail or RM, and no key that leads back to a person. The same access rule as `outcomes` applies. A signed-in ADMIN gets exact times and amounts; everyone else, and every system reader (a scheduled job's output reaches MARKETING), gets arrival to the hour, first contact to five minutes, and AUM and revenue as bands about 1.6x apart (`blurCohortRow`). The funded, KYC, contact and revenue facts are the ones the Campaign impact tab counts.
## The campaign planner

The planner (`src/lib/planner/outcomes.ts`) reads the provider as the registered `planner` consumer and nothing else: the funnel estimate pools the provider's campaign and source rows by channel (audience is not recorded on a lead, so history is by channel and says so), a plan's own results come from the synced campaign it is linked to (`outcomeKey`), and every figure carries the provider's data age and confidence. A channel with no matching bucket (email, short video) is reported as not measured, never estimated. The boundary test keeps the planner from reading spend or customer tables itself.
