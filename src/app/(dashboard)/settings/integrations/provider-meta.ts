export const PROVIDER_META: Record<
  string,
  {
    label: string;
    description: string;
    fields: { key: string; label: string; placeholder?: string; /** Not a secret: shown as plain text instead of a password box. */ plain?: boolean }[];
    supportsTest?: boolean;
  }
> = {
  freshdesk: {
    label: "Freshdesk",
    description:
      "Helpdesk ticketing (Freshdesk Omni: Email, Live Chat & WhatsApp) — creates tickets from journey actions, and inbound tickets from an unrecognized email/phone create a new client profile automatically.",
    fields: [
      { key: "domain", label: "Domain", placeholder: "yourcompany (as in yourcompany.freshdesk.com)" },
      { key: "apiKey", label: "API Key" },
      {
        key: "webhookSecret",
        label: "Webhook Shared Secret",
        placeholder: "Must match the X-Webhook-Secret header your Automation Rule sends",
      },
    ],
    supportsTest: true,
  },
  exotel: {
    label: "Exotel",
    description:
      "Cloud telephony — initiate calls from Supportify and log call outcomes to the timeline. Inbound calls from an unrecognized number create a new client profile automatically.",
    fields: [
      { key: "sid", label: "Account SID" },
      { key: "apiKey", label: "API Key" },
      { key: "apiToken", label: "API Token" },
      { key: "callerId", label: "Exophone (Caller ID)" },
      {
        key: "webhookSecret",
        label: "Webhook Shared Secret",
        placeholder: "Must match the ?secret= query param on your configured callback URL",
      },
    ],
    supportsTest: true,
  },
  clevertap: {
    label: "Clevertap",
    description: "Customer engagement platform — ingests app and campaign events. Sending customer signals to CleverTap is allowed only when Region is in1 (India). Blank means CleverTap's default (Europe) region: read-only features still work, writes stay blocked.",
    fields: [
      { key: "accountId", label: "Account ID" },
      { key: "passcode", label: "Passcode" },
      { key: "region", label: "Region (optional)", placeholder: "in1 (India). Required for writes" },
      { key: "webhookSecret", label: "Webhook Shared Secret", placeholder: "Must match the X-Webhook-Secret header set on the CleverTap webhook" },
    ],
    supportsTest: true,
  },
  clickup: {
    label: "ClickUp",
    description: "Task management — create ClickUp tasks from Supportify and pull status changes back in.",
    fields: [
      { key: "apiToken", label: "API Token" },
      { key: "teamId", label: "Team ID" },
      { key: "listId", label: "List ID (where tasks are created)" },
      { key: "webhookSecret", label: "Webhook Secret", placeholder: "The secret ClickUp returns when the webhook is created" },
    ],
    supportsTest: true,
  },
  jira: {
    label: "Jira",
    description:
      "Issue tracking — inbound only: reflects Jira ticket status changes against the linked client/task. Tickets are created directly in Jira with a client:<ClientCode> label to link them.",
    fields: [
      { key: "baseUrl", label: "Base URL", placeholder: "https://yourcompany.atlassian.net" },
      { key: "email", label: "Account Email" },
      { key: "apiToken", label: "API Token" },
      { key: "projectKey", label: "Project Key", placeholder: "SUPP" },
      { key: "webhookSecret", label: "Webhook Secret", placeholder: "The secret set on the Jira webhook (Settings → System → WebHooks)" },
    ],
    supportsTest: true,
  },
  meta_ads: {
    label: "Meta Ads (reporting)",
    description:
      "Read-only: pulls campaign spend and results from the Meta Marketing API so the Marketing page can show cost per lead, per KYC and per funded customer. Nothing is created, edited or published, and nothing is sent back to Meta. Use a system-user token with the ads_read permission. The daily sync also needs the META_ADS_SYNC_ENABLED=1 switch on the server.",
    fields: [
      { key: "accountId", label: "Ad account ID", placeholder: "Digits only, e.g. 1234567890 (an act_ prefix is fine)", plain: true },
      { key: "accessToken", label: "Access token", placeholder: "System-user token with ads_read" },
      { key: "apiVersion", label: "Graph API version (optional)", placeholder: "Leave blank for the default (v23.0)", plain: true },
    ],
    supportsTest: true,
  },
  google_ads: {
    label: "Google Ads (reporting)",
    description:
      "Read-only: pulls campaign and ad spend and results from the Google Ads API so the Marketing workspace can show cost per lead and revenue by campaign next to Meta. Nothing is created, edited, paused or published, and nothing is sent back to Google. You need a Google Ads developer token and an OAuth client with a refresh token for a user who has read access to the account; entering them here is the only place they are kept (encrypted). The daily sync also needs the GOOGLE_ADS_REPORTING_ENABLED=1 switch on the server.",
    fields: [
      { key: "customerId", label: "Customer ID", placeholder: "10 digits, dashes are fine, e.g. 123-456-7890", plain: true },
      { key: "loginCustomerId", label: "Manager account ID (optional)", placeholder: "Only if you reach this account through a manager (MCC) account", plain: true },
      { key: "developerToken", label: "Developer token" },
      { key: "clientId", label: "OAuth client ID", plain: true },
      { key: "clientSecret", label: "OAuth client secret" },
      { key: "refreshToken", label: "Refresh token" },
      { key: "apiVersion", label: "API version (optional)", placeholder: "Leave blank for the default (v22)", plain: true },
    ],
    supportsTest: true,
  },
  referral_api: {
    label: "Referral API (Partner workspace)",
    description:
      "Optional. The Partner workspace reads this CRM's own earnings records by default and needs no connection; this card is used only when the server is started with PARTNER_SOURCE=external. Read-only connection to the referral programme's admin API. Feeds the Partner workspace (affiliates, referred users, payouts). Nothing is written back. Mock mode shows sample data with no network. Use a view-only credential. Contract unverified: field names are proposed, not confirmed against a running service; run the contract check before relying on numbers.",
    fields: [
      { key: "baseUrl", label: "Base URL", placeholder: "https://… (https required)" },
      { key: "token", label: "Service token (view-only)" },
      { key: "pathPrefix", label: "Path prefix (optional)", placeholder: "Leave empty unless the endpoints sit below a prefix" },
    ],
    supportsTest: true,
  },
  lead_intake: {
    label: "Lead Sources (Ads & Website)",
    description:
      "Receives leads from Meta (Facebook + Instagram) Lead Ads, Google Ads lead forms, and your website, blog and contact forms. Switch to Live to accept real leads; set Mock/disable to stop all of them at once.",
    fields: [
      { key: "webSecret", label: "Website secret (server-to-server)", placeholder: "Sent as the x-lead-secret header by your backend / Zapier / form service" },
      { key: "webFormKey", label: "Website form key (browser forms)", placeholder: "A public identifier you embed in the form; only works from the allowed origins" },
      { key: "allowedOrigins", label: "Allowed website origins", placeholder: "https://www.yourdomain.com, https://blog.yourdomain.com" },
      { key: "googleKey", label: "Google Ads webhook key", placeholder: "The key you enter in the Google Ads lead-form webhook settings" },
      { key: "metaAppSecret", label: "Meta app secret", placeholder: "Verifies X-Hub-Signature-256 on the Lead Ads webhook" },
      { key: "metaVerifyToken", label: "Meta verify token", placeholder: "Any string you choose; paste the same one in the Meta webhook setup" },
      { key: "metaPageToken", label: "Meta page access token", placeholder: "Long-lived page token with leads_retrieval permission" },
    ],
    supportsTest: false,
  },
  whatsapp_meta: {
    label: "WhatsApp (Meta Cloud API)",
    description: "Send WhatsApp template messages and receive replies, manually or from journeys.",
    fields: [
      { key: "phoneNumberId", label: "Phone Number ID" },
      { key: "accessToken", label: "Access Token" },
      { key: "appSecret", label: "App Secret", placeholder: "Meta app secret — verifies X-Hub-Signature-256 on inbound webhooks" },
    ],
    supportsTest: false,
  },
  sms_exotel: {
    label: "SMS (Exotel)",
    description: "Send SMS messages to leads, manually or from journeys.",
    fields: [
      { key: "sid", label: "Account SID" },
      { key: "apiKey", label: "API Key" },
      { key: "apiToken", label: "API Token" },
      { key: "senderId", label: "Sender ID" },
      { key: "webhookSecret", label: "Webhook Shared Secret", placeholder: "Must match the ?secret= query param on your SMS callback URL" },
    ],
    supportsTest: false,
  },
  resend_email: {
    label: "Resend (Email)",
    description: "Transactional email — notifies Admins and the assigned RM when a client's stage SLA is breached.",
    fields: [
      { key: "apiKey", label: "API Key" },
      { key: "fromAddress", label: "From Address", placeholder: "alerts@yourdomain.com" },
      { key: "fromName", label: "From Name (optional)", placeholder: "Supportify Alerts" },
    ],
    supportsTest: false,
  },
};
