# Director reports and the weekly digest

Behind `DIRECTOR_REPORTS_ENABLED=1` (default off), for the **Admin** and **Marketing** roles only (`canAccessMarketing`). A **Reports** tab in the Marketing workspace, a printable page, shareable links and a weekly digest.

## The report

`src/lib/director/report.ts` (pure) blends four channels, Meta, Google, referrals and partners, into **funded customers and revenue** per channel and per campaign, with a comparison against the previous period of the same length.

- A figure the data does not have is `null` and prints as "Not available": never zero, never estimated. A channel that is not connected is listed as not connected.
- Wins, risks and next steps are plain English built **from the numbers** by fixed rules (no free-text generation). A trend is only claimed when the earlier period had at least 5 funded customers. Thresholds are listed in `THRESHOLDS` and are defaults.
- A **data freshness** stamp shows when each ad channel last synced and flags data older than 48 hours.
- A customer is counted once. Someone who came through a Meta or Google ad stays with that ad channel even if a referral or partner code was also used (partner before referral otherwise), so the report's ad numbers equal the Marketing Overview. Spend for referrals and partners is not tracked here.
- Cost per funded customer is ad spend over funded customers from ads; revenue per rupee is shown for INR spend only.

## Printable page and share links

- `/report-print?from=&to=` (signed in) renders the whole report with no app chrome, for A4 or "save as PDF". Opening it is audited.
- A **share link** (`/shared/report/[token]`) needs no sign-in. The token is 32 random bytes; only its SHA-256 is stored, and it is shown **once**, when the link is made. A link lasts 1 to 30 days (default 7), can be revoked at any time, and every open counts a view. Lookups are rate limited per address.
- The page reads a **stored snapshot** of aggregate numbers taken when the link was made, never live customer tables. The snapshot is scrubbed of anything that looks like an email, phone number or PAN, and keys that name personal data are dropped. It holds totals, channel names and campaign names only. Pages are `noindex` and send no referrer.

## Weekly digest

A job in the cron tick prepares a Monday summary of the last full week (Monday to Sunday, India time) once it is Monday 07:00 or later (it catches up later in the week if a tick was missed): an **in-app notice** for recipients who are Admin or Marketing users and a **draft email** stored for approval. **It never sends an email.** A person reads it, approves it and sends it from their own mail. One digest per week (the week start is unique). Recipients and the on or off switch are set by an Admin in the Reports tab; the job does nothing until they are.

## Not built

Sending the digest from the system (needs a decided sender and consent to use one), a server-generated PDF file (the printable page saves as a PDF), per-campaign figures for referrals and partners.
