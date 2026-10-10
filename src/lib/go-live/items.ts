// The go-live checklist. "auto" items are computed live from the running system (see checks.ts) and can't be ticked by
// hand; "manual" items are things only a person can confirm (an account setting in Freshdesk, a policy, a test) and are
// ticked off on the Go-Live page. Keep ids stable — ticks are stored against them.

export type Priority = "BLOCKER" | "SHOULD" | "NICE";
export type Owner = "Admin" | "Tech" | "Marketing" | "Sales Ops" | "Compliance" | "Support";

export const AREAS = [
  "Platform & scheduler",
  "Lead sources & attribution",
  "Freshdesk",
  "Exotel & voicebot",
  "Clevertap",
  "WhatsApp, email & messaging",
  "Users, routing & data",
  "Security & compliance",
  "Customer intelligence",
  "Mobile app",
  "UAT & launch",
] as const;
export type Area = (typeof AREAS)[number];

export type GoLiveItem = {
  id: string;
  area: Area;
  title: string;
  detail: string;
  priority: Priority;
  owner: Owner;
  kind: "auto" | "manual";
};

const auto = (id: string, area: Area, title: string, detail: string, priority: Priority, owner: Owner): GoLiveItem => ({ id, area, title, detail, priority, owner, kind: "auto" });
const manual = (id: string, area: Area, title: string, detail: string, priority: Priority, owner: Owner): GoLiveItem => ({ id, area, title, detail, priority, owner, kind: "manual" });

export const GO_LIVE_ITEMS: GoLiveItem[] = [
  // ---------------------------------------------------------------- Platform & scheduler
  auto("env-core", "Platform & scheduler", "Core environment variables are set", "DATABASE_URL, DIRECT_DATABASE_URL, ENCRYPTION_KEY (64 hex characters), CRON_SECRET, an auth secret, and NEXTAUTH_URL pointing at your real https domain (not localhost or a vercel.app preview).", "BLOCKER", "Tech"),
  auto("db-migrations", "Platform & scheduler", "Database migrations are applied", "The most recent migration finished and none is rolled back. Pending migrations are applied by the Vercel build — confirm the latest deploy is green.", "BLOCKER", "Tech"),
  auto("cron-heartbeat", "Platform & scheduler", "Background scheduler is ticking", "The cron tick drives SLA alerts, KYC chasing, journeys, push and lead retries. It must have run in the last 15 minutes. On Vercel Hobby, GitHub Actions has run hours late — point an external 1-minute scheduler (e.g. cron-job.org) at POST /api/internal/cron/tick with the x-cron-secret header.", "BLOCKER", "Tech"),
  manual("cron-external", "Platform & scheduler", "External 1-minute scheduler configured and watched", "Set up cron-job.org (or similar) to call the tick every minute; keep the GitHub workflow as a backup. Jobs are idempotent, so double triggering is safe. Confirm it survives a day of running.", "BLOCKER", "Tech"),
  manual("uptime-monitor", "Platform & scheduler", "Uptime monitor on /api/health with alerts", "Add an uptime check on https://<your-domain>/api/health (503 when the database is down or the scheduler has stopped) and send alerts to a phone/WhatsApp, not just email.", "BLOCKER", "Tech"),
  auto("report-emails", "Platform & scheduler", "Report email recipient set", "DAILY_REPORT_RECIPIENT_EMAIL is set so the daily, weekly and monthly management reports (and send-failure alerts) have somewhere to go.", "SHOULD", "Admin"),
  manual("domain-ssl", "Platform & scheduler", "Custom domain, SSL and NEXTAUTH_URL aligned", "Production domain attached in Vercel, certificate valid, NEXTAUTH_URL matches it exactly, and links in emails/notifications open the right host.", "BLOCKER", "Tech"),
  manual("db-backups", "Platform & scheduler", "Database backups and a tested restore", "Confirm Prisma Postgres backup/point-in-time recovery for your plan and actually restore a copy once. Decide who can trigger a restore and how long data loss is acceptable.", "BLOCKER", "Tech"),
  manual("error-alerts", "Platform & scheduler", "Error monitoring and log retention", "Vercel log drain or Sentry (or equivalent) so a failing webhook/cron job pages someone. Note Hobby log retention is short — export what you need.", "SHOULD", "Tech"),
  manual("vercel-limits", "Platform & scheduler", "Vercel plan limits reviewed", "Function duration (AI summaries and PDF exports run long), bandwidth, and that Hobby terms allow commercial use — upgrade if not.", "SHOULD", "Tech"),
  manual("rollback-plan", "Platform & scheduler", "Rollback and incident plan written", "How to roll back a deploy (Vercel promote previous), who is on call during the first two weeks, and how staff are told about downtime.", "SHOULD", "Tech"),
  auto("stages-seeded", "Platform & scheduler", "Six onboarding stages exist and are active", "New Lead → Submitted for KYC → KYC completed → Pushed for funds → Introduction with Dealer → Onboarding Completed, with SLA hours you agree with.", "BLOCKER", "Admin"),
  auto("failed-leads", "Platform & scheduler", "No failed lead submissions", "Leads from ads/forms that errored (e.g. Meta Graph API down) are retried automatically; anything still failing after 5 attempts needs a human.", "BLOCKER", "Tech"),
  auto("mock-modes", "Platform & scheduler", "No integration is left in Mock mode", "A Mock integration authenticates nothing and is refused in production. Freshdesk, Exotel, Clevertap, Lead Sources and Resend email must be Live.", "BLOCKER", "Admin"),

  // ---------------------------------------------------------------- Lead sources & attribution
  auto("leadsrc-config", "Lead sources & attribution", "Lead Sources integration is Live with credentials", "Settings → Apps & Integrations → Lead Sources: website secret/form key + allowed origins, Google key, Meta app secret / verify token / page token. This is also the kill-switch: set to Mock to stop every ad/form source at once.", "BLOCKER", "Admin"),
  auto("leadsrc-traffic", "Lead sources & attribution", "Leads have arrived from each connected source (last 7 days)", "Shows leads per source (Meta Ads, Instagram Ads, Google Ads, Contact Form, Website/Blog Post). A source with zero leads after test submissions means it isn't wired up.", "BLOCKER", "Marketing"),
  manual("src-meta", "Lead sources & attribution", "Meta Lead Ads (Facebook) connected and tested", "Meta app in Live mode; permissions leads_retrieval, pages_show_list, pages_manage_metadata approved; Page subscribed to the leadgen field; webhook URL /api/webhooks/meta-leads verified; send a test lead from Meta's Lead Ads Testing Tool and confirm a client appears with source Meta Ads.", "BLOCKER", "Marketing"),
  manual("src-instagram", "Lead sources & attribution", "Instagram lead ads connected and tested", "Instagram instant forms use the same Meta webhook. Run an Instagram placement test lead and confirm it lands as source Instagram Ads (if it shows Meta Ads, Meta's platform field differs — tell the developer).", "BLOCKER", "Marketing"),
  manual("meta-token", "Lead sources & attribution", "Meta page token is long-lived and owned by a system user", "Use a system-user/long-lived page token so leads don't stop when an employee leaves or a token expires. Note the renewal date.", "SHOULD", "Marketing"),
  manual("src-google", "Lead sources & attribution", "Google Ads lead-form webhook connected and tested", "In each lead form asset set the webhook URL https://<domain>/api/leads/google-ads and the key; use 'Send test data'; then a real test lead. Covers Search, YouTube and Performance Max forms.", "BLOCKER", "Marketing"),
  manual("src-web-contact", "Lead sources & attribution", "Website contact form posts to Supportify", "Form posts (from your backend, or from the browser with the form key from an allowed origin) to https://<domain>/api/leads/web with name, phone, email, form='contact', consent=true and the UTM fields. Include the hidden honeypot field 'hp' (leave empty).", "BLOCKER", "Marketing"),
  manual("src-web-blog", "Lead sources & attribution", "Blog / landing-page forms post to Supportify", "Same endpoint with form='blog' (or landing). Confirm the page URL and UTMs are captured and the lead is labelled Website/Blog Post.", "BLOCKER", "Marketing"),
  manual("utm-convention", "Lead sources & attribution", "UTM naming convention agreed and used on every ad", "utm_source / utm_medium / utm_campaign (and content, term) in every ad URL and form. Attribution is only as good as the tags.", "SHOULD", "Marketing"),
  manual("wa-ads", "Lead sources & attribution", "WhatsApp click-to-chat ads tagged", "These arrive as Freshdesk WhatsApp tickets, not through the lead endpoints. Put a campaign code in the pre-filled message so the source is visible, and agree who owns them.", "SHOULD", "Marketing"),
  manual("src-other", "Lead sources & attribution", "Other sources decided: LinkedIn, aggregators, missed-call/QR, events, referrals", "For each: connect through Zapier/Make to /api/leads/web (LinkedIn Lead Gen, Justdial/IndiaMART email-forward), an Exotel missed-call number, or CSV import for events. Referrals already use the Referral source. Decide launch vs later.", "SHOULD", "Marketing"),
  manual("source-owners", "Lead sources & attribution", "Every source has an owner and a kill-switch plan", "Name who watches each source's volume daily in week one, and who can pause the ad or the integration if junk arrives.", "SHOULD", "Marketing"),
  manual("spam-protection", "Lead sources & attribution", "Form spam protection in place", "Honeypot enabled, allowed origins restricted, and (recommended) a CAPTCHA/Turnstile on public forms. Supportify rate-limits and de-duplicates but can't tell a real person from a bot.", "SHOULD", "Marketing"),
  manual("lead-speed", "Lead sources & attribution", "Speed-to-lead target agreed", "New paid leads are HIGH priority with a 'call within 15 minutes' task and a phone push. Agree the working-hours rule and who covers evenings/weekends.", "BLOCKER", "Sales Ops"),
  manual("lead-dedupe-rules", "Lead sources & attribution", "Duplicate handling understood by the team", "A repeat enquiry from an existing client is logged as a new touch and notifies the owning RM — it does not create a second lead. Walk the team through this.", "SHOULD", "Sales Ops"),

  // ---------------------------------------------------------------- Freshdesk
  auto("freshdesk-config", "Freshdesk", "Freshdesk integration is Live with API key and webhook secret", "Domain, API key, and the shared secret that Freshdesk's webhook sends as X-Webhook-Secret.", "BLOCKER", "Admin"),
  auto("freshdesk-traffic", "Freshdesk", "Freshdesk has delivered a ticket to Supportify", "Last delivery time from Freshdesk. No delivery yet means the Automation Rule isn't firing or the secret doesn't match.", "BLOCKER", "Support"),
  manual("fd-rule-channels", "Freshdesk", "Two Automation Rules post tickets to Supportify (created and updated)", "Ticket Creation rule and Ticket Updates rule → webhook to https://<domain>/api/webhooks/freshdesk, header X-Webhook-Secret, JSON body as in the README (event, ticket_id, status, priority, channel, requester_name/email/phone/mobile, subject). Cover Email, Chat, WhatsApp and Exotel-created tickets.", "BLOCKER", "Support"),
  manual("fd-test-each", "Freshdesk", "One test ticket per channel verified end to end", "Email, Live Chat, WhatsApp and a voicebot call each produce (or match) the right client with the right Lead Source and a readable timeline entry.", "BLOCKER", "Support"),
  manual("fd-phone", "Freshdesk", "WhatsApp and call tickets carry the phone number", "Without a phone the contact can only be matched by email. Check the requester phone field is populated for WhatsApp and calls.", "BLOCKER", "Support"),
  manual("fd-spam", "Freshdesk", "Decision on non-customer email (newsletters, vendors, auto-replies)", "Every new email address that opens a ticket becomes a lead. Filter noise in Freshdesk (spam/blocked senders, rule conditions) or accept and clean up. Decide before launch.", "BLOCKER", "Support"),
  manual("fd-replies", "Freshdesk", "Team knows what is mirrored into Supportify", "Each ticket appears once on the client (Support tab + timeline) and its status stays current; full history is pulled for every client matched by phone or email. Reply text stays in Freshdesk — agree that Freshdesk is the conversation record.", "SHOULD", "Support"),
  manual("fd-agents", "Freshdesk", "Agents, groups, SLAs and canned replies configured", "Who answers which channel, business hours, and Freshdesk SLAs aligned with Supportify's New Lead SLA.", "SHOULD", "Support"),
  manual("fd-existing-clients", "Freshdesk", "Support tickets from existing clients behave as intended", "A ticket from a known phone/email attaches to that client (no new lead). Test with a real existing client.", "BLOCKER", "Support"),

  // ---------------------------------------------------------------- Exotel & voicebot
  auto("exotel-config", "Exotel & voicebot", "Exotel integration is Live with credentials and webhook secret", "SID, API key/token, Exophone, and the shared secret used in the ?secret= callback parameter.", "BLOCKER", "Admin"),
  auto("exotel-traffic", "Exotel & voicebot", "Exotel has delivered a call event to Supportify", "Last delivery from Exotel. Required for call logging and Quality Audit (recording → transcript) — the Exotel→Freshdesk link alone doesn't give Supportify the recording.", "BLOCKER", "Support"),
  manual("ex-callback", "Exotel & voicebot", "Exotel callback URL points at Supportify with the secret", "https://<domain>/api/webhooks/exotel?secret=<secret> on call-complete for every Exophone and flow the voicebot uses.", "BLOCKER", "Support"),
  manual("ex-from", "Exotel & voicebot", "Confirmed which number Exotel reports as the customer", "For inbound, outbound and voicebot calls, check the callback's From/To so Supportify matches the customer's number, not your Exophone or agent. Place one call each way and read the logged activity.", "BLOCKER", "Support"),
  manual("ex-voicebot", "Exotel & voicebot", "Voicebot flow tested including hand-off to a human", "Call the number, finish a conversation, and confirm: ticket in Freshdesk, call activity on the client, lead created for an unknown number.", "BLOCKER", "Support"),
  manual("ex-voice-analyze", "Exotel & voicebot", "ExoVoiceAnalyze (transcription) enabled", "Needed for Quality Audit. Make a test call and confirm a Quality Audit entry appears (it will be a placeholder score until the Anthropic key is set).", "SHOULD", "Support"),
  manual("ex-dnd", "Exotel & voicebot", "Outbound calling complies with DND/NCPR rules", "Check numbers against the DND registry before outbound campaigns, use the right call window, and disclose recording.", "BLOCKER", "Compliance"),
  manual("ex-recording", "Exotel & voicebot", "Call recording retention and consent announced", "Recording announcement in the flow and a retention period that satisfies your regulator.", "BLOCKER", "Compliance"),

  // ---------------------------------------------------------------- Clevertap
  auto("clevertap-config", "Clevertap", "Clevertap integration is Live with credentials", "Account ID, passcode, region, and webhook secret (the X-Webhook-Secret header on the Clevertap webhook).", "SHOULD", "Admin"),
  manual("ct-identity", "Clevertap", "CleverTap Identity is the app user id everywhere", "Profiles are keyed by the app user id (the identity provider user id the app sets as Identity). Confirm the app SDK uses the same value and that no other tool (website SDK, Freshdesk) writes profiles keyed by phone, email or client code. Mixing keys creates duplicate profiles.", "BLOCKER", "Marketing"),
  manual("ct-sync-journeys", "Clevertap", "Journeys exist that sync profiles to Clevertap", "In Supportify Journeys add a 'Sync to Clevertap' step on client created and on stage changes so Clevertap has current name, phone, email and status. Without it, Clevertap only knows what its own SDK saw.", "BLOCKER", "Marketing"),
  manual("ct-events", "Clevertap", "Engagement journeys designed in Clevertap with the events available", "Supportify currently pushes profile data, not an event stream (stage, KYC, funding events). Design the first journeys around profile attributes, or request the event push as a fast follow.", "SHOULD", "Marketing"),
  manual("ct-webhook", "Clevertap", "Clevertap webhook back to Supportify tested", "Campaign events for a known client appear on their timeline; events for an unknown address are ignored (they no longer create leads).", "SHOULD", "Marketing"),
  manual("ct-consent", "Clevertap", "Consent and unsubscribe are respected", "Marketing consent captured on forms is stored on the client; make sure opt-outs in Clevertap are honoured and, ideally, reflected back.", "BLOCKER", "Compliance"),
  manual("ct-channels", "Clevertap", "Clevertap channels registered", "WhatsApp templates approved, SMS sender ID and DLT templates registered, email domain authenticated (SPF/DKIM/DMARC).", "BLOCKER", "Marketing"),

  // ---------------------------------------------------------------- WhatsApp, email & messaging
  auto("resend-config", "WhatsApp, email & messaging", "Resend (email alerts) is Live", "SLA breach emails and report failures depend on it. From-address on an authenticated domain.", "SHOULD", "Admin"),
  auto("templates-approved", "WhatsApp, email & messaging", "At least one approved message template exists", "Only approved templates can be sent. WhatsApp templates must also be approved by the provider.", "SHOULD", "Admin"),
  manual("wa-channel-decision", "WhatsApp, email & messaging", "Decision: which WhatsApp is customer-facing", "Freshdesk's official WhatsApp number is the supported channel. The Supportify inbox over RMs' own numbers is unofficial (ban risk) and needs a separate always-on worker. Decide whether to use it at launch.", "BLOCKER", "Sales Ops"),
  auto("wa-inbox", "WhatsApp, email & messaging", "WhatsApp inbox numbers connected (only if you use the inbox)", "Each RM number shows CONNECTED with a recent heartbeat. Skip if you are not launching the inbox.", "NICE", "Tech"),
  manual("wa-optin", "WhatsApp, email & messaging", "WhatsApp opt-in captured before business-initiated messages", "Form consent text covers WhatsApp/SMS/email/calls explicitly.", "BLOCKER", "Compliance"),

  // ---------------------------------------------------------------- Users, routing & data
  auto("admins-two", "Users, routing & data", "At least two active Admins", "So no single person's absence or locked account blocks you.", "BLOCKER", "Admin"),
  auto("rm-ready", "Users, routing & data", "RMs are ready to receive leads", "At least one available RM with a manager, plus regions/languages/capacity set where you route by them.", "BLOCKER", "Sales Ops"),
  auto("assignment-mode", "Users, routing & data", "Lead assignment mode chosen deliberately", "Load-based, Round robin or Manual (Settings → Lead Assignment). Paid leads usually suit Round robin; HNI/referral flows may suit Manual.", "BLOCKER", "Sales Ops"),
  auto("demo-users", "Users, routing & data", "No demo or test accounts remain", "Users with @allvest.local / @supportify.local addresses are demo or seed accounts. Delete them or change their passwords before launch.", "BLOCKER", "Admin"),
  auto("demo-data", "Users, routing & data", "No demo clients or households remain", "Records with CL-DEMO / HH-DEMO codes are stakeholder-demo data and must not appear in live reports.", "BLOCKER", "Admin"),
  manual("offline-import", "Users, routing & data", "Offline client import rehearsed on a copy", "CSV bulk import (up to 1,000 rows) run on a test list: columns, PAN/mobile duplicates, referral sources, assignment. Then import the real list.", "BLOCKER", "Sales Ops"),
  manual("team-roles", "Users, routing & data", "Roles reviewed with least privilege", "Admins, Managers, RMs, Dealers (and partners/finance if used) each see only what they should; try a login for each role.", "BLOCKER", "Admin"),
  manual("training", "Users, routing & data", "Staff trained and the Handbook shared", "Run through client creation, KYC steps, funding, the Inbox/Freshdesk split, and how to report an issue (Debugger).", "SHOULD", "Sales Ops"),
  manual("kyc-process", "Users, routing & data", "KYC verification process agreed", "No automated verification vendor is connected in production: every KYC step is verified by hand by an Admin/Manager. Confirm the manual process, or integrate a vendor before launch.", "BLOCKER", "Compliance"),
  auto("kyc-provider", "Users, routing & data", "KYC automation setting is safe for production", "KYC_AUTOMATION_PROVIDER must be unset or a real vendor — never the mock.", "BLOCKER", "Tech"),

  // ---------------------------------------------------------------- Security & compliance
  manual("pw-rotation", "Security & compliance", "Passwords and secrets rotated and stored safely", "No default or shared passwords, unused Prisma credentials deleted, secrets in a password manager, a list of who has Vercel/GitHub/Prisma access.", "BLOCKER", "Tech"),
  manual("mfa", "Security & compliance", "MFA / IP allow-listing risk accepted or planned", "Supportify does not yet offer MFA or IP allow-listing. Mitigate with strong passwords, the lockout (5 failures), and SSO/MFA on Vercel, GitHub, Freshdesk and the email accounts that can reset passwords.", "SHOULD", "Compliance"),
  manual("dpdp", "Security & compliance", "DPDP: consent wording, notice and grievance contact", "Consent text on every form (stored with the lead), a privacy notice, a way to access/erase data (Settings → Data Privacy), and a named grievance officer.", "BLOCKER", "Compliance"),
  manual("sebi-records", "Security & compliance", "SEBI record-keeping for communications", "Decide the system of record for calls, WhatsApp, email and chat, the retention period, and that Freshdesk/Exotel retention settings match it.", "BLOCKER", "Compliance"),
  manual("activity-notice", "Security & compliance", "Staff informed about activity logging", "The Activity Log records sign-ins, page views and every change per user. Tell employees, in line with policy.", "BLOCKER", "Compliance"),
  manual("data-retention", "Security & compliance", "Retention and erasure policy decided", "Activity and audit records are kept indefinitely today; decide whether a purge is needed and who approves erasure requests.", "SHOULD", "Compliance"),
  manual("vendor-dpas", "Security & compliance", "Data-processing terms with vendors", "Freshdesk, Exotel, Clevertap, Vercel, Prisma, OpenAI and Anthropic process personal data (AI summaries send names and figures, never PAN/phone/email).", "SHOULD", "Compliance"),

  // ---------------------------------------------------------------- Customer intelligence
  auto("intel-coverage", "Customer intelligence", "Every customer has an intelligence profile", "Lifecycle stage, asset-class acceptance and next best action are computed in the background (25 customers per tick). A large gap means the scheduler is behind.", "SHOULD", "Tech"),
  auto("intel-extraction", "Customer intelligence", "Conversation insights are being extracted", "Needs ANTHROPIC_API_KEY. Once calls, WhatsApp threads or RM notes exist, insights (interests, objections, complaints, promises) should start appearing.", "SHOULD", "Tech"),
  manual("intel-thresholds", "Customer intelligence", "Business thresholds reviewed", "Large outside portfolio ₹25 L, mutual funds to transfer ₹5 L, idle cash ₹5 L, review overdue after 180 days, dormant after 90 days. Confirm these suit your customers, or ask for them to be changed.", "SHOULD", "Sales Ops"),
  manual("intel-acceptance-rules", "Customer intelligence", "Asset-class acceptance rules reviewed with sales leadership", "PMS/AIF start Medium only for HNI profiles, bonds High for conservative investors, tax planning High in January–March. Sanity-check a handful of real customers' acceptance.", "SHOULD", "Sales Ops"),
  manual("intel-outcome-habit", "Customer intelligence", "RMs trained to log an outcome after interactions", "The feedback loop only works if RMs press Log outcome. Make it part of the daily routine and watch the Customer Intelligence page.", "SHOULD", "Sales Ops"),
  manual("intel-suitability", "Customer intelligence", "Suitability and advice rules agreed for PMS / AIF suggestions", "Suggestions are prompts for an RM conversation, not advice. Confirm your suitability process still applies before any PMS/AIF pitch.", "BLOCKER", "Compliance"),
  manual("intel-ai-bots", "Customer intelligence", "Decision on AI agents (not built into the app)", "The app provides a briefing API and outcome API for future WhatsApp/calling bots, protected by AGENT_API_KEY. No bot is included. Decide whether and when to build or buy one before enabling AI_AGENTS_ENABLED.", "NICE", "Tech"),

  // ---------------------------------------------------------------- Mobile app
  auto("push-config", "Mobile app", "Phone push is configured", "FIREBASE_SERVICE_ACCOUNT_JSON set, and at least one phone has registered.", "SHOULD", "Tech"),
  manual("apk-signed", "Mobile app", "Signed APK built and distributed", "GitHub secrets set, Build Android APK workflow run, APK installed on an RM phone, and the 'Allow restricted settings' step for call-log access explained.", "SHOULD", "Tech"),
  manual("call-sync-consent", "Mobile app", "Call-sync consent and policy confirmed", "Staff understand only calls with their own clients are stored; personal calls never are.", "SHOULD", "Compliance"),
  auto("ai-keys", "Mobile app", "AI keys configured (if you want AI summaries and Quality Audit)", "OPENAI_API_KEY for summaries, ANTHROPIC_API_KEY for Quality Audit. Without them the buttons say they aren't set up, or show a labelled placeholder.", "NICE", "Tech"),

  // ---------------------------------------------------------------- UAT & launch
  manual("uat-leads", "UAT & launch", "UAT: one lead per channel", "Google, Meta, Instagram, contact form, blog form, Freshdesk email, chat, WhatsApp, and an Exotel/voicebot call each produce the right client, source, assignee, notification and task.", "BLOCKER", "Sales Ops"),
  manual("uat-lifecycle", "UAT & launch", "UAT: full onboarding on a test client", "New Lead → documents → KYC steps → approval → funding → dealer → Mark Onboarding Completed, with the right people doing each step.", "BLOCKER", "Sales Ops"),
  manual("uat-duplicates", "UAT & launch", "UAT: duplicate and re-enquiry behaviour", "Same person from two sources stays one client; a known client enquiring again notifies their RM.", "BLOCKER", "Sales Ops"),
  manual("uat-sla", "UAT & launch", "UAT: SLA, notifications and push", "Let a test lead approach and breach its SLA; confirm the bell, phone push and manager escalation fire.", "BLOCKER", "Sales Ops"),
  manual("uat-reports", "UAT & launch", "UAT: reports and the 9 PM email", "Manager Dashboard, Reports and the daily email show sensible numbers with only real data.", "SHOULD", "Admin"),
  manual("cron-48h", "UAT & launch", "Scheduler verified for 48 hours before launch", "Check /api/health and the Go-Live heartbeat daily until launch; fix any gaps.", "BLOCKER", "Tech"),
  manual("go-no-go", "UAT & launch", "Go / no-go meeting held", "All BLOCKER items green or consciously accepted in writing, with owners for any exception.", "BLOCKER", "Admin"),
  manual("soft-launch", "UAT & launch", "Phased launch plan", "Start with one source (website form) and internal test leads for 2–3 days, then enable paid sources one at a time, each with a sign-off.", "SHOULD", "Marketing"),
  manual("hypercare", "UAT & launch", "Hypercare rota for the first two weeks", "Daily check of System Overview and this page; named owner and escalation contacts; a place for staff to report issues quickly.", "SHOULD", "Admin"),
];

export const ITEM_BY_ID = new Map(GO_LIVE_ITEMS.map((item) => [item.id, item]));
