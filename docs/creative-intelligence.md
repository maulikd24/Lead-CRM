# Creative intelligence, compliant ad copy and experiments

Four tabs in the Marketing workspace, behind `NEXT_PUBLIC_CREATIVE_INTEL=1` (default off) and visible only to the **Admin** and **Marketing** roles. Everything goes through one helper, `canAccessMarketing(role)` in `src/lib/access/marketing-access.ts`: pages, server actions, the printable annexure and the weekly job all use it. Managers, relationship managers and finance get none of it (a deep link to a hidden tab falls back to Overview; actions redirect).

Nothing here publishes an ad, changes an ad account or sends anything. The furthest an ad copy variant can go is **Approved**, and a person takes it from there.

## Insights

Per-ad performance by **funded outcome**, fatigue detection, "what the winners share", and tags.

- Numbers come from a `CampaignOutcomeProvider` (`src/lib/creative/outcomes.ts`): spend, leads, contacted-in-time, KYC, funded customers and revenue by campaign or ad and period. The simple implementation reads the data the Marketing workspace already has; a fake serves tests and demos; the attribution module supplies its own implementation later and nothing else changes. A number the provider does not have is `null` and shows as "Not available".
- Ad-level funded counts need an **ad id on each lead** (`ad_id`, or `utm_content` matching an ad id or a unique ad name). Without it an ad shows the platform's own numbers and says so; nothing is guessed.
- **Fatigue** (`fatigue.ts`) judges the last 28 days: average daily frequency (only where reach is reported), click-through rate decay and cost-per-lead drift, each against the window before, and only with enough volume. One signal is "Watch", two or more is "Tired", too little data is "Too early". All thresholds are labelled defaults and editable in the Thresholds sheet.
- **What the winners share** (`winners.ts`) takes the third of creatives with the lowest cost per funded customer (each with at least 2 funded customers) and reports tags most of them carry and the rest do not. It needs at least 6 tagged creatives and 15 funded customers, otherwise it says "Not enough data yet".
- **Tags** (format, hook, offer, length, call to action) are entered by a person (confirmed) or suggested as **drafts** by rules or by the draft-only AI path. A draft is labelled wherever it is used, and a suggestion never overwrites a confirmed tag.

## Briefs and copy drafts

One brief (topic, audience, language English or Hinglish, hook style, channels) becomes a **master hook, USP and call to action** plus a variant for each channel format. Validated with zod (`kit.ts`).

- **Channel formats** (`formats.ts`): Google responsive search ads, Meta feed, LinkedIn single image, YouTube video and TikTok in-feed, each with field limits and live character counters. The limits are **defaults written from public platform guidance** and shortened where a platform only recommends a length. Check them against the current specifications before booking; they live in one table.
- **Previews** show roughly how each variant will look. They are approximate and use neutral placeholders.
- **Shared copy rules** (`rules.ts`), one module for every channel: no guaranteed or assured returns; performance claims only beside the past-performance disclaimer; the risk disclosure present (wording configurable); no testimonials where prohibited (configurable); no urgency or scarcity; no advice; no unverifiable superlatives, hype or gifts for investing; the honesty rule (a number about clients, assets or rankings needs a named source); no unresolved placeholders; the firm's own banned words and regulated-claims list; the shared safety layer used by the messaging agents. Each rule shows pass, fail or not applicable, and a failing rule shows **the exact phrase it matched**. A CTA formula check (one verb, one next step, no pressure) is advisory.
- Every variant carries `complianceStatus` (PASS or FAIL). It is recomputed on the saved text at every gate; a stored result is never trusted. A variant cannot move to Needs review or Approved while any rule fails.
- **Workflow**: Draft, Needs review, Approved. Approval needs the reader's tick, and for copy a person wrote, a **second person** (four eyes; an AI draft has no human author). Editing withdraws an approval. Every step is an append-only event and the approval is in the audit log.
- **Scoring rubric** (`rubric.ts`): six criteria, 100 points, verdict **scale / iterate / rewrite**. A compliance failure overrides any score: the verdict is rewrite and the score is still shown.
- **Brand profile** (`brand.ts`): tone, audience segments, regulated claims, banned words and the mandatory disclaimers as structured context. Versioned: saving creates a new version, and a brief records the version it was checked against. The disclaimer wording and the registration line must be confirmed by the firm's compliance officer.
- **AI path** (`ai.ts`): the same stack as the messaging agents. Kill switch (the environment flag AND an enabled `creative_drafter` AgentSetting row), the shared provider, the LLM judge, all failing closed. Only the scrubbed brief and the format list go to the vendor. The disclaimers are added by code, never by the model, and an AI draft is checked by exactly the same rules as one a person wrote.
- **Printable annexure** (`/creative-print/[briefId]`): the approved copy per channel, its checklist, who approved it and when, a fingerprint of the exact text and blank sign-off lines, to attach to the firm's ad-approval process. It is a record; it does not approve or publish. Opening it is audited.

## Competitor ads (manual)

A saved list of competitors, ads added by hand or imported from a CSV (`competitor, copy, format, start_date, link, thumbnail_ref`), cards sorted by days live, hook and offer tags (human or draft suggestions), and **Use as brief reference**.

- Only a manual and CSV provider exists. **No scraper and no vendor is connected.** The `CompetitorAdsProvider` interface lets an official ad library or a vendor be added later, after its terms and its coverage of Indian advertisers are checked.
- A thumbnail is stored as a **pointer** (a web address or a short reference), never the image. A pointer holding embedded image data is refused.
- A reference is inspiration only. The brief receives tags and facts, never the competitor's wording, and a draft that echoes a reference too closely fails the originality check.

## Experiments

An experiment log: hypothesis, deciding metric, smallest lift worth acting on, **sample-size guidance written for low volume** (people per arm, days to finish at the stated volume, the smallest lift detectable in 4 weeks, and advice when the test is not realistic), start and end, decision and learning, linked to campaigns. A small "read a finished test" helper calls a difference only with enough data and says "no difference detected", never "proved equal". Standard two-sided test of two proportions, 5% significance and 80% power.

## Data and privacy

No table here references a customer. Briefs, variants, tags, competitor ads, experiments and settings hold staff-written text and aggregate numbers, so the data-privacy erasure transaction is unchanged; `schema-privacy.test.ts` fails if one ever gains a customer link.

## Where things are

`src/lib/creative/` (pure logic and stores), `src/app/(dashboard)/marketing/` (the tabs and actions), `src/app/creative-print/` (annexure). Migration `20270340000000_creative_reports` is additive; it also adds the `MARKETING` role value.
