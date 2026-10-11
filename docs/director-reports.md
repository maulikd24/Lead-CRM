# Director reports and the weekly digest

Behind `DIRECTOR_REPORTS_ENABLED=1` (default off), for the **Admin** and **Marketing** roles only (central registry, area `marketing-reports`: view and export for both, manage for Admin). A **Reports** tab in the Marketing workspace, a printable page, shareable links and a weekly digest.

## The report

`src/lib/director/report.ts` (pure) blends four channels, Meta, Google, referrals and partners, into **funded customers and revenue** per channel and per campaign, with a comparison against the previous period of the same length. Every channel and campaign figure, and every cost per funded customer and return, is the canonical `CampaignOutcomeProvider`'s (`period.ts` maps one provider report into the report's shape and adds nothing): the report attributes nobody and divides no spend, and `outcome-contract.test.ts` pins that it agrees with Campaign impact and creative for one fixture.

- A figure the data does not have is `null` and prints as "Not available": never zero, never estimated. A channel that is not connected is listed as not connected.
- Wins, risks and next steps are plain English built **from the numbers** by fixed rules (no free-text generation). A trend is only claimed when the earlier period had at least 5 funded customers. Thresholds are listed in `THRESHOLDS` and are defaults.
- A **data freshness** stamp shows when each ad channel last synced and flags data older than 48 hours.
- A customer is counted once, under the **first** campaign, partner code or referral that reached them: the provider's rule, the same as Campaign impact. (An earlier version of this report let an ad win over a partner or referral code; that second definition of attribution is gone.) Spend for referrals and partners is not tracked here.
- Cost per funded customer and revenue per rupee are the provider's, over the campaigns that have spend, and revenue per rupee is shown for INR only.

## Printable page and share links

- `/report-print?from=&to=` (signed in, area `marketing-reports` export) renders the whole report with no app chrome, for A4 or "save as PDF". Opening it is audited.
- A **share link** (`/shared/report/[token]`) needs no sign-in and is the ONE unauthenticated surface of this module, registered as the named public surface `report-share-link` in `src/lib/access/surfaces.ts` with its own policy entry (what opens it, the controls it must carry) and tests (`public-surfaces.test.ts`, the page's own `page.test.tsx`, `creative.db.test.ts`). The token is 32 random bytes; only its SHA-256 is stored, and it is shown **once**, when the link is made. A link lasts 1 to 30 days (default 7), can be revoked at any time, and every open counts a view. Lookups are rate limited per address (60 per 10 minutes). A malformed token, an unknown token and a link still awaiting approval are the same plain 404.
- **Publication needs approval.** A new link is created awaiting approval and opens nothing until a person approves it (canonical approval kind `director-report`, a read-through adapter; the same function the Reports tab calls). Declining revokes it with a reason and it never opens. Whether a SECOND person must approve follows the approval setting (default off for report links; an Admin can switch it on in the Reports tab, Settings). Making a link is an export action; opening one is not an action at all, by design.
- The page reads a **stored snapshot** of aggregate numbers taken when the link was made, never live customer tables. The snapshot is scrubbed of anything that looks like an email, phone number or PAN, and keys that name personal data are dropped. It holds totals, channel names and campaign names only. Pages are `noindex` and send no referrer.

## Weekly digest

A job in the cron tick prepares a Monday summary of the last full week (Monday to Sunday, India time) once it is Monday 07:00 or later (it catches up later in the week if a tick was missed): an **in-app notice** (`marketing_weekly_digest`, visible to the marketing role only) for recipients who are Admin or Marketing users and a **draft email** stored for approval. **It never sends an email.** A person reads it, approves it and sends it from their own mail (the same decision exists in the Approvals inbox, kind `director-report`). The job is `director-digest` in the job registry (`runJob`), a no-op unless the flag and the setting are on, and it emits `campaign.report.digest.prepared` (and `.approved` or `.discarded` when a person decides) through `emit()`. One digest per week (the week start is unique). Recipients and the on or off switch are set by an Admin in the Reports tab; the job does nothing until they are.

## Events

`campaign.report.shared` (when a link is approved, so nothing is published by creating one), `campaign.report.share.revoked`, and the three digest steps. Ids and numbers only: never the token, an address, a title or a number from the report.

## Data and privacy

No table here references a customer (`schema-privacy.test.ts`, which also asserts that none of them is in the set of tables that do), so the erasure transaction and the foreign-key registry need no entry. Migrations `20270630000000_creative_reports` and `20270631000000_creative_report_approvals` are additive.

## Not built

Sending the digest from the system (needs a decided sender and consent to use one), a server-generated PDF file (the printable page saves as a PDF), per-campaign figures for referrals and partners.
