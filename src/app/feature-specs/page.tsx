import type { Metadata } from "next";
import Link from "next/link";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import { ArrowLeft } from "lucide-react";

import { requireUser } from "@/lib/auth/require-role";
import { Logo } from "@/components/logo";
import "../docs.css";

const plexSans = IBM_Plex_Sans({
  variable: "--font-hb-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-hb-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Supportify Feature Specifications",
  description: "A formal, rule-by-rule specification of every module in Supportify.",
};

export default async function FeatureSpecsPage() {
  await requireUser();

  return (
    <div className={`handbook ${plexSans.variable} ${plexMono.variable}`}>
      <div className="layout">
        <nav className="sidebar" aria-label="Spec sections">
          <Link href="/help" className="back-link">
            <ArrowLeft size={14} /> Back to Supportify
          </Link>
          <div className="brand">
            <Logo className="brand-mark" />
            <span className="brand-name">Supportify</span>
          </div>
          <p className="brand-sub">Feature Specifications &middot; Allvest Securities</p>

          <div className="nav-group">
            <div className="nav-group-label">Start here</div>
            <a className="nav-link" href="#intro">Introduction</a>
          </div>
          <div className="nav-group">
            <div className="nav-group-label">Client lifecycle</div>
            <a className="nav-link" href="#client-creation">Client Creation &amp; Deduplication</a>
            <a className="nav-link" href="#pipeline-gates">Onboarding Pipeline &amp; Stage Gates</a>
            <a className="nav-link" href="#joint-holders">Joint Account Holding</a>
            <a className="nav-link" href="#editing-merge">Editing, Archiving &amp; Merge</a>
          </div>
          <div className="nav-group">
            <div className="nav-group-label">Routing &amp; intelligence</div>
            <a className="nav-link" href="#auto-assignment">Auto-Assignment Engine</a>
            <a className="nav-link" href="#copilot-scoring">Co-pilot Scoring</a>
          </div>
          <div className="nav-group">
            <div className="nav-group-label">Reporting</div>
            <a className="nav-link" href="#leads-activity">Leads Activity &amp; Daily Email</a>
            <a className="nav-link" href="#rm-performance">RM Performance &amp; Drill-down</a>
          </div>
          <div className="nav-group">
            <div className="nav-group-label">Automation &amp; access</div>
            <a className="nav-link" href="#journeys">Journeys</a>
            <a className="nav-link" href="#notifications">Notifications</a>
            <a className="nav-link" href="#roles-visibility">Roles &amp; Visibility</a>
          </div>
          <div className="nav-group">
            <div className="nav-group-label">Technical</div>
            <a className="nav-link" href="#apis-cron">APIs, Webhooks &amp; Cron Jobs</a>
          </div>
        </nav>

        <main>
          <header className="doc-header" id="intro">
            <span className="doc-eyebrow">Internal reference</span>
            <h1>Supportify Feature Specifications</h1>
            <p>
              A formal, rule-by-rule specification of how each module actually behaves — Purpose, Fields,
              Business Rules, and Edge Cases for every feature, plus a technical appendix of every API route,
              webhook, and cron job. Where the <Link href="/handbook">Handbook</Link> teaches you how to use
              Supportify, this document defines exactly what it does and enforces, pulled directly from the
              implementation rather than written freehand.
            </p>
            <div className="meta-row">
              <span className="meta-pill">Rule-by-rule, not narrative</span>
              <span className="meta-pill">Includes API &amp; cron detail</span>
              <span className="meta-pill">Kept in sync with the codebase</span>
            </div>
          </header>

          <section className="module" id="client-creation">
            <div className="module-eyebrow">Client lifecycle</div>
            <h2>Client Creation &amp; Deduplication</h2>

            <h3>Purpose</h3>
            <p>Capture a new lead correctly the first time, and prevent duplicate records for the same real person or entity.</p>

            <h3>Fields</h3>
            <p>
              Full Name* and Mobile* (required); PAN (optional, format-validated and normalized to
              trim+uppercase on write); Email; CKYC Reference; Region; Preferred Language; City; State; Lead
              Source; Client Type; Product Interest; Existing Broker; Trading Experience; Expected Investment;
              Referral Source (fixed list of named RM codes, or free-text via &quot;Other&quot;); Notes; Assigned
              RM (optional — leaving it blank triggers <a href="#auto-assignment">auto-assignment</a>).
            </p>

            <h3>Business Rules</h3>
            <ul>
              <li>PAN and CKYC Reference are both unique at the database level — an exact match on either hard-blocks creation outright, with no override.</li>
              <li>A duplicate mobile number is also a hard block, the same tier as PAN/CKYC (promoted from a soft warning as of 13 September 2026).</li>
              <li>A duplicate email is a soft warning only — the user can proceed via &quot;Create Anyway&quot;.</li>
              <li>Bulk Import applies the exact same rules per row, in file order, so an in-file duplicate is also caught; capped at 1,000 successful rows per file.</li>
            </ul>

            <h3>Edge Cases</h3>
            <ul>
              <li>A client created without PAN can still be blocked later — PAN becomes mandatory again at document verification before Submit for KYC will pass.</li>
              <li>An invalid or duplicate row inside a bulk import is skipped and reported as failed/duplicate; it never blocks the rest of the file.</li>
            </ul>
          </section>

          <section className="module" id="pipeline-gates">
            <div className="module-eyebrow">Client lifecycle</div>
            <h2>Onboarding Pipeline &amp; Stage Gates</h2>

            <h3>Purpose</h3>
            <p>Move a client through 5 fixed stages with an enforced SLA clock and mandatory-completeness gates at each transition.</p>

            <h3>Fields</h3>
            <p>
              5 fixed stages with SLA targets — New Lead (4h), Submitted for KYC (24h), KYC completed (72h),
              Pushed for funds (120h), Introduction with Dealer (48h) — plus <code>stageEnteredAt</code>,
              <code>currentStageId</code>, and per-stage Exceptions (holds) with <code>reason</code>,
              <code>createdAt</code>, <code>resolvedAt</code>.
            </p>

            <h3>Business Rules</h3>
            <ul>
              <li>A client is Overdue once it has spent 100% of the stage&apos;s SLA target hours in that stage; Due Soon at 75%; On Track under that.</li>
              <li>Time inside an open exception (hold) is excluded from stage-age math — resuming picks the clock back up from where it left off.</li>
              <li>Submit for KYC requires every mandatory document Verified (or Not Applicable), unless a Manager/Admin explicitly checks an override.</li>
              <li>Only a KYC outcome of Approved advances the stage; Rejected or Additional Info Required keeps the client on the same stage and notifies the RM.</li>
              <li>Marking funding Partially/Fully Funded requires both an amount &ge; &#8377;5,000 and the penny-drop verification checkbox.</li>
              <li>Manager/Admin can force-correct a client to any stage directly; this always requires a logged reason and appears in Exceptions for 7 days.</li>
            </ul>

            <h3>Edge Cases</h3>
            <p>
              There is no distinct &quot;Completed&quot; stage — once KYC is Approved, funding qualifies, and the
              dealer introduction is Completed, <code>Client.status</code> flips to COMPLETED automatically
              while the client visually stays at stage 5.
            </p>
          </section>

          <section className="module" id="joint-holders">
            <div className="module-eyebrow">Client lifecycle</div>
            <h2>Joint Account Holding</h2>

            <h3>Purpose</h3>
            <p>Represent multi-holder accounts (a Second and/or Third holder) without duplicating the whole Client record, while still tracking KYC per holder.</p>

            <h3>Fields</h3>
            <p>
              <code>AccountHolder</code> rows (<code>position</code>: SECOND | THIRD, name, PAN, CKYC reference,
              documents, <code>isDeleted</code>); <code>Client.operatingInstruction</code>: JOINTLY |
              EITHER_OR_SURVIVOR | ANYONE_OR_SURVIVOR; <code>Document.holderId</code> (nullable — null means the
              First Holder, whose identity is the Client row itself).
            </p>

            <h3>Business Rules</h3>
            <ul>
              <li>EITHER_OR_SURVIVOR is valid only with exactly 2 total holders; ANYONE_OR_SURVIVOR is valid with 2 or 3 total holders.</li>
              <li>Submit-for-KYC completeness checks span every holder&apos;s documents, not just the First Holder&apos;s.</li>
              <li>A client that&apos;s mid-merge blocks concurrent holder changes (merge-collision blocking).</li>
            </ul>

            <h3>Edge Cases</h3>
            <p>Removing a holder soft-deletes the <code>AccountHolder</code> row (<code>isDeleted</code>) rather than physically deleting it, preserving its historical documents and audit trail.</p>
          </section>

          <section className="module" id="editing-merge">
            <div className="module-eyebrow">Client lifecycle</div>
            <h2>Client Editing, Archiving &amp; Merge</h2>

            <h3>Purpose</h3>
            <p>Correct or update any client field after creation, retire mistaken records, and combine two records that turned out to be the same person.</p>

            <h3>Fields</h3>
            <p>Every <code>Client</code> field is editable via Edit Client; archive uses <code>isDeleted</code>/<code>deletedAt</code>; Merge Duplicate combines a &quot;loser&quot; record into a &quot;winner&quot;.</p>

            <h3>Business Rules</h3>
            <ul>
              <li>Any authenticated user can edit any field on any client they can see — there is no field-level restriction.</li>
              <li>Only Admin can archive or restore a client; archived clients are hidden from the active list and CSV export but never physically deleted.</li>
              <li>Merge Duplicate is available to RM, Manager, and Admin (RM access added 13 September 2026); the Clients list supports selecting several clients and merging them in one action.</li>
              <li>On merge, documents, tasks, activity, stage history, and exceptions all move onto the surviving record.</li>
            </ul>

            <h3>Edge Cases</h3>
            <ul>
              <li>If both merging records already have their own KYC/Funding/Dealer record, that specific conflict is flagged for manual review rather than silently overwritten.</li>
              <li>Editing a client bumps <code>Client.updatedAt</code>, which is exactly what <a href="#leads-activity">Leads Activity reporting</a> counts as an &quot;update&quot; — a bulk edit shows up in that day&apos;s Updated count.</li>
            </ul>
          </section>

          <section className="module" id="auto-assignment">
            <div className="module-eyebrow">Routing &amp; intelligence</div>
            <h2>Auto-Assignment Engine</h2>

            <h3>Purpose</h3>
            <p>Route a new, unassigned lead to the right RM automatically instead of leaving every lead for a manager to hand out.</p>

            <h3>Fields</h3>
            <p>
              RM <code>availability</code> (Available / On Leave / Unavailable), <code>regions[]</code>,
              <code>languages[]</code>, <code>hniCapable</code>, <code>capacity</code>; Client
              <code>region</code>/<code>preferredLanguage</code>/<code>clientType</code>/<code>expectedInvestment</code>.
            </p>

            <h3>Business Rules</h3>
            <p>Filters are applied in order — the first one an RM fails excludes them:</p>
            <ol>
              <li>HNI eligibility — a client type of HNI/U-HNI, or expected investment &ge; &#8377;1 crore, requires an HNI-capable RM.</li>
              <li>Region &amp; language match — the RM&apos;s tagged regions/languages must include the client&apos;s (an RM with nothing tagged has no constraint).</li>
              <li>Capacity — the RM&apos;s current active client count must be under their configured capacity (default 50).</li>
              <li>Load balancing — among everyone left, the RM with the fewest active clients wins.</li>
            </ol>

            <h3>Edge Cases</h3>
            <p>
              If no RM clears every filter, the client is created unassigned and every Manager/Admin is
              notified. Marking an RM On Leave/Unavailable re-runs this same routing for their existing active
              clients, or leaves them unassigned with a notification if nobody else qualifies.
            </p>
          </section>

          <section className="module" id="copilot-scoring">
            <div className="module-eyebrow">Routing &amp; intelligence</div>
            <h2>Co-pilot Scoring</h2>

            <h3>Purpose</h3>
            <p>Give three distinct, non-interchangeable answers from the same client data: how urgent, what to work on next, and how likely to convert.</p>

            <h3>Fields</h3>
            <p><code>slaStatus</code>, <code>stageAgeHours</code>, <code>daysSinceLastActivity</code>, <code>overdueTaskCount</code>, manual <code>Priority</code>, <code>leadSource</code>, engagement activity count, profile completeness, <code>expectedInvestment</code>.</p>

            <h3>Business Rules</h3>
            <ul>
              <li>Health escalates to Critical if the SLA is already breached, OR there&apos;s been no activity in 7+ days, OR time-in-stage is more than double the stage&apos;s typical average.</li>
              <li>Priority score is additive, 0-100: SLA overdue/due-soon + overdue task count + manual Priority + days since last contact — this is what sorts the Co-pilot worklist.</li>
              <li>Propensity score is display-only and never affects sort order or the recommended Next Best Action.</li>
            </ul>

            <h3>Edge Cases</h3>
            <p>A manually-set HIGH-priority client with a healthy SLA can still outrank a LOW-priority client that&apos;s merely due-soon, since Priority score blends several signals additively rather than using SLA status alone.</p>
          </section>

          <section className="module" id="leads-activity">
            <div className="module-eyebrow">Reporting</div>
            <h2>Leads Activity &amp; Daily Email Digest</h2>

            <h3>Purpose</h3>
            <p>Answer &quot;how many leads did we create or touch in period X&quot;, across arbitrary granularities, exportable and optionally emailed daily.</p>

            <h3>Fields</h3>
            <p><code>Client.createdAt</code>, <code>Client.updatedAt</code>; granularity: day/week/month/quarter/year/custom; <code>laFrom</code>/<code>laTo</code> (custom only); <code>DailyJobRun</code> (<code>jobName</code>, <code>ranForDate</code>).</p>

            <h3>Business Rules</h3>
            <ul>
              <li>&quot;Created&quot; = <code>createdAt</code> falls in the bucket&apos;s range. &quot;Updated&quot; = <code>updatedAt</code> falls in the range — the broadest possible definition, including a plain field edit.</li>
              <li>Bucketing caps at 500 buckets, to guard against e.g. Daily granularity over a multi-year custom range.</li>
              <li>The daily digest sends once at 9 PM IST to a single, operator-configured recipient (<code>DAILY_REPORT_RECIPIENT_EMAIL</code>).</li>
              <li>A <code>DailyJobRun</code> row per IST calendar day makes a repeat send within the same day a no-op (the unique constraint itself is the concurrency-safe mutex); an unset recipient makes the whole job silently skip.</li>
            </ul>

            <h3>Edge Cases</h3>
            <p>
              Sub-record updates (a KYC document verified, a funding record changed) do NOT bump
              <code>Client.updatedAt</code>, since those live in separate tables — a day full of document
              verification with no client-field or stage change will show 0 &quot;Updated&quot; even though real
              work happened. RM-scoped views (the RM drill-down page) filter this same aggregation by
              <code>assignedToId</code>. Full API/cron detail: see <a href="#apis-cron">APIs, Webhooks &amp; Cron Jobs</a>.
            </p>
          </section>

          <section className="module" id="rm-performance">
            <div className="module-eyebrow">Reporting</div>
            <h2>RM Performance &amp; Drill-down</h2>

            <h3>Purpose</h3>
            <p>Give managers both a team-wide performance table and a full, single-RM view, without the two ever disagreeing on the numbers.</p>

            <h3>Fields</h3>
            <p>Active count, completed count, overdue task count, RM&apos;s own SLA %, average onboarding days, capacity.</p>

            <h3>Business Rules</h3>
            <ul>
              <li><code>computeRmPerformance()</code> is one shared pure function, fed either every RM (team table) or one RM (drill-down page) — the formula can never diverge between the two views.</li>
              <li>The drill-down page is scoped by the same visibility check as everywhere else (see <a href="#roles-visibility">Roles &amp; Visibility</a>) — a Manager cannot open another team&apos;s RM by guessing the URL; it returns a 404.</li>
            </ul>

            <h3>Edge Cases</h3>
            <p>An RM with zero completed clients shows &quot;&mdash;&quot; for average onboarding days rather than 0, to avoid implying a false instant-completion average.</p>
          </section>

          <section className="module" id="journeys">
            <div className="module-eyebrow">Automation &amp; access</div>
            <h2>Journeys (Automation Engine)</h2>

            <h3>Purpose</h3>
            <p>Let Managers/Admins build repeatable automations instead of manual follow-up.</p>

            <h3>Fields</h3>
            <p>
              Trigger (Client Created / Stage Changed / Field Updated / Webhook Received / Manual Enrollment);
              Action (message/email, create task, update status, reassign, notify manager, add note, call an
              integration); Condition (equals/contains/greater-less-than/exists/before-after-date); Wait (fixed
              duration or until-condition, with an optional timeout).
            </p>

            <h3>Business Rules</h3>
            <p>
              A journey cannot be restructured while any client is actively mid-flow (Running or Waiting)
              inside it — it must be deactivated first. Due journey steps are polled by the shared cron tick
              (every 5 minutes) rather than each journey scheduling its own timer — see
              <a href="#apis-cron"> APIs, Webhooks &amp; Cron Jobs</a>.
            </p>

            <h3>Edge Cases</h3>
            <p>A Wait node with no timeout and a condition that never becomes true holds a client in that journey indefinitely; the journey detail page&apos;s enrolled-client count is the only visibility into this.</p>
          </section>

          <section className="module" id="notifications">
            <div className="module-eyebrow">Automation &amp; access</div>
            <h2>Notifications</h2>

            <h3>Purpose</h3>
            <p>Surface every automatically-detected event that needs a human&apos;s attention in one bell-icon feed.</p>

            <h3>Fields</h3>
            <p>
              New assignment; task overdue (+escalation); stage SLA breach (+escalation); document rejected;
              KYC update; funding pending (+escalation); hold started / client reopened; dealer intro pending;
              excessive overdue workload; journey notify-manager; client disengaged; external task status
              changed.
            </p>

            <h3>Business Rules</h3>
            <p>Escalation variants additionally notify the assignee&apos;s manager, not just the assignee. &quot;Mark all read&quot; clears the badge count only — it does not resolve the underlying condition.</p>

            <h3>Edge Cases</h3>
            <p>The daily Leads Activity email digest is a separate, email-only automation — it does not create an in-app <code>Notification</code> row or appear in the bell feed.</p>
          </section>

          <section className="module" id="roles-visibility">
            <div className="module-eyebrow">Automation &amp; access</div>
            <h2>Roles &amp; Visibility</h2>

            <h3>Purpose</h3>
            <p>Define who sees which clients and which pages.</p>

            <h3>Fields</h3>
            <p><code>Role</code> enum (ADMIN, MANAGER, RM, DEALER); <code>User.managerId</code>/<code>manager</code>/<code>reports</code> (team hierarchy).</p>

            <h3>Business Rules</h3>
            <p>
              <code>getVisibleUserIds()</code> is the single function backing every scoped query in the app
              (Clients list, Reports, RM drill-down, command palette search): Admin sees everyone (returns
              <code>null</code>, meaning unrestricted); Manager sees themself plus every direct report,
              including a report who has since gone inactive (their historical clients stay visible); RM sees
              only clients assigned to them; Dealer sees only clients with a Dealer Handoff record assigned to
              them.
            </p>

            <h3>Edge Cases</h3>
            <p>Opening a page or record outside your role/visibility returns a 404 (RM drill-down, client detail) or a redirect to Clients/Dealer Desk (page-level route guard) — never a permission-denied error page.</p>
          </section>

          <section className="module" id="apis-cron">
            <div className="module-eyebrow">Technical</div>
            <h2>APIs, Webhooks &amp; Cron Jobs</h2>
            <p className="lede">Every HTTP route Supportify exposes outside its own UI, and the scheduled jobs that keep it running without anyone watching a clock.</p>

            <h3>Cron: <code>POST /api/internal/cron/tick</code></h3>
            <p>
              Triggered every 5 minutes by GitHub Actions (<code>.github/workflows/journey-cron.yml</code>, a
              plain <code>curl</code> POST), authenticated via an <code>x-cron-secret</code> header checked
              against <code>process.env.CRON_SECRET</code> — 401 if it doesn&apos;t match. Runs 6 jobs every
              tick, each isolated so one failure can&apos;t block the rest: <code>checkOverdueTasks</code>,
              <code>checkStageSla</code>, <code>checkFundingSla</code>, <code>processDueJourneySteps</code>,
              <code>checkDisengagement</code>, and <code>sendDailyReportEmail</code> (the Leads Activity
              digest). Jobs don&apos;t have their own cron expressions — every job runs every tick and
              self-determines whether it actually needs to do anything (e.g. the daily email checks the current
              IST hour and a <code>DailyJobRun</code> row before sending). Response is a JSON object with one
              key per job, each either the job&apos;s own result or <code>{"{ error }"}</code> if that job threw.
            </p>

            <h3>Reporting: <code>GET /api/reports/leads-summary</code></h3>
            <p>
              CSV export backing the Leads Activity section. Gated <code>requireRole([&quot;ADMIN&quot;,
              &quot;MANAGER&quot;])</code> — stricter than the Clients export below, matching the Reports page&apos;s own
              gate. Query params: <code>laGranularity</code> (day/week/month/quarter/year/custom),
              <code>laFrom</code>/<code>laTo</code> (custom only), and an optional <code>rmId</code> — intersected
              against the caller&apos;s <code>getVisibleUserIds()</code> set, so a crafted <code>rmId</code> can&apos;t
              pull another team&apos;s numbers. Returns one CSV row per bucket: period, periodStart, periodEnd,
              created, updated.
            </p>

            <h3>Export: <code>GET /api/clients/export</code></h3>
            <p>
              CSV export backing &quot;Export CSV&quot; and &quot;Export Selected&quot; on the Clients list. Gated
              <code>requireUser()</code> (any authenticated role) plus the same <code>getVisibleUserIds()</code>
              scoping as the list itself. An <code>ids</code> query param (comma-separated) exports exactly
              those clients (&quot;Export Selected&quot;) still intersected with the caller&apos;s visible-user set;
              otherwise every other query param is passed through <code>buildClientWhere()</code>, the same
              filter builder the Clients list page uses. Capped at 5,000 rows.
            </p>

            <h3>Integration webhooks: <code>POST /api/webhooks/[provider]</code></h3>
            <p>
              Inbound event receiver for Freshdesk, Exotel, Clevertap, ClickUp, and Jira. Resolves the
              provider&apos;s configured adapter (404 if unknown), parses JSON or form-encoded bodies, and hands
              the raw payload + headers to that adapter&apos;s own <code>handleWebhook()</code>. Each returned
              event either updates an externally-linked task (ClickUp/Jira status sync) or, if it carries a
              client phone/email, logs a CALL/TICKET/MESSAGE activity against the matching client and dispatches
              a Journey &quot;Webhook Received&quot; trigger.
            </p>

            <h3>Messaging webhooks: <code>GET</code>/<code>POST /api/webhooks/messaging/[channel]</code></h3>
            <p>
              <code>channel</code> is <code>whatsapp</code> or <code>sms</code>. <code>GET</code> exists only for
              WhatsApp and implements Meta&apos;s Cloud API verification handshake — it echoes back
              <code>hub.challenge</code> only if <code>hub.verify_token</code> matches
              <code>process.env.META_WEBHOOK_VERIFY_TOKEN</code>, else 403. <code>POST</code> handles both inbound
              messages (logged as a MESSAGE activity against the client matched by phone number) and delivery
              status updates, via the channel adapter&apos;s <code>handleInboundWebhook()</code>/
              <code>handleStatusWebhook()</code>.
            </p>

            <h3>Auth: <code>/api/auth/[...nextauth]</code></h3>
            <p>Standard NextAuth catch-all route handling sign-in and session management; not an app-specific API.</p>

            <h3>Edge Cases</h3>
            <ul>
              <li>Every integration (Freshdesk, Exotel, Clevertap, ClickUp, Jira, WhatsApp/SMS, Resend email) runs in Mock mode — behaving identically but against fake data — until an Admin adds live credentials in Settings &gt; Apps &amp; Integrations, which also lists the exact webhook URL to hand each provider.</li>
              <li>A webhook event that doesn&apos;t match any client by phone/email is silently dropped rather than erroring, since most providers retry on non-2xx.</li>
            </ul>
          </section>

          <footer className="doc-footer">
            Supportify Feature Specifications &middot; kept in sync with the codebase &middot; see the{" "}
            <Link href="/handbook">Handbook</Link> for how-to guidance and the{" "}
            <Link href="/release-notes">Release Notes</Link> for what changed and when.
          </footer>
        </main>
      </div>
    </div>
  );
}
