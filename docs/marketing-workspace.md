# Marketing workspace

One page, `/marketing`, for Admins and Managers, with four tabs and a right-hand rail. It builds on the Meta report (docs/integrations/meta-ads.md) and adds Google Ads (docs/integrations/google-ads.md) and post drafts.

## Switches (all off by default)

| Switch | Effect |
| --- | --- |
| `NEXT_PUBLIC_MARKETING=1` (build time) | The Marketing page and menu item. |
| `META_ADS_SYNC_ENABLED=1` | Pulls Meta spend on the scheduled tick. |
| `GOOGLE_ADS_REPORTING_ENABLED=1` | Pulls Google Ads data and shows Google in the workspace. |
| `SOCIAL_DRAFTS_ENABLED=1` | Shows the Posts tab and lets its actions run. Also the environment half of the AI drafter's kill switch. |
| `SOCIAL_TIMEZONE` (optional) | Timezone post times are entered and shown in. Default `Asia/Kolkata`. |

With a switch off, the matching part of the page is absent (not greyed out) and its server actions refuse.

## Layout

A fixed header holds the title, the tabs and the date range. Below it one section shows at a time, beside a rail of key facts and actions that stays in view on a wide screen. On a phone the facts become a swipeable strip above the tab bar, and the tabs become a scrollable pill row. The frame, tabs, rail, count-up and skeleton are the shared workspace pattern (`docs/workspace-pattern.md`). Tabs are plain links (`?tab=overview|campaigns|creative|posts`), so they work without JavaScript, and a skeleton shows while a tab loads.

Motion is short (300 ms or less) and purposeful: numbers count up once, charts draw in, tabs cross-fade, cards lift on hover. All of it is switched off when the visitor asks for reduced motion. The small dot beside a live connection gives one soft pulse (300 ms) when it appears and then stays still; nothing in the workspace loops.

## Tabs

- **Overview**: blended spend, leads in the CRM, cost per lead, funded customers, net revenue and return on ad spend across channels, a chart of daily spend by channel against leads, and one card per channel. Blended cost per lead and return are computed from the summed spend, leads and revenue, never by averaging channel ratios. A channel billed in another currency is left out of the blend and says so; return on ad spend is shown for INR only.
- **Campaigns**: every campaign of every channel (filterable), with the quality flags from the Meta report, the ad-to-funded funnel in the rail, and the unattributed leads. Each campaign is judged against its own channel's average.
- **Creative**: per-ad spend, clicks, click-through rate, cost per click, platform-reported leads and cost per lead, with the cheapest and dearest ad marked once at least two ads have 5 or more leads. Only Google reports per ad for now; Meta is campaign level.
- **Posts**: the content calendar and board for social post drafts (below).

A lead belongs to at most one channel, so adding channels never double counts. Leads from neither channel (website, manual, partner) are counted once and shown as "other sources".

## Social post drafts

Staff or the AI create drafts for LinkedIn, Instagram, Facebook or YouTube. X is left out because its length limit cannot hold the mandatory disclosures.

Status workflow: **Draft, Needs review, Approved, Scheduled**. Each step is one action, in order:

1. Submit for review (the text must pass the compliance check).
2. Approve: **four-eyes** — the approver must differ from the post's author (the person who created it); the server refuses the author and the screen says why. An AI-generated draft has no human author, so any Admin or Manager may approve it. A different Admin or Manager ticks "I have read this post and its disclosures" and presses Approve. The check runs again at that instant.
3. Schedule: pick the date and time the post is intended to go out. This records intent only.

Editing a post at any stage sends it back to Draft and withdraws the approval and any schedule, because the new text was never approved. A reviewer can send a post back with a note. Every step leaves an event (who, when, from, to). Only a Draft can be discarded.

**Nothing is ever published automatically.** No code path calls a publisher's `publish`; a test fails the build if one appears. Scheduled is the furthest a post goes.

### Compliance guardrails

Every gate runs the same check, on the text as it is then:

- The agent safety layer's regex guardrails (src/lib/agents/guardrails.ts): promised or guaranteed returns, investment advice, performance figures, in English, Hinglish and Hindi.
- Ad-copy rules: no urgency or pressure, no unverifiable superlatives ("best", "safest", "number one"), no get-rich or insider wording, and no unresolved `[placeholder]`.
- Mandatory disclosures: a market-risk statement and a SEBI registration line with a registration number. "Insert required disclosures" adds the risk line and a registration **placeholder**, so a post cannot be approved until a person writes the real registration details.

The check fails closed (a false positive costs one edit) and is a safety net, not a compliance review. The risk line in `src/lib/marketing/social/compliance.ts` (`STANDARD_RISK_LINE`) is the common SEBI wording; the firm's compliance officer must confirm the exact text before real use.

### AI drafting

"Draft with AI" turns a short brief into a draft. It reuses the agent safety stack: a kill switch (`SOCIAL_DRAFTS_ENABLED=1` and an enabled `social_drafter` row, which an Admin can flip in the rail), the regex guardrails and ad-copy rules, then the LLM judge, all failing closed. Only the scrubbed brief (no emails, phone numbers, PAN or long numbers) and the channel are sent to the AI vendor, never customer data. The disclosures are added by code, not by the model. The result is saved as an ordinary Draft marked "AI" for a person to edit; a draft that fails any check is not kept.

### Publishing (not wired)

`src/lib/marketing/social/publisher.ts` defines `SocialPublisher` (`checkReady` as a dry run, `publish` to hand a post over) and a fake adapter that records calls. The app uses only the fake, and only calls `checkReady` when a post is scheduled.

A real adapter, for example one for a self-hosted Postiz instance, is deliberately not included. To add one later:

1. Implement `SocialPublisher` against that service's API, with credentials entered by an Admin in Settings (encrypted like the other integrations) and its own off-by-default flag.
2. Select it in `getSocialPublisher`.
3. Drive `publish` from a separate action that a person presses on an Approved or Scheduled post, with its own confirmation. Do not add a timer or cron job that publishes.
4. Update the test that forbids calling `publish` from app code, and record the decision with the compliance officer.

## Data and erasure

New tables: `AdCreativeDaily`, `SocialPost`, `SocialPostEvent` (migration `20261220000000_marketing_workspace`, additive). None has a foreign key to a customer, so the data-privacy erasure transaction is unchanged. Post text is staff-written copy and holds no customer data; the AI brief is scrubbed before it is stored or sent.
