# Google Ads reporting (read-only)

The Marketing workspace can show Google Ads next to Meta: spend, clicks, impressions, leads, cost per lead and revenue by campaign, and spend and cost per lead by ad. It only reads from Google. It never creates, edits, pauses or budgets anything, and sends nothing back.

## Switches (all off by default)

| Switch | Where | Effect |
| --- | --- | --- |
| `GOOGLE_ADS_REPORTING_ENABLED=1` | Server environment | Lets the scheduled tick pull Google Ads data, and shows Google in the Marketing workspace. Without it the sync job does nothing and Google is not mentioned on the page. |
| `GOOGLE_ADS_SYNC_EVERY_HOURS` | Server environment, optional | Minimum hours between syncs. Default 6. |
| `NEXT_PUBLIC_MARKETING=1` | Build-time environment | Shows the Marketing page (same switch as the Meta report). |

The sync also needs the Google Ads integration switched to Live in Apps & Integrations with every credential entered.

## Set-up

1. In Google Ads, note the **customer ID** of the account to report on (10 digits, dashes are fine). If you reach it through a manager (MCC) account, also note the manager's ID.
2. Get a **developer token** from the Google Ads API Center. Read-only (Explorer or Basic) access is enough.
3. Create an **OAuth client** in Google Cloud and authorise it, with the `https://www.googleapis.com/auth/adwords` scope, as a user who has read access to the account. Keep the resulting **refresh token**.
4. In Apps & Integrations open **Google Ads (reporting)**, switch to Live and enter the customer ID, the optional manager ID, the developer token, the OAuth client ID and secret, and the refresh token. Save, then use Test Connection: it makes one read of the account name, currency and timezone.
5. Set `GOOGLE_ADS_REPORTING_ENABLED=1`.
6. For website leads to match a campaign, add `utm_campaign={campaignid}` to the final URL suffix. Leads from Google lead forms already carry the campaign id.

Every credential is entered by an Admin in Settings and stored encrypted like the other integrations. Nothing is read from environment variables, nothing is logged, and secrets are never placed in a URL or an error message. The API version defaults to `v22`; Google supports each version for about a year, so check it and set the field "API version" in the same card when it changes (no deploy needed).

## What is stored

- `AdCampaignDaily` (provider `google`): one row per campaign per day in the account's own timezone, with spend in minor units plus currency, impressions, clicks and the platform's conversion count in the `leads` column. Google has no campaign-level reach, so `reach` is 0.
- `AdCreativeDaily`: one row per ad per day, same measures, for the Creative tab. It holds no personal data and no link to a customer.
- `AdSyncRun`: one row per sync attempt, as for Meta.

Each run re-reads the trailing 7 days (the first run reads 90) so late conversions are captured. Rows are upserted, so repeating a run changes nothing. A run stops after 60 seconds, on a rate limit (retry after a 15 minute cooldown) or on a credentials error. If reading ads fails, the campaign data from the same run is kept and the run's note says that ad-level data was skipped.

## How a lead is matched to a Google campaign

Only leads that came from Google are matched: the Google lead-form intake, a `gclid`, a Google lead source or platform, or a Google `utm_source`. A lead carrying a Meta marker (a `fbclid`, the Meta lead-form intake, a Meta lead source or platform) is never counted as Google, so no lead is in two channels. The matching order is the same as for Meta, and the first rule that finds one campaign wins:

1. `campaign_id`, or the `campaign` field holding an id (that is where the Google lead form stores it).
2. The `campaign` name, ignoring case, accents, punctuation and spacing.
3. `utm_campaign`, as an id and then as a name.

Revenue by campaign uses the same net revenue as Meta: brokerage and advisory fees, with reversals subtracting, for the customers who came from that campaign.

## Limits

- No Google Ads account was available while building this, so it is tested with injected fakes only. The first live connection should be checked, in particular that `metrics.conversions` is the lead measure you care about (it counts every conversion action on the account) and that the API version is still supported.
- Google reports ad-level leads as its own count. The CRM can only attribute a lead to a campaign, so cost per lead by ad is the platform's view.
- Amounts in a currency other than the dominant one are left out and noted on the page.
