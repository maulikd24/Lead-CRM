# Meta Ads reporting (read-only)

The Marketing page shows what Meta ad spend brings in, from an ad click to a funded customer. It only reads from Meta. It never creates, edits or publishes a campaign, and sends nothing back to Meta.

## Switches (all off by default)

| Switch | Where | Effect |
| --- | --- | --- |
| `META_ADS_SYNC_ENABLED=1` | Server environment | Lets the scheduled tick pull ad spend. Without it the sync job does nothing. |
| `NEXT_PUBLIC_MARKETING=1` | Build-time environment | Shows the Marketing menu item and the `/marketing` page (Admin and Manager). Needs a rebuild to change. |
| `META_ADS_SYNC_EVERY_HOURS` | Server environment, optional | Minimum hours between syncs. Default 6. |

The sync also needs the Meta Ads integration switched to Live with credentials. With any of these missing, the page shows an honest "not connected" or "waiting for the first sync" state.

## Set-up

1. In Meta Business Settings create a **system user** and assign it the ad account with at least view access.
2. Generate a token for the system user with the **`ads_read`** permission only. No write permission is needed or used.
3. In Apps & Integrations open **Meta Ads (reporting)**, switch to Live, enter the ad account id (digits, an `act_` prefix is fine) and the token, save, then use Test Connection. It makes one read: the account name, currency and timezone.
4. Set `META_ADS_SYNC_ENABLED=1` and, to see the page, build with `NEXT_PUBLIC_MARKETING=1`.
5. Add `utm_campaign={{campaign.id}}` to ad URLs and keep campaign names unique, so website leads can be matched too.

The token is stored encrypted, sent in the `Authorization` header (never in a URL) and never logged. The Graph API version defaults to `v23.0` and can be changed in the same card (field "Graph API version").

## What is stored

- `AdCampaignDaily`: one row per campaign per day in the ad account's own timezone, with spend in minor units plus currency, impressions, clicks, reach and Meta-reported leads. It holds no personal data and has no link to a customer.
- `AdSyncRun`: one row per sync attempt with its window, status (`SUCCESS`, `PARTIAL`, `FAILED`, `RATE_LIMITED`), counts and a short safe error message.

Each run re-reads the trailing 7 days (the first run reads 30) so late conversions are captured; rows are upserted, so repeating a run changes nothing. A run stops after 60 seconds, on a rate limit (it retries after a 15 minute cooldown) or on a token error.

## How a lead is matched to a campaign

Only leads that came from Meta (intake source, lead source, platform, `utm_source` or `fbclid`) are matched, in this order, first rule that finds one campaign wins:

1. `campaign_id` equals a synced campaign id (or the `campaign` field holds an id).
2. The `campaign` name equals a synced campaign name after ignoring case, accents, punctuation and spacing.
3. `utm_campaign`, as an id and then as a normalised name.

If a name belongs to several campaigns, the one that had spend on the lead's day or in the 3 days before is chosen, but only if exactly one did. Otherwise the lead is **unattributed** with a reason (no campaign details, no match, ambiguous name). A customer counts once, even if two records carry the same provider lead id.

## Formulas

| Measure | Formula |
| --- | --- |
| Spend | Sum of daily spend in range, in the account currency |
| Cost per lead | Spend / leads received in the CRM (Meta-reported cost per lead shown beside it) |
| KYC rate | Approved KYC / leads |
| Cost per approved KYC | Spend / approved KYC |
| Cost per funded customer | Spend / funded customers (funding record partly or fully funded, or a successful funds-in payment) |
| Funded AUM | Current value of those customers' holdings (latest snapshot per account) |
| AUM per rupee | Funded AUM / spend (INR accounts only) |
| ROAS | Brokerage and fee revenue booked for those customers / spend (INR accounts only; blank when no revenue yet) |

Outcomes follow the leads created in the range, wherever those customers are today, so the latest days understate what they will become.

## Quality flag (per campaign, plain words)

- **Spending, no leads**: spend and 1,000+ impressions but no leads.
- **Leads not reaching the CRM**: 10+ Meta leads and fewer than half as many in the CRM.
- **Too early to judge**: fewer than 10 CRM leads.
- **Cheap leads, none funded**: 10+ leads, none funded, cost per lead at or below the account average.
- **No funded customers yet**: same, but above-average cost per lead.
- **Efficient / On par / Expensive per funded customer**: cost per funded customer at most 0.75x, within, or at least 1.5x the account average.

## Limits

No Meta account was available while building this, so it is tested with injected fakes only; the first live connection should be checked against a real account. Amounts in a currency other than the dominant one are left out and noted on the page.
