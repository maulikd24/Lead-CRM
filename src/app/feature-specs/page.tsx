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
            <a className="nav-link" href="#management-reports">Weekly &amp; Monthly Management Reports</a>
          </div>
          <div className="nav-group">
            <div className="nav-group-label">Wealth &amp; analytics</div>
            <a className="nav-link" href="#opportunity-management">Opportunity Management</a>
            <a className="nav-link" href="#wealth-workspace">Wealth Workspace</a>
            <a className="nav-link" href="#manager-dashboard">Manager Dashboard</a>
          </div>
          <div className="nav-group">
            <div className="nav-group-label">Automation &amp; access</div>
            <a className="nav-link" href="#journeys">Journeys</a>
            <a className="nav-link" href="#notifications">Notifications</a>
            <a className="nav-link" href="#debugger">Debugger</a>
            <a className="nav-link" href="#roles-visibility">Roles &amp; Visibility</a>
          </div>
          <div className="nav-group">
            <div className="nav-group-label">Distribution OS</div>
            <a className="nav-link" href="#identity-hierarchy">Identity, Hierarchy &amp; Policy Engine</a>
            <a className="nav-link" href="#masking-approvals">Field Masking &amp; Maker-Checker Approvals</a>
            <a className="nav-link" href="#client-product-360">Household, Trading Account &amp; Portfolio Data</a>
            <a className="nav-link" href="#earnings-engine">Immutable Earnings Engine</a>
            <a className="nav-link" href="#scoped-workspaces">Partner Home, Management &amp; Finance Consoles</a>
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
              <li><code>putOnHoldAction</code> is <code>requireRole([&quot;ADMIN&quot;, &quot;MANAGER&quot;])</code> as of 19 September 2026 (previously any authenticated user) — closing a real control gap where an RM could pause the SLA clock they themselves are measured against. <code>resumeFromHoldAction</code> is unchanged (any role), since resuming only makes SLA tracking stricter again, carrying none of the same conflict-of-interest risk.</li>
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
              <li>As of 19 September 2026, all three holder actions (<code>addHolderCore</code>, <code>updateHolderAction</code>, <code>removeHolderAction</code>) re-check for an <code>ACTIVE</code> <code>TradingAccount</code> on the client and refuse the change if one exists — once a brokerage account is live, joint-holder changes must go through Ops instead of self-service.</li>
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
              <li>On merge, documents, tasks, activity, stage history, and exceptions all move onto the surviving record. As of 19 September 2026, the surviving record also inherits the merged-away client&apos;s <code>TradingAccount</code> and <code>RevenueEvent</code> rows — previously left orphaned on the now-<code>NOT_PROCEEDING</code> duplicate.</li>
              <li>
                <strong>Permanent deletion</strong> (17 September 2026) finishes the existing{" "}
                <code>ErasureRequest</code>/<code>ApprovalRequest</code> maker-checker flow end-to-end: Admin or
                Finance can request one (reason required) from the client page; a <em>different</em> Admin
                approves it via Approval Workflows; only then can an Admin <strong>execute</strong> it
                (type-the-client&apos;s-name-to-confirm). Execution is refused — not silently partial — if the
                client has any <code>TradingAccount</code>, <code>HouseholdMember</code>,{" "}
                <code>RevenueEvent</code>, or <code>AdvisoryInteraction</code> row; that check is re-run{" "}
                <em>inside</em> the deletion transaction itself, not just before it, to close a race between
                approval and execution. A surviving <code>AuditLog</code> row (
                <code>action: &quot;permanently_deleted&quot;</code>) records the erased client&apos;s identity
                permanently, since the <code>Client</code> row itself is gone afterward — <strong>Archive</strong>{" "}
                remains the only option for a client with real financial/portfolio history.
              </li>
              <li>Two new bulk actions (17 September 2026): <strong>Bulk Edit</strong> (Admin/Manager;
                Priority/Region/City/State/Preferred Language/Client Type/Lead Source/Referral Source/Product
                Interest/Existing Broker/Trading Experience — a blank field in the dialog is left untouched on
                every selected client, never overwritten to empty) and <strong>Add Note</strong> (any role; one
                note logged to every selected client&apos;s timeline).</li>
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
              <li><code>RmPerformanceRow</code> gained an <code>onHold</code> count (20 September 2026), computed the same way as <code>active</code>/<code>completed</code> — but it&apos;s deliberately only rendered on <a href="#manager-dashboard">Manager Dashboard</a>&apos;s own Team Performance table, not the shared <code>RmPerformanceTable</code> component this section&apos;s table uses, since it wasn&apos;t asked for here.</li>
              <li>
                The drill-down page also computes a 4-pillar breakdown via <code>computeRmPillars()</code>{" "}
                (<code>src/lib/reports/rm-pillars.ts</code>), date-range scoped: <strong>Activity</strong>{" "}
                (clients contacted, meetings completed, follow-up completion rate); <strong>Journey</strong>{" "}
                (KYC/Wealth Health Checkup/Smart Allvest completion rates against that RM&apos;s Active/Completed
                clients); <strong>Business</strong> (funds received, investments executed, product penetration
                rate, and net AUM added — summed from <code>OpportunityStageHistory</code> rows that reached{" "}
                <code>INVESTED</code> within the period, owned by that RM); and an explicit{" "}
                <strong>Relationship Quality</strong> placeholder, since no Client Engagement
                Score/NPS/Service-Issue-Closure-Time data collection mechanism exists yet — the page never
                fabricates a number for it.
              </li>
            </ul>

            <h3>Edge Cases</h3>
            <p>An RM with zero completed clients shows &quot;&mdash;&quot; for average onboarding days rather than 0, to avoid implying a false instant-completion average. An RM with zero Active/Completed clients shows 0% for every Journey/penetration rate rather than dividing by zero.</p>
          </section>

          <section className="module" id="management-reports">
            <div className="module-eyebrow">Reporting</div>
            <h2>Weekly &amp; Monthly Management Reports</h2>

            <h3>Purpose</h3>
            <p>Extend the existing daily org-wide leads digest with coarser-grained rollups, without duplicating any of its aggregation or rendering logic a second or third time.</p>

            <h3>Fields</h3>
            <p>
              <code>assembleManagementReportData()</code>/<code>renderManagementReportText()</code>{" "}
              (<code>src/lib/reports/management-report.ts</code>) — one shared assembly/render pair used by all
              three emails (daily, weekly, monthly); <code>istWeekBoundaries()</code>/<code>istWeekKey()</code>/
              <code>istMonthBoundaries()</code>/<code>istMonthKey()</code> (<code>src/lib/utils/ist-date.ts</code>).
            </p>

            <h3>Business Rules</h3>
            <ul>
              <li>The daily org-wide email (still 9 PM IST) now includes Client Funnel Movement (stage counts), a High-Value Opportunities Matrix (top 10 open Opportunities by estimated value, org-wide), and the open Exceptions count — not just created/updated counts.</li>
              <li><strong>Weekly</strong> fires Mondays at 9 PM IST, summarizing the prior Monday&ndash;Sunday week. <strong>Monthly</strong> fires the 1st of the calendar month at 9 PM IST, summarizing the prior calendar month. Both reuse the exact <code>DailyJobRun</code>-mutex/never-throws/notify-Admins-on-failure pattern already hardened for the daily report (<a href="#leads-activity">Leads Activity &amp; Daily Email</a>), just keyed by <code>istWeekKey()</code>/<code>istMonthKey()</code> instead of a calendar day.</li>
              <li>All three emails share one recipient (<code>DAILY_REPORT_RECIPIENT_EMAIL</code>) — no separate weekly/monthly env var, since it&apos;s the same management audience at a coarser grain.</li>
            </ul>

            <h3>Edge Cases</h3>
            <p>A send failure on any of the three independently deletes only its own <code>DailyJobRun</code> row and notifies Admins with a distinct notification type (<code>daily_report_send_failed</code>/<code>weekly_report_send_failed</code>/<code>monthly_report_send_failed</code>) — one failing never blocks or is confused with another.</p>
          </section>

          <section className="module" id="opportunity-management">
            <div className="module-eyebrow">Wealth &amp; analytics</div>
            <h2>Opportunity Management</h2>

            <h3>Purpose</h3>
            <p>Track interest in specific investment products per client, as a post-onboarding layer that never touches the existing 5-stage onboarding pipeline.</p>

            <h3>Fields</h3>
            <p>
              <code>Opportunity</code> (<code>product</code>: MUTUAL_FUND | BROKING | PMS | AIF | BONDS |
              FIXED_INCOME | UNLISTED_PRE_IPO | OTHER, <code>estimatedValue</code>, <code>stage</code>,{" "}
              <code>stageEnteredAt</code>, <code>lostReason</code>, <code>ownerId</code>);{" "}
              <code>OpportunityStageHistory</code> (mirrors <code>StageHistory</code>&apos;s shape — one row per
              transition).
            </p>

            <h3>Business Rules</h3>
            <ul>
              <li>Deliberately a separate model family from the onboarding <code>Stage</code> engine: <code>Client.currentStageId</code> is a single scalar (one stage per client) and <code>Stage.name</code>/<code>sequence</code> are globally unique, neither of which fits &quot;many concurrent Opportunities per client across products.&quot;</li>
              <li>9 stages: IDENTIFIED &rarr; DISCUSSED &rarr; INTERESTED &rarr; RECOMMENDATION &rarr; DECISION_PENDING &rarr; COMMITTED &rarr; FUNDED &rarr; INVESTED, or LOST_DEFERRED from <em>any</em> stage — not strictly sequential like onboarding.</li>
              <li>Moving an Opportunity to LOST_DEFERRED requires a reason; every other transition does not.</li>
              <li>Pipeline value (&quot;open pipeline value&quot; on the client&apos;s Opportunities tab) is always recomputed on read from the current set of Opportunities (<code>computeOpportunityPipeline()</code>, <code>src/lib/opportunity-engine/pipeline.ts</code>) — never a cached total — and excludes LOST_DEFERRED and INVESTED stages.</li>
              <li>Only visible/addable once <code>Client.status</code> is ACTIVE or COMPLETED — the same &quot;post-onboarding&quot; gate as <a href="#wealth-workspace">Wealth Workspace</a>.</li>
            </ul>

            <h3>Edge Cases</h3>
            <p>Logging an Opportunity creation or stage change writes a NOTE-type Activity to the client&apos;s timeline, the same as KYC/Funding/Dealer status changes already do — there is no dedicated OPPORTUNITY activity type.</p>
          </section>

          <section className="module" id="wealth-workspace">
            <div className="module-eyebrow">Wealth &amp; analytics</div>
            <h2>Wealth Workspace</h2>

            <h3>Purpose</h3>
            <p>Surface a client&apos;s existing portfolio data (from the Household/Trading Account layer) plus two new advisory workflows, on the client&apos;s own page.</p>

            <h3>Fields</h3>
            <p>
              <code>WealthHealthCheckup</code> and <code>SmartAllvestProfile</code> (both 1:1 with{" "}
              <code>Client</code>, string-typed <code>status</code> matching the existing free-form-classifier
              convention rather than a narrow enum); portfolio analytics fields are computed, not stored (
              <code>src/lib/wealth/portfolio-analytics.ts</code>).
            </p>

            <h3>Business Rules</h3>
            <ul>
              <li>Holdings reuse <code>latestPositionPerHolding()</code> — the exact same Households AUM-dedup rule (latest <code>asOfDate</code> snapshot per holding only, never a sum across every historical import).</li>
              <li>Asset allocation buckets <code>ProductCategory</code> into 6 groups: Equity, Mutual Fund, PMS, Fixed Income (Bond + Fixed Deposit combined), Insurance, and Other (NPS, AIF, Other combined).</li>
              <li>Concentration risk is a Herfindahl-Hirschman Index over those 6 bucket weights (sum of squared fractional shares): &lt;0.15 Diversified, 0.15&ndash;0.25 Moderate, &gt;0.25 Concentrated.</li>
              <li>Risk-profile alignment compares a &quot;growth&quot; share (Equity + Mutual Fund + PMS, as a fraction of growth + defensive [Fixed Income + Insurance], Other excluded from the ratio) against a band per <code>SmartAllvestProfile.investorRiskProfile</code>: Conservative 0&ndash;30%, Moderate 30&ndash;65%, Aggressive 65&ndash;100%.</li>
              <li>Holding duplication flags the same product held via more than one Trading Account for the client — informational (e.g. deliberate separate SIPs), not necessarily a problem.</li>
              <li>Same Active/Completed-only visibility gate as <a href="#opportunity-management">Opportunity Management</a>.</li>
            </ul>

            <h3>Edge Cases</h3>
            <p>Both the HHI thresholds and the risk-alignment bands are an explicit starting heuristic per the code&apos;s own comments — not a compliance-reviewed model. With zero holdings, allocation/concentration/alignment all render as &quot;no holdings yet&quot; rather than a misleading 0%/Diversified.</p>
          </section>

          <section className="module" id="manager-dashboard">
            <div className="module-eyebrow">Wealth &amp; analytics</div>
            <h2>Manager Dashboard</h2>

            <h3>Purpose</h3>
            <p>One consolidated Admin+Manager page for org/team KPIs, lead trends, per-RM performance, and the onboarding pipeline — replacing the standalone Executive Dashboard (removed 20 September 2026).</p>

            <h3>Fields</h3>
            <p>No new schema — composes <code>getReportsPageData()</code>, <code>getTeamActivityRows()</code> (<code>src/lib/reports/team-performance.ts</code>), and the shared <code>RmPerformanceTable</code> component.</p>

            <h3>Business Rules</h3>
            <ul>
              <li>Team Performance (this page&apos;s own table) shows Active/Completed/On-Hold/SLA% (point-in-time, as of now) plus Leads Assigned/Clients Contacted/Meetings/Follow-ups Done/KYC Completed/Funds Received/Investments Executed (scoped to the selected date range) per RM.</li>
              <li>RM Performance (a second table, folded in from the removed Executive Dashboard) shows Active/Completed/Overdue Tasks/SLA%/Avg Onboarding Days/Capacity — the same shared component and numbers Reports itself shows.</li>
              <li>Pipeline View reuses the exact <code>stageId === &quot;__LOST__&quot; &rarr; /clients?status=NOT_PROCEEDING</code> special case the Stage Funnel chart already established (<a href="#leads-activity">Leads Activity &amp; Daily Email</a>&apos;s sibling Reports page) — every other stage links to <code>/clients?stage=&lt;id&gt;</code>.</li>
              <li>The PDF export (<code>GET /api/reports/management-dashboard-pdf</code>) calls the identical two data functions the page itself calls (<code>getReportsPageData()</code> + <code>getTeamActivityRows()</code>), so it can never drift from what&apos;s on screen; it renders in landscape A4, not portrait, specifically because the Team Performance table alone has 12 columns.</li>
              <li>Gated <code>requireRole([&quot;ADMIN&quot;, &quot;MANAGER&quot;])</code> — a Manager sees the same sections as Admin, scoped to their own team via the page&apos;s existing <code>getVisibleUserIds()</code> narrowing, same as everywhere else in the app.</li>
            </ul>

            <h3>Edge Cases</h3>
            <p>A table-position bug (both here and in the pre-existing Reports PDF export) was found and fixed during this build: the PDF-generation helpers used <code>doc.x</code> as each table&apos;s left-start position, but <code>doc.x</code> carries over from the last explicitly-positioned cell rather than resetting to the page margin, so each successive table drifted further right than the last — in the Reports PDF (9 sequential tables), this pushed everything from &quot;Bottleneck Analysis&quot; onward completely off the visible page. Fixed by anchoring both helpers to <code>doc.page.margins.left</code> instead.</p>
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

          <section className="module" id="debugger">
            <div className="module-eyebrow">Automation &amp; access</div>
            <h2>Debugger</h2>

            <h3>Purpose</h3>
            <p>Let any signed-in user report an in-app issue without leaving the page, and get it in front of an Admin immediately.</p>

            <h3>Fields</h3>
            <p><code>BugReport</code> (<code>reportedById</code>, <code>pageUrl</code>, <code>description</code>, <code>status</code>: OPEN | RESOLVED, <code>resolvedById</code>/<code>resolvedAt</code>/<code>resolutionNotes</code>).</p>

            <h3>Business Rules</h3>
            <ul>
              <li>Filing a report is <code>requireUser()</code> only — any authenticated role, not just Admin/Manager.</li>
              <li><code>pageUrl</code> auto-fills from <code>window.location.pathname</code> at the moment the report dialog opens, rather than asking the user to type it.</li>
              <li>Filing fans out a <code>Notification</code> to every active Admin, reusing the same <code>Promise.all</code>-of-<code>prisma.notification.create</code> idiom already established for auto-assign failures and other Admin-facing alerts — this is what makes a new report visible &quot;immediately&quot; without any new polling mechanism.</li>
              <li>Resolving a report (<code>requireRole([&quot;ADMIN&quot;])</code>) requires resolution notes and sets <code>resolvedById</code>/<code>resolvedAt</code>.</li>
            </ul>

            <h3>Edge Cases</h3>
            <p>The Debugger queue page itself is Admin-only — a non-Admin role never sees it in the sidebar and is redirected to their own home page on a direct hit, but can still file a report from any page via the header&apos;s bug icon.</p>
          </section>

          <section className="module" id="roles-visibility">
            <div className="module-eyebrow">Automation &amp; access</div>
            <h2>Roles &amp; Visibility</h2>

            <h3>Purpose</h3>
            <p>Define who sees which clients and which pages.</p>

            <h3>Fields</h3>
            <p><code>Role</code> enum (ADMIN, MANAGER, RM, DEALER, TEAM_MANAGER, PARTNER, AFFILIATE, DISTRIBUTOR, FINANCE); <code>User.managerId</code>/<code>manager</code>/<code>reports</code> (legacy team hierarchy, unchanged); <code>PartnerProfile</code>, <code>Team</code>, <code>Company</code>, <code>HierarchyAssignment</code> (effective-dated via <code>validFrom</code>/<code>validTo</code>) for the 5 new roles.</p>

            <h3>Business Rules</h3>
            <p>
              <code>getVisibleUserIds()</code> is the single function backing every scoped query for the 4 legacy
              roles (Clients list, Reports, RM drill-down, command palette search): Admin sees everyone (returns
              <code>null</code>, meaning unrestricted); Manager sees themself plus every direct report,
              including a report who has since gone inactive (their historical clients stay visible); RM sees
              only clients assigned to them; Dealer sees only clients with a Dealer Handoff record assigned to
              them.
            </p>
            <p>
              <code>getVisibleScope()</code> (<code>src/lib/policy/visibility.ts</code>) generalizes this for the
              5 Distribution OS roles without touching the original function — for ADMIN/MANAGER/RM/DEALER it
              delegates to <code>getVisibleUserIds()</code> verbatim (zero behavior drift), and returns an
              additional <code>partnerProfileIds</code>/<code>teamIds</code> shape for the new roles: TEAM_MANAGER
              resolves via <code>HierarchyAssignment</code> rows matching either <code>parentUserId</code> or
              membership in a <code>Team</code> they manage (<code>Team.teamManagerId</code>) — both paths are
              checked, since either can express the same relationship; PARTNER/AFFILIATE resolve to just their
              own <code>PartnerProfile.id</code>; DISTRIBUTOR additionally includes every descendant
              sub-partner&apos;s <code>PartnerProfile.id</code>, found recursively via
              <code>parentPartnerProfileId</code>. <strong>FINANCE is the one deliberately asymmetric case</strong>:
              it returns <code>userIds: null</code> but does <em>not</em> mean unrestricted client access the way
              it does for Admin — Finance is never granted client-row visibility through this function at all;
              Finance-facing queries join through <code>partnerProfileIds</code> only.
            </p>
            <p>
              <code>can()</code>/<code>PolicyAction</code>/<code>Decision</code>
              (<code>src/lib/policy/can.ts</code>) is a new, additive authorization entry point for new
              resources/actions — it does not replace <code>requireRole()</code>, which every existing callsite
              keeps using unchanged. A caller-supplied filter (e.g. a query-param RM id) is only ever honored if
              it&apos;s within the caller&apos;s own visible set, generalized as <code>narrowToVisibleIds()</code>{" "}
              from the same invariant <code>buildClientWhere()</code> already established for Clients.
            </p>

            <h3>Edge Cases</h3>
            <p>Opening a page or record outside your role/visibility returns a 404 (RM drill-down, client detail) or a redirect to your own role&apos;s home page via <code>resolveWorkspaceHome()</code> (page-level route guard) — never a permission-denied error page. A new role added without updating <code>getVisibleScope()</code> fails closed to <code>{"{ userIds: [userId], partnerProfileIds: null, teamIds: null }"}</code> rather than silently inheriting another role&apos;s behavior.</p>
          </section>

          <section className="module" id="identity-hierarchy">
            <div className="module-eyebrow">Distribution OS</div>
            <h2>Identity, Hierarchy &amp; Policy Engine</h2>

            <h3>Purpose</h3>
            <p>Extend the existing 4-role identity model with 5 additional roles and a commercial/hierarchy fabric for partners and team managers, without altering any existing role&apos;s behavior.</p>

            <h3>Fields</h3>
            <p>
              <code>Role</code> +5 (<code>TEAM_MANAGER</code>, <code>PARTNER</code>, <code>AFFILIATE</code>,
              <code>DISTRIBUTOR</code>, <code>FINANCE</code>); <code>Company</code>, <code>Team</code>
              (<code>teamManagerId</code>); <code>PartnerProfile</code> (<code>partnerType</code>,{" "}
              <code>tier</code>, <code>empanelmentStatus</code>, <code>panNumber</code>/<code>gstin</code>{" "}
              stored encrypted, <code>parentPartnerProfileId</code> for commission roll-up);{" "}
              <code>HierarchyAssignment</code> (<code>relationType</code>, either a user or partner on each side,
              <code>validFrom</code>/<code>validTo</code>).
            </p>

            <h3>Business Rules</h3>
            <ul>
              <li>All 5 new roles are additive — the <code>Role</code> enum, <code>User</code> model, and every existing ADMIN/MANAGER/RM/DEALER behavior are unchanged.</li>
              <li>A Team Manager relationship can be expressed two ways: <code>HierarchyAssignment.parentUserId</code> directly, or membership (<code>teamId</code>) in a <code>Team</code> the manager owns (<code>Team.teamManagerId</code>). <code>getVisibleScope()</code> must check both, or a Team Manager&apos;s own team appears empty — this was a real bug fixed during the build, not a hypothetical.</li>
              <li>A Distributor&apos;s sub-partner network is resolved recursively via <code>parentPartnerProfileId</code> — there is no depth limit.</li>
              <li><code>HierarchyAssignment</code> is effective-dated (<code>validFrom</code>/<code>validTo</code>); a row with <code>validTo: null</code> is currently active.</li>
            </ul>

            <h3>Edge Cases</h3>
            <p>A user assigned a new role with no <code>PartnerProfile</code>/<code>HierarchyAssignment</code> yet fails closed — see <a href="#roles-visibility">Roles &amp; Visibility</a>&apos;s Edge Cases.</p>
          </section>

          <section className="module" id="masking-approvals">
            <div className="module-eyebrow">Distribution OS</div>
            <h2>Field Masking &amp; Maker-Checker Approvals</h2>

            <h3>Purpose</h3>
            <p>Mask sensitive client fields for roles that don&apos;t need to see them, log every time an authorized role views one unmasked, and require a second, different approver for sensitive actions across the app.</p>

            <h3>Fields</h3>
            <p>
              <code>CLIENT_MASK_RULES</code> (<code>src/lib/policy/masking.ts</code>); <code>DataAccessLog</code>
              (<code>userId</code>, <code>entity</code>, <code>entityId</code>, <code>fieldName</code>,{" "}
              <code>accessedAt</code>); <code>ApprovalRequest</code> (<code>actionType</code>, <code>entity</code>,{" "}
              <code>status</code>, <code>payload</code>, <code>requestedById</code>, <code>decidedById</code>);
              the <code>ApprovalActionType</code> registry (<code>STAGE_OVERRIDE</code>,{" "}
              <code>ERASURE_REQUEST</code>, <code>PAYOUT_ADJUSTMENT</code>, <code>COMMISSION_ADJUSTMENT</code>, and
              others reserved for future use).
            </p>

            <h3>Business Rules</h3>
            <ul>
              <li>Masking a field is silent (never logged); every time a role that <em>is</em> allowed to see a sensitive field actually renders it unmasked, one <code>DataAccessLog</code> row is written.</li>
              <li>Every <code>ApprovalDefinition</code> is registered once, at app startup, via a side-effect-only import module — new action types need no migration, just a new registration.</li>
              <li><code>decideApproval()</code> hard-blocks a requester from also being the decider of their own request, re-checked in the service layer regardless of what the UI allows.</li>
              <li>An approval is claimed via a fast, conditional <code>updateMany</code> (WHERE status still PENDING) rather than a full <code>$transaction</code> wrapping the entire decision — the claim is the only part that needs to be atomic; the actual side effect (<code>def.apply()</code>) runs afterward, outside any transaction, since it can be arbitrarily complex (a full stage transition, a payout-run approval touching several tables). An earlier version wrapped both in one transaction and a real approval blew past Prisma&apos;s 5-second interactive-transaction timeout (<code>P2028</code>) — this split is a fix for a real bug, not a defensive assumption.</li>
            </ul>

            <h3>Edge Cases</h3>
            <p>A masked field that&apos;s also blank/null renders as <code>••••</code> rather than an empty string, so a masked field is never visually indistinguishable from a genuinely missing one.</p>
          </section>

          <section className="module" id="client-product-360">
            <div className="module-eyebrow">Distribution OS</div>
            <h2>Household, Trading Account &amp; Portfolio Data</h2>

            <h3>Purpose</h3>
            <p>Give the CRM a canonical, ingestible record of a client&apos;s brokerage accounts, holdings, and transactions — the Client &amp; Product 360 layer the Earnings Engine is built on.</p>

            <h3>Fields</h3>
            <p>
              <code>Household</code>/<code>HouseholdMember</code>;{" "}
              <code>TradingAccount</code> (<code>accountType</code>, <code>status</code>,{" "}
              <code>sourcingPartnerId</code> — not named <code>Account</code>, to avoid colliding with the
              existing <code>AccountHolder</code> joint-holder concept); <code>Product</code> (<code>category</code>);{" "}
              <code>Position</code> (<code>quantity</code>, <code>currentValue</code>, <code>asOfDate</code>);{" "}
              <code>Transaction</code> (<code>transactionType</code>, <code>grossAmount</code>,{" "}
              <code>brokerageAmount</code>).
            </p>

            <h3>Business Rules</h3>
            <ul>
              <li>Every ingestion path (CSV import today; a future batch-feed adapter tomorrow) upserts by <code>(sourceSystem, externalRef[, asOfDate])</code> — the sole idempotency mechanism, matching the existing <code>DailyJobRun</code>/<code>Document.externalId</code> precedent.</li>
              <li><code>Position.asOfDate</code> must be truncated to the calendar day, not a live timestamp — an <code>asOfDate</code> with millisecond precision defeats the idempotency key and creates a duplicate snapshot on every re-run. A real bug, fixed during the build.</li>
              <li>CSV import auto-creates a bare <code>TradingAccount</code>/<code>Product</code> by code if one doesn&apos;t exist yet, matching how a real back-office feed would need to handle a first-seen account/instrument; the Earnings Engine&apos;s own revenue-CSV import does <em>not</em> auto-create a <code>TradingAccount</code> — it must already exist.</li>
            </ul>

            <h3>Edge Cases</h3>
            <p>
              AUM (a household&apos;s or account&apos;s total holding value) is always computed from each
              holding&apos;s <strong>latest</strong> <code>asOfDate</code> snapshot only, via one shared function
              (<code>latestPositionPerHolding()</code>) used by both the Households list and detail page — summing
              every historical snapshot instead silently double/triple-counts AUM every time a new import lands.
              This was a real bug caught during the build, not a defensive assumption; both pages call the same
              function specifically so they can never disagree again.
            </p>
          </section>

          <section className="module" id="earnings-engine">
            <div className="module-eyebrow">Distribution OS</div>
            <h2>Immutable Earnings Engine</h2>

            <h3>Purpose</h3>
            <p>Compute and track partner commission owed against real revenue, with full traceability back to source data, as an internal estimation/reporting tool — it never executes a bank transfer.</p>

            <h3>Fields</h3>
            <p>
              <code>CommissionPlan</code>/<code>CommissionRule</code> (<code>rateType</code>:
              PERCENT_OF_GROSS | PERCENT_OF_NET | FLAT_PER_TRANSACTION | SLAB, effective-dated) /{" "}
              <code>CommissionSlab</code>; <code>PartnerCommissionAssignment</code> (effective-dated);{" "}
              <code>RevenueEvent</code> (<code>revenueType</code>, <code>grossRevenueAmount</code>,{" "}
              <code>reversesEventId</code> for corrections, append-only); <code>CommissionAccrual</code>{" "}
              (<code>status</code>: ACCRUED | ADJUSTED | REVERSED | INCLUDED_IN_PAYOUT,{" "}
              <code>computationVersion</code>); <code>PayoutRun</code> (<code>status</code>: DRAFT |
              PENDING_APPROVAL | APPROVED | FINALIZED | CANCELLED) / <code>Payout</code> (<code>status</code>:
              ESTIMATED | APPROVED | RECONCILED_EXTERNALLY) / <code>PayoutLine</code>;{" "}
              <code>CommissionAdjustment</code>.
            </p>

            <h3>Business Rules</h3>
            <ul>
              <li>Two revenue-ingestion paths: auto-sync from <code>Transaction.brokerageAmount</code> (<code>sourceSystem: "txn_sync"</code>) for BROKERAGE revenue that already exists from Household 360 data, or CSV import (<code>sourceSystem: "csv_import"</code>) for revenue types with no natural transaction link (trail/upfront commission, AMC payout, advisory fee). Both upsert by <code>(sourceSystem, externalRef)</code>.</li>
              <li>Rule-matching for a given <code>RevenueEvent</code> picks the single <strong>most specific</strong> active <code>CommissionRule</code>: a rule matching both <code>productCategory</code> and <code>transactionType</code> outranks one matching only one field, which outranks a catch-all (both null) rule.</li>
              <li>Recomputing accruals is idempotent via <code>@@unique([revenueEventId, partnerProfileId, commissionRuleId])</code>; accruals already <code>INCLUDED_IN_PAYOUT</code> (frozen once their run is approved) are never touched by a recompute.</li>
              <li>A <code>PayoutRun</code> submission (DRAFT → PENDING_APPROVAL) and a <code>CommissionAdjustment</code> both route through the same maker-checker engine as <a href="#masking-approvals">Field Masking &amp; Maker-Checker Approvals</a>, reusing the <code>PAYOUT_ADJUSTMENT</code>/<code>COMMISSION_ADJUSTMENT</code> action types respectively.</li>
              <li>Approving a <code>PayoutRun</code> flips it, its <code>Payout</code>s, and their included <code>CommissionAccrual</code>s to APPROVED/APPROVED/INCLUDED_IN_PAYOUT in one step. Finalizing an already-approved run needs no second approval — it&apos;s a bookkeeping close-out (locks the period), not a new financial decision.</li>
              <li><code>RECONCILED_EXTERNALLY</code> only records that Allvest&apos;s own external finance system confirmed a transfer separately — this system never executes one itself, per its "estimation &amp; reporting only" design.</li>
            </ul>

            <h3>Edge Cases</h3>
            <p>A <code>RevenueEvent</code> whose <code>TradingAccount</code> has no <code>sourcingPartnerId</code>, or whose partner has no active <code>PartnerCommissionAssignment</code> for that date, silently produces no accrual — a legitimate outcome (that revenue has no partner commission owed on it), not an error.</p>
          </section>

          <section className="module" id="scoped-workspaces">
            <div className="module-eyebrow">Distribution OS</div>
            <h2>Partner Home, Management &amp; Finance Consoles</h2>

            <h3>Purpose</h3>
            <p>Give each new role its own home route inside the same app shell — no forked layout, no separate application — via <code>resolveWorkspaceHome()</code>.</p>

            <h3>Fields</h3>
            <p>None new — these pages compose existing models (<code>PartnerProfile</code>, <code>TradingAccount</code>, <code>CommissionAccrual</code>, <code>Payout</code>, <code>ApprovalRequest</code>) scoped via <code>getVisibleScope()</code>.</p>

            <h3>Business Rules</h3>
            <ul>
              <li>Partner Home scopes its Referred Clients and Earnings panels to the caller&apos;s own <code>PartnerProfile.id</code> — plus every descendant sub-partner&apos;s, for a Distributor.</li>
              <li>Management Console scopes its roster to <code>getVisibleScope()</code>&apos;s <code>userIds</code>/<code>partnerProfileIds</code> for the calling Team Manager.</li>
              <li>Finance Console is deliberately <strong>not</strong> partner-scoped — Finance sees every pending approval and every <code>APPROVED</code> payout awaiting reconciliation across the whole organization, consistent with FINANCE&apos;s visibility rule in <a href="#roles-visibility">Roles &amp; Visibility</a>.</li>
            </ul>

            <h3>Edge Cases</h3>
            <p>A Partner/Affiliate/Distributor user with no <code>PartnerProfile</code> row yet gets a 404 on Partner Home rather than an empty page — proving the row-level linkage, not just the role gate.</p>
          </section>

          <section className="module" id="apis-cron">
            <div className="module-eyebrow">Technical</div>
            <h2>APIs, Webhooks &amp; Cron Jobs</h2>
            <p className="lede">Every HTTP route Supportify exposes outside its own UI, and the scheduled jobs that keep it running without anyone watching a clock.</p>

            <h3>Cron: <code>POST /api/internal/cron/tick</code></h3>
            <p>
              Triggered every 5 minutes by GitHub Actions (<code>.github/workflows/journey-cron.yml</code>, a
              plain <code>curl</code> POST), authenticated via an <code>x-cron-secret</code> header checked
              against <code>process.env.CRON_SECRET</code> — 401 if it doesn&apos;t match. Runs 10 jobs every
              tick, each isolated so one failure can&apos;t block the rest: <code>checkOverdueTasks</code>,
              <code>checkStageSla</code>, <code>checkFundingSla</code>, <code>processDueJourneySteps</code>,
              <code>checkDisengagement</code>, <code>sendDailyReportEmail</code> (the Leads Activity digest +
              per-RM Daily Reports), <code>sendWeeklyManagementReport</code>,{" "}
              <code>sendMonthlyManagementReport</code>, <code>seedDistributionOsDemoData</code>, and{" "}
              <code>seedBaselineStages</code>. Jobs don&apos;t have their own cron expressions —
              every job runs every tick and self-determines whether it actually needs to do anything (e.g. the
              daily email checks the current IST hour and a <code>DailyJobRun</code> row before sending; the
              weekly/monthly reports additionally check day-of-week/day-of-month — see{" "}
              <a href="#management-reports">Weekly &amp; Monthly Management Reports</a>).
              Response is a JSON object with one key per job, each either the job&apos;s own result or{" "}
              <code>{"{ error }"}</code> if that job threw.
            </p>
            <p>
              <code>seedDistributionOsDemoData</code> and <code>seedBaselineStages</code> are both one-time
              jobs — the former guarded by a <code>DailyJobRun</code>-style mutex (seeded demo Distribution OS
              accounts directly in production, working around Vercel Secret-type environment variables being
              unreadable via CLI, and is now a permanent no-op), the latter guarded by a real completion check
              (does the <code>Stage</code> table already contain all 5 baseline stages, not a mutex) so a
              transient failure partway through self-heals on the next tick instead of permanently &quot;completing&quot;
              having created zero rows.
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
