# CleverTap: before enabling writes

A short checklist for an Admin. The full runbook is `clevertap.md`. Nothing is written to CleverTap until every item below is true and `CLEVERTAP_PUSH_ENABLED=1` is set.

## 1. Region must be in1 (India)

- Customer data is written to CleverTap only in the India region. In Supportify the Region field must be exactly `in1` (spaces and upper case are tolerated).
- A blank region means CleverTap's default (Europe). A blank, `eu1` or any other region blocks every write; reads still work.
- Confirm with CleverTap that the India data centre is enabled for the account before you set `in1`, and that you understand what it means for existing profiles and campaigns.

## 2. Use the TEST project first

- A CleverTap account can hold several projects. Connect Supportify to the TEST project first, and read the Account ID in the CleverTap dashboard so it matches what you enter.
- Never connect a laptop, a developer machine or a local copy of Supportify to the production project. Credentials belong to the environment they were entered in.
- Verify on the TEST project that the app sets the app user id as the CleverTap Identity (the same value as `userId` in the signup feed) before enabling writes. If it does not, the push would create profiles the app does not know about.

## 3. The passcode is entered by an Admin in Settings

- The Account ID, Passcode, Region and Webhook Shared Secret are typed by an Admin in Settings, Apps & Integrations, on the live credentials form. They are stored encrypted.
- Never paste them into chat, email, tickets, documents, source code or environment files in the repository. Nobody, including an assistant or an automated tool, should be given the passcode.
- Saving replaces the whole set: enter all four fields each time.

## 4. Synthetic data only in any test project

- A test project, a staging copy or a developer database holds synthetic customers only: invented names, numbers like `9000000001`, emails at `example.test`, and app user ids that are random strings.
- Never copy real customers, real mobile numbers, real emails or real app user ids into a test project or a non-production database, even temporarily and even to reproduce a bug.
- Test the backfill and the merge flow on synthetic data first. The backfill is a dry run by default.

## 5. Then

1. Complete the checklist in `clevertap.md` section 4.1 (compliance, consent wording, how marketing uses `av_sales_paused`).
2. Decide on `APP_USER_ID_LINKING=1` (`clevertap.md` section 7) and run the backfill dry run.
3. Only then set `CLEVERTAP_PUSH_ENABLED=1`. The kill switch is to unset it.
