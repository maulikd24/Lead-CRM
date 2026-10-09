import { requireUser } from "@/lib/auth/require-role";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Release = {
  date: string;
  bullets: string[];
};

const RELEASES: Release[] = [
  {
    date: "9 October 2026",
    bullets: [
      "New Support tab on every client: all of their Freshdesk tickets with status, channel and dates, and a link to open each in Freshdesk. When a client's phone number or email matches a Freshdesk contact, their whole ticket history is brought in automatically — including tickets raised before they became a client. Use Sync from Freshdesk to pull it immediately.",
      "Ticket statuses now stay current: when a ticket moves to Pending, Resolved or Closed in Freshdesk, the client's existing timeline entry updates instead of a new one being added.",
      "One matching rule for every lead source: phone numbers match whatever their format (+91, 0, spaces, dashes), joint holders' numbers and emails are recognised, and when a contact matches on one detail the other is added to the profile — so a person who first called and later emailed stays one client.",
      "If a contact's phone matches one client but their email matches another, it goes to the phone match and a \"Possible duplicate\" review task is created so the two profiles can be merged. Someone marked Not proceeding who gets in touch again is added to their existing profile and their RM is alerted, instead of a duplicate lead being created.",
      "Merging clients now carries over support tickets, KYC steps and any missing phone or email from the merged profile.",
    ],
  },
  {
    date: "8 October 2026",
    bullets: [
      "The audit history is now tamper-proof: once an entry is recorded it can't be edited or deleted by anyone, and every entry is cryptographically linked to the one before it. A daily integrity check alerts Admins if the history has ever been altered (Settings → System shows when it last ran).",
      "The audit history is also backed up daily to write-once storage outside Supportify and checked against it, so even a change made directly in the database is detected.",
      "When a client is permanently deleted on request, the audit entry recording it now keeps only masked identifiers, so the client's personal details are truly gone.",
      "Security fix: user password hashes are no longer included in the data sent to the browser on client, task and user pages.",
      "As a precaution after that fix, Admins, Managers and Team Managers are signed out and asked to choose a new password (different from the old one) at their next sign-in. Changing your password now also signs out your other sessions, and new users and Admin-reset passwords must be replaced at first sign-in. Admins can see who hasn't changed theirs yet on Settings → Users.",
    ],
  },
  {
    date: "6 October 2026",
    bullets: [
      "New Customer Intelligence on every client's Overview: their lifecycle stage (Lead to Active or Dormant), a Next Best Action with the topic, reason, priority, owner and timing, two or three talking points, and a \"don't raise right now\" list — for example no sales pitch while a complaint is open, and no repeating a PMS pitch the customer just declined. Sometimes the answer is No Action.",
      "Asset class acceptance (High / Medium / Low for mutual funds, PMS, AIF, bonds, broking, global investing and tax planning) is kept up to date from the customer's profile, holdings and conversations. RMs can set a level themselves.",
      "Supportify now reads what customers say — in call transcripts, WhatsApp chats, RM notes and support tickets — and records their interests, objections, concerns, complaints and promises the RM made. Promises become tasks, complaints alert the RM and manager, and possible compliance problems alert Admins and managers. (Needs the Anthropic key.)",
      "New Log outcome button after any interaction (Interested, Not interested, Follow up, Converted, Not relevant, Service issue) that immediately updates acceptance, the next action and priority lists.",
      "Co-pilot has a new Priority customers list across the whole customer base, and the Clients list can be filtered by lifecycle, category and segment. Journeys have a new trigger, Customer Enters a Segment (for example Dormant or KYC drop-off), so journeys can run for existing customers and not only new leads.",
      "New Customer Intelligence page for Admins and Managers: the funnel through to activated customers, conversion by source, follow-ups per RM, opportunities, lost opportunities and quality flags, plus Ask the system — plain-English questions such as \"Which KYC customers have not funded?\" answered from live data.",
      "Direct signups (App Signup, Organic Signup) are now recognised sources, and customers can be given a category (Broking, Wealth, Mutual Funds, HNI, Existing Customer, Support, Other).",
      "Reassigning clients is now permission-checked: Admins can move any client, Managers clients in their team or unassigned, and an RM only a client that is currently theirs; other roles can't reassign. Previously any signed-in user could reassign any client.",
      "Groundwork for AI agents: a protected briefing and outcome service lets a future WhatsApp or calling bot read the same understanding an RM sees and report back, including handing a customer to an RM with a summary. No bot is included yet.",
      "Leads from your ads and website now arrive on their own: Meta (Facebook) lead ads, Instagram lead ads, Google Ads lead forms, and your website, blog and contact forms. Each becomes a client with the right Lead Source (new: Instagram Ads and Contact Form), High priority, a \"call within 15 minutes\" task, and an instant alert to the assigned RM. Turn them on under Settings → Apps & Integrations → Lead Sources.",
      "Campaign details (campaign, ad set, ad, UTM tags) and the consent a person gave on the form are saved on the client and shown in Client Details. Someone who is already a client and enquires again is not duplicated — their RM is told and the touch is logged.",
      "New Go-Live Checklist (Settings, Admin): 88 checks across platform, lead sources, Freshdesk, Exotel, Clevertap, messaging, users, security and launch testing. Many are checked live from the system; the rest are ticked by your team, with owners and notes, and can be downloaded as a CSV.",
      "The background scheduler is now monitored: a public /api/health address reports when it stops, and the 9 PM management report emails now catch up if the scheduler runs late instead of being skipped for the day.",
      "Fixed Clevertap campaign events for unknown contacts creating junk leads, phone numbers in any format now match existing clients, and demo-data setup was removed so it can't recreate test accounts in production.",
    ],
  },
  {
    date: "4 October 2026",
    bullets: [
      "New KYC pipeline: once a client is submitted for KYC, the Onboarding tab tracks each verification step — PAN, address (DigiLocker / Aadhaar), bank penny-drop, risk profile, IPV / VIPV, e-Sign, KRA and CKYC — with joint holders getting their own identity steps. Steps unlock in order, and each shows how long it has been waiting and what it's waiting on.",
      "RMs start steps and run automated checks; Admins and Managers verify, fail, skip or reopen them, always with a reason. KYC can only be approved once every step is verified or skipped. Clients submitted before today keep the existing approval flow.",
      "Stuck KYC steps are chased automatically: the RM gets a follow-up task and alert once a step passes its time limit, and their manager is alerted at twice the limit.",
      "AI summaries now cover RM performance too: Summarize an individual RM from their performance page, or the whole team from Reports and the Manager Dashboard.",
      "Inbound webhooks are now locked down: Freshdesk and Exotel events must carry the shared secret you configure in Apps & Integrations, repeated deliveries of the same event are recognised and ignored, and floods are rate-limited. In production only integrations switched to Live are accepted. A contact with no match — by email, WhatsApp or a call — now becomes a new lead assigned according to your Lead Assignment setting, instead of being dropped.",
    ],
  },
  {
    date: "2 October 2026",
    bullets: [
      "KYC approval is now clear and controlled: Admins and Managers get a \"KYC approved\" checkbox on the client's Onboarding tab (and a prominent card on the Overview) once the client is submitted for KYC. RMs see the status but can't approve, and approvers are notified when a KYC is waiting.",
      "The client Overview now opens with an at-a-glance row: AUM (with allocation), Funds Added (Yes/No and the amount), and the Last Trade. Trading activity and Payments history tables sit under the Wealth and Funds & Dealer tabs, fed by the back-office imports (Households → Import Transactions / Import Payments).",
      "New AI summaries: press Summarize on a client profile, your Dashboard, the Manager Dashboard, Reports or a Quality Audit review for a short plain-language briefing. Personal contact details (phone, email, PAN) are never sent to the AI.",
      "Phone notifications: with the Supportify Android app installed, every alert you get in the bell now also reaches your phone — including a new early warning when a client is about to breach its stage SLA. Choose which kinds you want, and send yourself a test, under Settings → Phone notifications.",
      "New Lead Assignment setting (Admin): choose how new leads are assigned — Load-based (fewest active clients, as before), Round robin, or Manual. In Manual mode new leads wait unassigned and Admins and Managers are alerted; Managers can now find and open unassigned leads from Clients → Assigned RM → Unassigned.",
      "SLA, funding and no-contact alerts are now sent once per stage visit instead of repeating after you read them.",
      "New Activity Log: every sign-in (and failed sign-in), sign-out, page opened, file downloaded, and change made by each user is now recorded with the time, IP address, and device. Admins see everyone; Managers see their own team. Filter by user, event, or date, and download the log as a CSV.",
      "Each user's page under Settings → Users now shows their recent sign-in history and activity.",
      "New Supportify Android app (Help → Install on your phone). It can sync your phone's call log: calls with your assigned clients' numbers are added to each client's Activity with the time, direction and duration, on app open and about every 15 minutes. Calls with numbers that aren't your clients' are never stored. Turn it off any time in Settings → Phone call sync; Admins can revoke a device from the user's page.",
      "New Quality Audit (Insights → Quality Audit): calls and WhatsApp conversations are reviewed by AI for sentiment and a quality score out of 100, with a recommended follow-up that becomes a task for the RM. Low scores alert the RM (and their manager for high-priority clients); Admins and Managers can add notes or override a score.",
      "The Manager Dashboard gained a Daily view and a custom date range, a clickable Pipeline View with conversion and average time in each stage, and per-RM stage timing and Referral Source on each RM's performance page.",
      "Opportunities can now record an Estimated AUM, shown per opportunity and as a client total.",
      "The sidebar is now organised into expandable categories — Work, Insights, Automation, Finance, Admin & Settings, and Help & Reference — and remembers which ones you've opened. \"Administration\" is now \"Admin & Settings\".",
      "Supportify can now be installed from your phone's browser as an app icon (and on iPhone via Add to Home Screen).",
    ],
  },
  {
    date: "1 October 2026",
    bullets: [
      "Redesigned Manager Dashboard: choose a Weekly, Monthly or Quarterly period with Previous/Next, and the six headline numbers, pipeline view and lead-activity chart all follow it. Team and RM performance are now one table, and both the dashboard and its lead-activity chart can be downloaded as PDFs.",
      "Fixed error messages from actions like Mark Onboarding Completed showing as a cryptic \"Minified React error\" in production — you now see the real reason (for example, \"KYC must be approved\").",
    ],
  },
  {
    date: "30 September 2026",
    bullets: [
      "Report an issue now lets you attach a screenshot, PDF or text file (up to 8 MB).",
      "If the page fails to refresh right after you mark onboarding completed, Supportify now recovers cleanly and shows the real status instead of a confusing error.",
    ],
  },
  {
    date: "29 September 2026",
    bullets: [
      "The WhatsApp connect screen now tells you what is actually happening — not connected yet, connecting, or QR expired — and has a Check now button, instead of one generic \"waiting\" message.",
      "Saving funding no longer adds a duplicate timeline entry each time you re-save the same status, and a save that doesn't move the client on (status still Pending) now says so clearly.",
      "Admins can remove a manual note that was added by mistake. System entries such as stage changes and calls can't be removed.",
    ],
  },
  {
    date: "28 September 2026",
    bullets: [
      "New WhatsApp Inbox: every conversation on the firm's RM WhatsApp numbers in one place, each linked to its client. RMs see only their own clients' chats, Admins and Managers see everything (Managers view-only), replies go out from the number the chat is on, and a message from an unknown number creates a new lead. Admins connect each RM's number under Settings → WhatsApp Accounts. It needs the separate WhatsApp worker running.",
      "System Overview gained a read-only Database card that shows which database the app and its migrations are using, so a mismatch is easy to spot.",
    ],
  },
  {
    date: "25 September 2026",
    bullets: [
      "A fresh look across the whole app — a calmer green palette, flatter cards, a new typeface and a dark-green sidebar — and a redesigned Dashboard: an overdue-tasks hero card, pipeline value with a trend chart, next best actions, overdue follow-ups with a one-click Snooze, RM performance, and today's schedule.",
      "The Actions and Assigned RM controls on a client page are now compact chips, and the SLA card shows \"Not applicable\" in neutral grey when it doesn't apply.",
    ],
  },
  {
    date: "24 September 2026",
    bullets: [
      "New Investment Category (Wealth, Broking, or Wealth & Broking) on every client — set it when creating a client, edit it later, see it as a badge next to the client's name, and filter the Clients list by it. Existing clients were set to Wealth.",
      "The Wealth tab can now track PMS (Allvest), PMS (Walfort), AIF II and AIF III for each client, with a status, amount and invested date for each.",
      "Changing a document's status now confirms with a message each time.",
      "The Dashboard and several pages load faster.",
    ],
  },
  {
    date: "21 September 2026",
    bullets: [
      "Added a real, final \"Onboarding Completed\" stage. Onboarding no longer completes silently in the background — once KYC is approved, funding is recorded, and a dealer is on file, the RM sees a \"Mark Onboarding Completed\" button on the Funds & Dealer tab to explicitly finish the pipeline.",
      "Fixed a bug where a Dealer updating their own handoff status from the Dealer Desk didn't move the client onto \"Introduction with Dealer\" if the RM hadn't already — recording progress from either side now correctly advances the stage.",
      "The Dashboard's \"My Day\" now surfaces clients whose dealer introduction is done and are ready for the RM to mark onboarding completed.",
      "SLA tracking is now optional for Referral-sourced clients: they show \"Not applicable\", never trigger SLA alerts, and no longer count against SLA compliance figures.",
      "New System Overview page under Settings (Admin): a live, read-only view of your integrations, scheduled jobs, API routes and key settings.",
      "Fixed the stage tracker never showing a tick on the final stage once a client had completed onboarding.",
    ],
  },
  {
    date: "20 September 2026",
    bullets: [
      "New RM Daily Report: a personal daily summary for every RM — client activity, progress, funds, blockers, and tomorrow's priorities — viewable on their performance page, downloadable as a PDF, and emailed to them automatically each evening.",
      "New Opportunities tab on the client page: track interest in specific products (mutual funds, broking, PMS, and more) through a pipeline from identified to invested, with a running total pipeline value.",
      "New Wealth tab on the client page: portfolio holdings, asset allocation, a concentration-risk check, a Wealth Health Checkup workflow, and a Smart Allvest risk-profiling workflow.",
      "New Manager Dashboard: one page combining organization KPIs, lead activity trends, detailed team performance (including who's on hold), RM performance, and a clickable pipeline view — with its own PDF export. This replaces the earlier Executive Dashboard, which is now folded in here.",
      "RM performance pages now break results into Activity, Journey, and Business categories, with a placeholder for relationship-quality tracking once that's built.",
      "Added weekly (Monday) and monthly (1st of the month) management report emails alongside the existing daily one.",
      "Fixed the Reports page's PDF export cutting off several sections partway through — every section now downloads in full.",
    ],
  },
  {
    date: "19 September 2026",
    bullets: [
      "Reports charts are now clickable — click a bar in Leads Activity or the Stage Funnel to see the exact filtered list of clients behind that number, including which RM they're assigned to and when they were last updated.",
      "Fixed onboarding stages and several Reports sections showing up completely empty in production; they now show a clear message instead of blank space if this ever happens again.",
      "Joint account holders can no longer be added, edited, or removed once a client has an active trading account.",
      "Put On Hold is now restricted to Managers and Admins, so an RM can no longer pause their own SLA clock.",
      "Logging a note on a client now also marks that client's open tasks as done, the same way completing a task already logged a note.",
      "The Stage Funnel now includes a \"Lost\" bucket for clients marked Not Proceeding.",
      "Merging duplicate clients now also transfers their trading account and revenue history onto the surviving record.",
    ],
  },
  {
    date: "17 September 2026",
    bullets: [
      "Clients can now be permanently deleted (not just archived) — request it from the client page, a different Admin approves it, then an Admin executes it with a type-to-confirm step. Only allowed for clients with no trading, household, or revenue history on file; anything with real financial history still needs Archive instead.",
      "Two new bulk actions on the Clients list: Bulk Edit (Priority, Region, and other lead/profile fields across every selected client at once) and Add Note (one note to every selected client).",
    ],
  },
  {
    date: "15 September 2026",
    bullets: [
      "New Earnings Engine: sync revenue automatically from existing transactions or import it by CSV, compute partner commission accruals against configurable rules, and build Payout Runs that require a different Admin's approval before they take effect.",
      "A payout run moves through Draft, Pending Approval, Approved, and Finalized — every payout traces all the way back to the exact revenue and transaction it came from.",
      "Manual commission adjustments (clawbacks/corrections) always require approval before they change a payout.",
      "The Finance Console now shows a real reconciliation queue of approved payouts awaiting confirmation, plus the same approval queue available in Settings.",
      "The Management Console now shows each partner's lifetime commission accrued alongside the team roster.",
      "Field masking is now live: Partner Home's Referred Clients panel masks PAN for Partners and mobile/email too for Affiliates.",
      "A Manager's stage correction now requires Admin approval before it takes effect; an Admin's own correction still applies immediately.",
      "New Settings pages: Approval Workflows (the maker-checker queue), Data Privacy (masking rules, access log, retention/erasure requests), and Partner Directory.",
      "Partner PAN and GSTIN are now stored encrypted, with a masked-by-default \"Reveal\" control that logs who viewed them.",
      "Accounts are now locked for 15 minutes after 5 consecutive failed sign-in attempts, and every attempt is recorded.",
      "Added a Debugger: report an issue from anywhere in the app via the bug icon in the header; Admins get notified immediately and triage a queue at Debugger.",
      "Fixed a bug where the daily leads-report email could silently fail to send with no visible sign anything went wrong.",
    ],
  },
  {
    date: "14 September 2026",
    bullets: [
      "Five new roles alongside the existing ones — Team Manager, Partner, Affiliate, Distributor, and Finance — each with their own home page and sidebar, with no change to how Admin/Manager/RM/Dealer behave.",
      "Partner Home: a Partner/Affiliate/Distributor's own profile and the clients they've referred.",
      "Households: group existing clients into a family unit and see their combined portfolio.",
      "Trading Accounts, Holdings, and Transactions: a real brokerage/demat account per client, with holdings and transaction history importable by CSV.",
    ],
  },
  {
    date: "13 September 2026",
    bullets: [
      "New Leads Activity section on Reports: created/updated counts with Daily, Weekly, Monthly, Quarterly, Yearly, and custom date-range filters, plus a CSV export.",
      "A daily email digest of leads created/updated, sent at 9 PM IST to an operator-configured recipient.",
      "RM Performance table rows now link to a full per-RM performance page with its own KPIs, assigned clients, and Leads Activity trend.",
      "Joint account holding: add a Second and Third holder to a client, each with their own KYC documents, plus an Operating Instruction (Jointly / Either or Survivor / Anyone or Survivor).",
      "Clients can now be edited after creation — any field, by any user — and Admins can archive (and restore) a client.",
      "A duplicate mobile number now hard-blocks client creation, the same as PAN and CKYC.",
      "Merge Duplicate is now available to RMs (previously Manager/Admin only), and the Clients list supports selecting several clients to merge at once.",
      "New hold reason: \"Referrer will be connecting with this client.\"",
      "KYC documents can be verified all at once with a new \"Verify All\" action.",
      "Task due dates can be rescheduled directly from the task.",
      "Three new bulk actions on the Clients list: Put On Hold, Mark Not Proceeding, and Export Selected.",
      "Referral Source is now a fixed dropdown of named RM codes (with an \"Other\" free-text fallback), instead of free text.",
      "\"Distributor\" added as a Client Type.",
    ],
  },
  {
    date: "10 September 2026",
    bullets: [
      "PAN is no longer required to create a client — it's still validated and duplicate-checked if you do enter one.",
      "Audit History now renders as a readable, icon-led timeline instead of raw JSON.",
    ],
  },
  {
    date: "6 September 2026",
    bullets: [
      "The Support Handbook moved fully in-app (previously an external document), linked from the Help page.",
      "Fixed the sidebar overlapping wide tables on some pages.",
    ],
  },
  {
    date: "5 September 2026",
    bullets: [
      "A full visual redesign: new design system, dark mode, and a ⌘K / Ctrl+K command palette for fast navigation and search.",
    ],
  },
  {
    date: "4 September 2026",
    bullets: [
      "The client page was restructured into the current six-tab \"Client 360\" layout, with a unified activity timeline.",
      "Added PAN/CKYC duplicate detection and a multi-factor engine that auto-assigns new leads to an RM by region, language, HNI eligibility, and workload capacity.",
      "Added manager analytics — a stage-aging heatmap — and new bulk client tools.",
      "Added lead propensity scoring and a real Dealer Handoff Desk.",
      "Hardened the funding stage gate and added funding-specific SLA automation.",
      "Updated the Help page with current features and FAQs.",
    ],
  },
  {
    date: "30 August 2026",
    bullets: ["Aligned colors, typography, and button shapes with Allvest's brand."],
  },
  {
    date: "29 August 2026",
    bullets: [
      "Added a one-time guided tour for new users, and the first version of the Help page.",
      "Added Next Action tracking, stage gates, and the Exceptions Queue.",
      "Added ClickUp and Jira integrations with two-way task sync.",
      "Reorganized Settings into Account/Profile vs. Apps & Integrations.",
    ],
  },
  {
    date: "27 August 2026",
    bullets: [
      "Simplified the New Client form, collapsed the pipeline to 5 stages, and added the Dealer role.",
      "Added client filter dropdowns and SLA breach alerts (browser and email).",
      "Journeys: node deletion, richer condition operators, and four new action types.",
    ],
  },
  {
    date: "25 August 2026",
    bullets: [
      "Initial launch: lead management, the onboarding pipeline, workflow Journeys, integrations, and messaging.",
      "Rebranded to Supportify with a terracotta and navy visual identity.",
      "Added a rules-based AI co-pilot for RMs and user management.",
    ],
  },
];

export default async function ReleaseNotesPage() {
  await requireUser();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Release Notes"
        description="What's changed in Supportify over time, newest first."
      />

      <div className="flex flex-col gap-4">
        {RELEASES.map((release) => (
          <Card key={release.date} className="max-w-2xl">
            <CardHeader>
              <CardTitle className="text-base">{release.date}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
                {release.bullets.map((bullet, i) => (
                  <li key={i}>{bullet}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
