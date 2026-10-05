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
            <a className="nav-link" href="#kyc-pipeline">KYC Pipeline &amp; Approval</a>
            <a className="nav-link" href="#editing-merge">Editing, Archiving &amp; Merge</a>
            <a className="nav-link" href="#client-snapshot-payments">Client Snapshot, Trades &amp; Payments</a>
          </div>
          <div className="nav-group">
            <div className="nav-group-label">Routing &amp; intelligence</div>
            <a className="nav-link" href="#auto-assignment">Auto-Assignment &amp; Assignment Modes</a>
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
            <a className="nav-link" href="#ai-summaries-spec">AI Summaries</a>
            <a className="nav-link" href="#quality-audit-spec">Quality Audit</a>
          </div>
          <div className="nav-group">
            <div className="nav-group-label">Automation &amp; access</div>
            <a className="nav-link" href="#journeys">Journeys</a>
            <a className="nav-link" href="#notifications">Notifications</a>
            <a className="nav-link" href="#push-notifications">Phone Push Notifications</a>
            <a className="nav-link" href="#device-sync">Android App &amp; Call-Log Sync</a>
            <a className="nav-link" href="#whatsapp-inbox-spec">WhatsApp Inbox</a>
            <a className="nav-link" href="#activity-tracking">Activity Tracking</a>
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
            <a className="nav-link" href="#webhook-security">Webhook Security</a>
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
            <p>Move a client through 6 fixed stages with an enforced SLA clock and mandatory-completeness gates at each transition.</p>

            <h3>Fields</h3>
            <p>
              6 fixed stages with SLA targets — New Lead (4h), Submitted for KYC (24h), KYC completed (72h),
              Pushed for funds (120h), Introduction with Dealer (48h), Onboarding Completed (no SLA — terminal) —
              plus <code>stageEnteredAt</code>, <code>currentStageId</code>, and per-stage Exceptions (holds) with
              <code>reason</code>, <code>createdAt</code>, <code>resolvedAt</code>.
            </p>

            <h3>Business Rules</h3>
            <ul>
              <li>A client is Overdue once it has spent 100% of the stage&apos;s SLA target hours in that stage; Due Soon at 75%; On Track under that.</li>
              <li>Time inside an open exception (hold) is excluded from stage-age math — resuming picks the clock back up from where it left off.</li>
              <li>Submit for KYC requires every mandatory document Verified (or Not Applicable), unless a Manager/Admin explicitly checks an override.</li>
              <li>Only a KYC outcome of Approved advances the stage; Rejected or Additional Info Required keeps the client on the same stage and notifies the RM. Recording that outcome is <code>requireRole([&quot;ADMIN&quot;, &quot;MANAGER&quot;])</code> with a scope check, and — for any client that has KYC steps — is refused until every step is Verified or Skipped (see <a href="#kyc-pipeline">KYC Pipeline &amp; Approval</a>).</li>
              <li>Referral exemption: <code>isReferralLeadSource(leadSource)</code> (a trimmed, case-insensitive match on &quot;referral&quot;, since <code>leadSource</code> is free text) makes a client&apos;s SLA status <code>NOT_APPLICABLE</code> everywhere it is shown, and removes it from every SLA <em>alert</em> (<code>checkStageSla</code> breach and due-soon, <code>checkFundingSla</code> task and escalation). Aggregates (<code>slaByStage</code>/<code>slaByRm</code>, SLA Compliance %, per-RM SLA % and overdue) drop such clients from <em>both</em> numerator and denominator rather than counting them as compliant; aging histograms and Active counts still include them. <code>StageHistory.slaMet</code> is written as <code>null</code> for them. The unrelated <code>Task.status = OVERDUE</code> is untouched.</li>
              <li>A stage SLA alert is created once per stage visit (deduped on <code>createdAt &ge; stageEnteredAt</code>, independent of read state) — marking it read never causes it to re-fire; <code>stage_sla_due_soon</code> fires at the 75% mark under the same rule.</li>
              <li>Marking funding Partially/Fully Funded requires both an amount &ge; &#8377;5,000 and the penny-drop verification checkbox.</li>
              <li>Manager/Admin can force-correct a client to any stage directly; this always requires a logged reason and appears in Exceptions for 7 days.</li>
              <li><code>putOnHoldAction</code> is <code>requireRole([&quot;ADMIN&quot;, &quot;MANAGER&quot;])</code> as of 19 September 2026 (previously any authenticated user) — closing a real control gap where an RM could pause the SLA clock they themselves are measured against. <code>resumeFromHoldAction</code> is unchanged (any role), since resuming only makes SLA tracking stricter again, carrying none of the same conflict-of-interest risk.</li>
              <li>Reaching &quot;Onboarding Completed&quot; (stage 6) is an explicit RM action (<code>markOnboardingCompletedAction</code>), not automatic — it re-validates KYC Approved and funding qualifying server-side, and requires a Dealer Name on file, before advancing the stage and flipping <code>Client.status</code> to COMPLETED in the same step. Recording dealer progress from either the RM&apos;s own client page or the Dealer&apos;s <code>/dealer-desk</code> self-service page both correctly advance the client onto stage 5 (<code>ensureDealerIntroStageReached</code>), fixing a bug where a Dealer-only update left the client stuck behind it.</li>
            </ul>

            <h3>Edge Cases</h3>
            <p>
              A client that was auto-completed under the previous (pre-20 September 2026) silent-completion
              model is moved onto the real &quot;Onboarding Completed&quot; stage by a one-time, idempotent cron
              backfill (<code>backfillCompletedClientsToFinalStage</code>) rather than a migration, so no
              historically-completed client&apos;s stage tracker regresses once stage 6 exists.
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

          <section className="module" id="kyc-pipeline">
            <div className="module-eyebrow">Client lifecycle</div>
            <h2>KYC Pipeline &amp; Approval</h2>

            <h3>Purpose</h3>
            <p>Break &quot;KYC&quot; into the verifications it actually consists of, track each per person, chase stalled ones, and make final approval a deliberate Admin/Manager decision.</p>

            <h3>Fields</h3>
            <p>
              <code>KycStep</code> (<code>clientId</code>, <code>holderId</code> nullable = First Holder,{" "}
              <code>holderKey</code> = <code>&quot;PRIMARY&quot;</code> or the holder id, <code>type</code>,{" "}
              <code>status</code>: NOT_STARTED | IN_PROGRESS | VERIFIED | FAILED | SKIPPED, <code>provider</code>,{" "}
              <code>providerRef</code>, <code>result</code> (non-PII summary), <code>failureReason</code>,{" "}
              <code>attempts</code>, <code>decidedById</code>/<code>decidedAt</code>, <code>statusChangedAt</code>,{" "}
              <code>reminderLevel</code>). Definitions live in <code>src/lib/kyc/steps.ts</code>: PAN_VERIFICATION
              (24h), ADDRESS_VERIFICATION (48h), BANK_VERIFICATION (24h), RISK_PROFILE (48h), IPV (72h), ESIGN (48h),
              KRA (72h), CKYC (72h). The existing <code>KycRecord</code> keeps the overall decision.
            </p>

            <h3>Business Rules</h3>
            <ul>
              <li>PAN, address, IPV, KRA and CKYC are per-holder (seeded for the First Holder and every active joint holder); bank, risk profile and e-Sign exist once, on the First Holder. <code>seedKycSteps</code> is idempotent (<code>skipDuplicates</code>) and is also how a holder added after submission gets their steps.</li>
              <li>Dependencies: IPV needs that holder&apos;s PAN and address; e-Sign needs every holder&apos;s PAN, address and IPV plus the primary bank and risk profile; KRA and CKYC need the primary e-Sign. A step is done when VERIFIED or SKIPPED.</li>
              <li>All status changes go through <code>transitionKycStep()</code>: allowed moves are NOT_STARTED&rarr;IN_PROGRESS/VERIFIED/FAILED/SKIPPED, IN_PROGRESS&rarr;VERIFIED/FAILED/SKIPPED, FAILED&rarr;IN_PROGRESS/SKIPPED, VERIFIED/SKIPPED&rarr;IN_PROGRESS (reopen); a re-run of an in-progress async check is allowed; FAILED, SKIPPED and reopening a done step each require a reason; any non-skip move requires its dependencies done; a done step can&apos;t be reopened while a completed later step depends on it. Each change writes an audit record.</li>
              <li>Roles: <code>startKycStepAction</code> and <code>runKycCheckAction</code> are open to anyone who can access the client (RM, Manager in team or for unassigned leads, Admin); <code>decideKycStepAction</code> (verify / fail / skip / reopen) is <code>ADMIN</code>/<code>MANAGER</code> only — maker-checker, since the RM who worked the step shouldn&apos;t also be the one to certify it.</li>
              <li>Automation: <code>KYC_AUTOMATION_PROVIDER</code> selects a provider; unset (production default) means every step is manual and &quot;Run check&quot; is not offered. The built-in mock provider is for local/Preview only and is refused when <code>VERCEL_ENV</code> is production. Only a non-PII summary comes back from a provider.</li>
              <li>Approval: <code>completeKyc</code> (status APPROVED) throws, naming them, if any step is not VERIFIED/SKIPPED; it also writes <code>AuditLog</code> (<code>kyc_approved</code> / <code>kyc_rejected</code> / <code>kyc_info_requested</code>). Submitting for KYC notifies the assigned RM&apos;s manager and every Admin (<code>kyc_approval_pending</code>).</li>
              <li>Drop-off (<code>checkKycDropOffs</code>, every tick): considers only <em>actionable</em> steps (not done, dependencies met) of ACTIVE, non-deleted clients on &quot;Submitted for KYC&quot;. Past a step&apos;s SLA hours: level 1 &mdash; RM task <code>KYC stuck: &lt;step&gt;</code> (due +24h) and <code>kyc_step_stalled</code> notification (Admins if unassigned); past 2&times;: level 2 &mdash; <code>kyc_step_escalated</code> to the RM&apos;s manager (Admins if none). <code>reminderLevel</code> is claimed with a conditional <code>updateMany</code> so concurrent ticks can&apos;t double-send, and resets whenever the step changes status.</li>
            </ul>

            <h3>Edge Cases</h3>
            <p>Clients submitted before the step pipeline existed have no <code>KycStep</code> rows and are approved the original way (<code>steps.length === 0</code> skips the gate). Steps of a removed (soft-deleted) joint holder are excluded everywhere.</p>
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
              <li>On merge, documents, tasks, activity, stage history, and exceptions all move onto the surviving record. As of 19 September 2026, the surviving record also inherits the merged-away client&apos;s <code>TradingAccount</code> and <code>RevenueEvent</code> rows — previously left orphaned on the now-<code>NOT_PROCEEDING</code> duplicate — and, since the activity and payments work, its <code>Message</code>, <code>ClientPayment</code> and <code>DeviceCall</code> rows (so a merged-away client&apos;s WhatsApp thread, payments and phone-call history follow the survivor).</li>
              <li>
                <strong>Permanent deletion</strong> (17 September 2026) finishes the existing{" "}
                <code>ErasureRequest</code>/<code>ApprovalRequest</code> maker-checker flow end-to-end: Admin or
                Finance can request one (reason required) from the client page; a <em>different</em> Admin
                approves it via Approval Workflows; only then can an Admin <strong>execute</strong> it
                (type-the-client&apos;s-name-to-confirm). Execution is refused — not silently partial — if the
                client has any <code>TradingAccount</code>, <code>HouseholdMember</code>,{" "}
                <code>RevenueEvent</code>, <code>ClientPayment</code>, or <code>AdvisoryInteraction</code> row; that check is re-run{" "}
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

          <section className="module" id="client-snapshot-payments">
            <div className="module-eyebrow">Client lifecycle</div>
            <h2>Client Snapshot, Trades &amp; Payments</h2>

            <h3>Purpose</h3>
            <p>Show AUM, whether funds were added, and the last trade on a client&apos;s Overview, and keep a payments history — all fed by back-office data rather than typed in.</p>

            <h3>Fields</h3>
            <p>
              <code>ClientPayment</code> (<code>clientId</code>, optional <code>tradingAccountId</code>,{" "}
              <code>paymentType</code>: FUNDS_IN | FUNDS_OUT | FEE | OTHER, <code>amount</code>, <code>paidAt</code>,{" "}
              <code>mode</code>, <code>referenceNumber</code>, <code>status</code>: SUCCESS | PENDING | FAILED,{" "}
              <code>sourceSystem</code>, <code>externalRef</code>; <code>@@unique([sourceSystem, externalRef])</code>).
              The snapshot is computed, not stored: <code>computeClientSnapshot()</code> (<code>src/lib/clients/snapshot.ts</code>) takes pre-fetched rows
              and returns <code>aum</code>, <code>funds</code> and <code>lastTrade</code>.
            </p>

            <h3>Business Rules</h3>
            <ul>
              <li>AUM = sum of <code>currentValue</code> over <code>latestPositionPerHolding()</code> (the same latest-snapshot-only rule as Households, so it always equals the Households figure), with an &quot;as of&quot; date, holdings/accounts counts, allocation by category, and a separate <code>pipelineEstimatedAum</code> (sum of <code>estimatedAum</code> on opportunities not yet Invested or Lost/Deferred).</li>
              <li>&quot;Funds Added&quot; is Yes when the funding record is PARTIALLY_FUNDED/FULLY_FUNDED, <em>or</em> has an amount &gt; 0, <em>or</em> successful FUNDS_IN payments total &gt; 0 — back-office payments count as evidence of funds even if the RM never updated the funding form. Amount shown is the funding record&apos;s, falling back to the payments total.</li>
              <li>Last Trade is the most recent <code>Transaction</code> across the client&apos;s trading accounts, with a 30-day trade count and a &quot;last synced&quot; time.</li>
              <li>Import: Admin/Manager only, via Households &gt; Import Payments (<code>bulkImportPaymentsAction</code>, up to 1,000 rows; required <code>clientCode</code>, <code>externalRef</code>, <code>paidAt</code>, <code>amount</code>). <code>importPaymentRow()</code> is exported separately from the role-gated action so a live back-office adapter can reuse it. It upserts by (<code>sourceSystem</code>, <code>externalRef</code>) so re-imports update rather than duplicate, rejects an <code>externalRef</code> already owned by another client, and rejects an <code>accountNumber</code> that isn&apos;t that client&apos;s.</li>
              <li>Transaction re-imports now refresh every mutable field (previously only <code>grossAmount</code>).</li>
              <li>Merge reparents <code>ClientPayment</code>; permanent erasure refuses a client with payments (financial record), like a trading account.</li>
            </ul>

            <h3>Edge Cases</h3>
            <p>With no positions, trades or payments the cards show &quot;No holdings synced yet&quot; / &quot;No trades synced yet&quot; / &quot;No payments synced yet&quot; rather than zeros. Referral and early-stage clients will commonly be empty.</p>
          </section>

          <section className="module" id="auto-assignment">
            <div className="module-eyebrow">Routing &amp; intelligence</div>
            <h2>Auto-Assignment &amp; Assignment Modes</h2>

            <h3>Purpose</h3>
            <p>Route a new, unassigned lead to the right RM automatically instead of leaving every lead for a manager to hand out.</p>

            <h3>Fields</h3>
            <p>
              <code>AssignmentSettings</code> — a singleton row (<code>id = &quot;default&quot;</code>, created on first read by{" "}
              <code>getAssignmentSettings()</code>) holding <code>mode</code> (<code>AssignmentMode</code>: LOAD_BASED
              | ROUND_ROBIN | MANUAL; default LOAD_BASED, so behaviour is unchanged until an Admin changes it),{" "}
              <code>roundRobinCursorId</code>, <code>updatedById</code>. RM <code>availability</code> (Available / On Leave / Unavailable), <code>regions[]</code>,
              <code>languages[]</code>, <code>hniCapable</code>, <code>capacity</code>; Client
              <code>region</code>/<code>preferredLanguage</code>/<code>clientType</code>/<code>expectedInvestment</code>.
            </p>

            <h3>Business Rules</h3>
            <p>
              <code>pickAssignee()</code> (<code>src/lib/assignment/routing-engine.ts</code>) reads the mode, then:
              LOAD_BASED &mdash; the eligible RM with the fewest active clients; ROUND_ROBIN &mdash; the next eligible
              RM after the stored cursor in stable id order (wrapping), with the cursor advanced inside a transaction
              holding <code>SELECT &hellip; FOR UPDATE</code> on the settings row so simultaneous leads can&apos;t be handed
              to the same RM; MANUAL &mdash; returns <code>{"{ assignedToId: null, reason: \"manual_mode\" }"}</code>
              without evaluating anyone. Eligibility (<code>getEligibleRms()</code>, shared by both automatic modes) is the filter chain below, ending at capacity; load balancing is then the LOAD_BASED tiebreak:
            </p>
            <p>Filters are applied in order — the first one an RM fails excludes them:</p>
            <ol>
              <li>HNI eligibility — a client type of HNI/U-HNI, or expected investment &ge; &#8377;1 crore, requires an HNI-capable RM.</li>
              <li>Region &amp; language match — the RM&apos;s tagged regions/languages must include the client&apos;s (an RM with nothing tagged has no constraint).</li>
              <li>Capacity — the RM&apos;s current active client count must be under their configured capacity (default 50).</li>
              <li>Load balancing — among everyone left, the RM with the fewest active clients wins.</li>
            </ol>

            <ul>
              <li>Callers: <code>createClientCore</code> (manual create, CSV import, inbound webhooks via <code>resolveInboundClient</code>) and the on-leave redistribution in <code>settings/users/actions.ts</code>. An RM chosen explicitly is honoured in every mode and never reaches <code>pickAssignee()</code>.</li>
              <li>On <code>manual_mode</code> or <code>no_eligible_rm</code> the client is left unassigned (no &quot;assign to creator&quot; fallback), an audit entry is written (<code>auto_assign_skipped_manual</code> or <code>auto_assign_failed</code>), and every active Admin and Manager gets an <code>unassigned_lead</code> notification (<code>payload.reason</code> distinguishes the two).</li>
              <li>Unassigned leads are workable: <code>buildClientWhere(..., {"{ includeUnassigned }"})</code> (true for Managers) adds them to a Manager&apos;s list, <code>rm=unassigned</code> filters to them (Admin/Manager), and Admins and Managers may open an unassigned client.</li>
              <li><code>reassignClientAction</code> and <code>bulkReassignClientsAction</code> notify the new owner with <code>new_assignment</code> and share one permission rule (<code>assertMayReassign</code>): Admins may move any client; Managers clients in their team or unassigned; an RM only a client currently assigned to them (a hand-off); every other role is refused. The target must be an active RM, Manager or Admin.</li>
              <li>Changing the mode (<code>/settings/lead-assignment</code>, Admin only) writes <code>AuditLog</code> <code>assignment_mode_changed</code> (old &rarr; new). The round-robin cursor advance is treated as bookkeeping and is not a user action in the Activity Log.</li>
            </ul>

            <h3>Edge Cases</h3>
            <p>
              If no RM clears every filter, the client is created unassigned and every Manager/Admin is
              notified. Marking an RM On Leave/Unavailable re-runs this same routing (in the current mode) for their existing active
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
              <li>The drill-down page also shows, for just that RM: SLA by Stage, the stage-aging heatmap and a Currently Overdue list (<code>computeStageAging()</code> scoped to a single-RM array); a Stage Durations table (<code>getStageDurations()</code> called with <code>{"{ assignedToId: id }"}</code> — the same methodology as the org-wide Bottleneck Analysis, deliberately not <code>StageHistory.durationHours</code>, so the two numbers can be cross-checked); and Assigned Clients with a Last Updated column (latest <code>Activity</code>, not <code>Client.updatedAt</code>, which housekeeping also bumps) and a Referral Source column.</li>
              <li>SLA % and overdue exclude Referral-sourced clients from numerator and denominator (see <a href="#pipeline-gates">Onboarding Pipeline &amp; Stage Gates</a>); <code>active</code> still counts them.</li>
              <li>AI summaries: <code>rm_individual</code> (one RM, Admin/Manager only, honouring the page&apos;s <code>pillarsFrom</code>/<code>pillarsTo</code> range) and <code>rm_overall</code> (the whole visible team) — see <a href="#ai-summaries-spec">AI Summaries</a>.</li>
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
              convention rather than a narrow enum); <code>PmsAifHolding</code> (<code>clientId</code>,{" "}
              <code>productName</code>, <code>status</code>: NOT_INVESTED | INVESTED | REDEEMED, <code>amount</code>,{" "}
              <code>investedDate</code>, <code>remarks</code>; <code>@@unique([clientId, productName])</code>);{" "}
              <code>Client.investmentCategory</code> (&quot;Wealth&quot; | &quot;Broking&quot; | &quot;Wealth &amp; Broking&quot;, a free-text
              column fed by <code>INVESTMENT_CATEGORIES</code>); portfolio analytics fields are computed, not stored (
              <code>src/lib/wealth/portfolio-analytics.ts</code>).
            </p>

            <h3>Business Rules</h3>
            <ul>
              <li>Holdings reuse <code>latestPositionPerHolding()</code> — the exact same Households AUM-dedup rule (latest <code>asOfDate</code> snapshot per holding only, never a sum across every historical import).</li>
              <li>Asset allocation buckets <code>ProductCategory</code> into 6 groups: Equity, Mutual Fund, PMS, Fixed Income (Bond + Fixed Deposit combined), Insurance, and Other (NPS, AIF, Other combined).</li>
              <li>Concentration risk is a Herfindahl-Hirschman Index over those 6 bucket weights (sum of squared fractional shares): &lt;0.15 Diversified, 0.15&ndash;0.25 Moderate, &gt;0.25 Concentrated.</li>
              <li>Risk-profile alignment compares a &quot;growth&quot; share (Equity + Mutual Fund + PMS, as a fraction of growth + defensive [Fixed Income + Insurance], Other excluded from the ratio) against a band per <code>SmartAllvestProfile.investorRiskProfile</code>: Conservative 0&ndash;30%, Moderate 30&ndash;65%, Aggressive 65&ndash;100%.</li>
              <li>Holding duplication flags the same product held via more than one Trading Account for the client — informational (e.g. deliberate separate SIPs), not necessarily a problem.</li>
              <li>PMS/AIF: four fixed products (<code>PMS_AIF_PRODUCTS</code> = PMS (Allvest), PMS (Walfort), AIF II, AIF III) are always rendered; a client with no row for one shows Not Invested. Each product saves independently via <code>updatePmsAifHoldingAction</code> as an upsert on (<code>clientId</code>, <code>productName</code>), so there is no global product catalog entry or fake <code>sourceSystem</code> to maintain for what is manual data entry.</li>
              <li>Investment Category is optional on create/edit/CSV import, filterable on the Clients list (<code>buildClientWhere</code>, so the CSV export honours it too), shown as a badge in the client header, and existing clients were backfilled to &quot;Wealth&quot; in the migration that added it.</li>
              <li>The Trading activity table (last trades) is shown on the Wealth tab regardless of status; the holdings/analytics/PMS-AIF/checkup/profile cards use the same Active/Completed-only visibility gate as <a href="#opportunity-management">Opportunity Management</a>.</li>
            </ul>

            <h3>Edge Cases</h3>
            <p>Both the HHI thresholds and the risk-alignment bands are an explicit starting heuristic per the code&apos;s own comments — not a compliance-reviewed model. With zero holdings, allocation/concentration/alignment all render as &quot;no holdings yet&quot; rather than a misleading 0%/Diversified.</p>
          </section>

          <section className="module" id="manager-dashboard">
            <div className="module-eyebrow">Wealth &amp; analytics</div>
            <h2>Manager Dashboard</h2>

            <h3>Purpose</h3>
            <p>One consolidated Admin+Manager page for cohort KPIs, the onboarding pipeline, lead activity and per-RM performance over a chosen period — replacing the standalone Executive Dashboard (removed 20 September 2026).</p>

            <h3>Fields</h3>
            <p>No new schema — composes <code>getReportsPageData()</code> (with its optional <code>cohortRange</code> argument), <code>getTeamActivityRows()</code> (<code>src/lib/reports/team-performance.ts</code>), <code>getStageDurations()</code>, and <code>LeadsActivitySection</code>. Period maths lives in <code>src/lib/reports/period-range.ts</code>.</p>

            <h3>Business Rules</h3>
            <ul>
              <li>Period: <code>?period=day|week|month|quarter</code> (default month) with <code>?anchor=YYYY-MM-DD</code> for Previous/Next, or <code>?period=custom&amp;from=&amp;to=</code>. Custom is tracked by a separate <code>isCustom</code> flag and resolves to a day granularity underneath (it is deliberately not a member of <code>PeriodGranularity</code>, like Leads Activity&apos;s own type). Calendar weeks start Monday. <code>parseManagementPeriodParams()</code> is shared by the page and the PDF route, so their boundaries can&apos;t drift. The picker&apos;s Custom button reveals its date inputs from local state — a custom range only takes effect once both dates are set, so it can&apos;t depend on a server round-trip to show them.</li>
              <li>The page-wide period also decides Leads Activity&apos;s bucket width (<code>granularityForPeriod</code>: quarter &rarr; weekly buckets, otherwise daily); that chart&apos;s own picker is hidden on this page via <code>overrideRange</code>.</li>
              <li>Six KPIs — Total Leads, Active for Onboarding, On-Hold, Completed, Avg Onboarding Time, SLA Compliance — are a <em>cohort</em>: <code>cohortWhere</code> adds <code>createdAt</code> within the period to the funnel, the status counts, the completed-duration and on-hold queries. With no <code>cohortRange</code> (Reports and the three other callers) behaviour is identical to before.</li>
              <li>Deliberate asymmetry: in the merged Team &amp; RM Performance table, SLA % and Overdue Tasks are always current (derived from the unfiltered active rows), while Active, Completed, On-Hold and Avg Onboarding Days follow the cohort (<code>activeCohortRows</code>, derived in memory from the same fetch, passed into <code>computeRmPerformance</code>); the SLA Compliance <em>KPI</em> uses the cohort. The remaining columns (Leads Assigned, Clients Contacted, Meetings, Follow-ups Done, KYC Completed, Funds Received, Investments Executed) are activity within the period. Capacity is static.</li>
              <li>Pipeline View lists client count per stage plus each stage&apos;s Conversion % and Avg Time in Stage (joined by <code>stageId</code>; the synthetic Lost row shows &quot;&mdash;&quot; for both). Every row links to the filtered Clients list, with <code>stageId === &quot;__LOST__&quot;</code> &rarr; <code>/clients?status=NOT_PROCEEDING</code> and otherwise <code>/clients?stage=&lt;id&gt;</code>. The two stage-timing queries use the cohort filter too, so they move with the period.</li>
              <li>PDF: <code>GET /api/reports/management-dashboard-pdf</code> calls the same data functions and period parser, in landscape A4; the performance table is rendered as two stacked tables of eight columns each (A4 landscape can&apos;t fit 15 columns legibly). <code>GET /api/reports/leads-activity-pdf</code> exports just the Leads Activity table for the period.</li>
              <li>Gated <code>requireRole([&quot;ADMIN&quot;, &quot;MANAGER&quot;])</code>; every figure is narrowed by <code>getVisibleUserIds()</code>, so a Manager sees only their own team.</li>
              <li>AI summaries: <code>management</code> (&quot;Summarize this period&quot;) and <code>rm_overall</code> — see <a href="#ai-summaries-spec">AI Summaries</a>.</li>
            </ul>

            <h3>Edge Cases</h3>
            <p>A table-position bug (both here and in the pre-existing Reports PDF export) was found and fixed during this build: the PDF-generation helpers used <code>doc.x</code> as each table&apos;s left-start position, but <code>doc.x</code> carries over from the last explicitly-positioned cell rather than resetting to the page margin, so each successive table drifted further right than the last — in the Reports PDF (9 sequential tables), this pushed everything from &quot;Bottleneck Analysis&quot; onward completely off the visible page. Fixed by anchoring both helpers to <code>doc.page.margins.left</code> instead.</p>
          </section>

          <section className="module" id="ai-summaries-spec">
            <div className="module-eyebrow">Wealth &amp; analytics</div>
            <h2>AI Summaries</h2>

            <h3>Purpose</h3>
            <p>Give a one-click, plain-language read of a page&apos;s data without building a separate reporting view, using OpenAI chat completions on fact sheets the app assembles itself.</p>

            <h3>Fields</h3>
            <p>
              <code>AiSummary</code> (<code>kind</code>, <code>subjectKey</code>, <code>contentHash</code>,{" "}
              <code>summary</code>, <code>model</code>, <code>userId</code>, <code>createdAt</code>;{" "}
              <code>@@unique([kind, subjectKey, contentHash])</code>). One server action,{" "}
              <code>summarizePageAction({"{ kind, subjectId?, period?, force? }"})</code>, behind a shared{" "}
              <code>AiSummaryCard</code> client component. Env: <code>OPENAI_API_KEY</code> (required),{" "}
              <code>OPENAI_SUMMARY_MODEL</code> (default <code>gpt-4o-mini</code>), <code>OPENAI_BASE_URL</code> (tests only).
            </p>

            <h3>Business Rules</h3>
            <ul>
              <li>Kinds and role gates (<code>ALLOWED_ROLES</code>): <code>client</code>, <code>my_day</code>, <code>quality_review</code> &mdash; Admin/Manager/RM; <code>management</code>, <code>reports</code>, <code>rm_individual</code>, <code>rm_overall</code> &mdash; Admin/Manager. The role check comes first; each builder (<code>src/lib/ai/summaries/builders.ts</code>) then re-applies the page&apos;s own record-level visibility via <code>getVisibleUserIds()</code> (a Manager may open an unassigned client, an RM may not; an out-of-scope id returns &quot;not found&quot;).</li>
              <li>Facts are a compact plain-text sheet built from the same queries the page uses (<code>getReportsPageData</code>, <code>buildWorklist</code>, the client snapshot, review fields) &mdash; the prompt instructs the model to use only those facts and say when something is missing.</li>
              <li>PII minimisation: PAN, mobile, email, bank details and raw transcripts are never included; every free-text fact (notes, task titles) passes through <code>safeLine()</code>/<code>redactPii()</code>, which masks emails, PAN-shaped and long numeric strings and caps length. Client names, codes and business figures are sent.</li>
              <li>Cache: key is a SHA-256 of kind + instruction + facts, so identical data is served from <code>AiSummary</code> with no API call; <code>force</code> (Refresh) regenerates. Cap: 30 generations per user per rolling hour (counted from <code>AiSummary</code> rows by <code>userId</code>); cache hits don&apos;t count.</li>
              <li>The action never throws to the UI: failures come back as <code>{"{ ok: false, error }"}</code>, with <code>notConfigured</code> when no key is set. There is deliberately <strong>no</strong> canned fallback &mdash; unlike Quality Audit&apos;s placeholder, a fabricated summary would mislead.</li>
            </ul>

            <h3>Edge Cases</h3>
            <p>Because the cache key includes the facts, a summary silently refreshes whenever the underlying numbers change; the &quot;saved&quot; marker only appears when nothing changed. The UI labels output as AI-generated and to be verified before acting.</p>
          </section>

          <section className="module" id="quality-audit-spec">
            <div className="module-eyebrow">Wealth &amp; analytics</div>
            <h2>Quality Audit</h2>

            <h3>Purpose</h3>
            <p>Score the conversations RMs have with clients — sentiment, quality against a fixed rubric, and a recommended next action — automatically, with a human able to review and override.</p>

            <h3>Fields</h3>
            <p>
              <code>ConversationReview</code> (<code>sourceType</code>: CALL | WHATSAPP_THREAD; <code>sourceActivityId</code> for calls, <code>coveredFromAt</code>/<code>coveredToAt</code> watermark for threads; <code>status</code>: PENDING_TRANSCRIPT | ANALYZING | ANALYZED | FAILED; <code>transcript</code>; <code>sentimentLabel</code>/<code>sentimentScore</code>/<code>sentimentReasoning</code>; <code>qualityScore</code> 0&ndash;100 and <code>qualityBreakdown</code> JSON; <code>recommendationText</code>/<code>Kind</code>/<code>DueAt</code>; <code>aiModel</code>, <code>aiRawResponse</code>; <code>reviewedById</code>, <code>reviewNotes</code>, <code>overriddenScore</code>; <code>taskId</code>; <code>assignedRmId</code> denormalised for scoping). The rubric is a code constant (<code>src/lib/ai/quality-rubric.ts</code>): Greeting &amp; Introduction 10, Needs Discovery 25, Compliance &amp; Disclosure 20, Objection Handling 20, Clarity &amp; Professional Tone 15, Next Steps &amp; Closing 10.
            </p>

            <h3>Business Rules</h3>
            <ul>
              <li>Calls: an Exotel <code>call_completed</code> webhook creates a review (PENDING_TRANSCRIPT) and triggers Exotel&apos;s voice-analysis (transcription only) with a callback to <code>/api/internal/exotel/voice-analyze-callback</code> (secret-checked and rate-limited); the callback stores the transcript, then runs analysis. <code>checkStaleVoiceAnalysis</code> marks reviews stuck in PENDING_TRANSCRIPT for over 2 hours as FAILED.</li>
              <li>WhatsApp: <code>sweepWhatsAppConversationReviews</code> (every tick, up to 200 candidates) compiles up to 300 recent messages per client with activity since the last review&apos;s <code>coveredToAt</code>, so a thread is never re-reviewed for the same messages.</li>
              <li>Analysis is one Claude call per conversation returning sentiment, rubric breakdown and recommendation (Zod-validated; <code>qualityScore</code> must equal the sum of criteria). Transcripts are tail-truncated to 12,000 characters. The model used is stored per row. With no <code>ANTHROPIC_API_KEY</code> a deterministic placeholder (neutral, zero scores, clearly labelled) is stored instead, so the pipeline stays testable.</li>
              <li>The recommendation becomes a task via <code>createTaskIfNotExists</code> with source <code>quality-audit:&lt;reviewId&gt;</code> (due 24h, or 4h when sentiment is negative or the score is under 50 unless the model suggests otherwise). A score under 50 or negative sentiment creates <code>quality_review_low_score</code> for the RM, and for a HIGH-priority client also for the RM&apos;s manager (<code>escalated: true</code>).</li>
              <li>Visibility: the list and detail pages use <code>getVisibleUserIds()</code> against <code>assignedRmId</code>. Submitting a review/override (<code>submitQualityReviewAction</code>) is <code>requireRole([&quot;ADMIN&quot;, &quot;MANAGER&quot;])</code>; the AI score itself is never overwritten &mdash; the override is stored beside it.</li>
            </ul>

            <h3>Edge Cases</h3>
            <p>A call with no recording or a failed transcription ends FAILED with <code>failureReason</code>; the review is retained rather than deleted. The shape of Exotel&apos;s callback payload isn&apos;t published, so the callback parses several plausible field names defensively; if none matches, the review is marked FAILED and the raw payload is logged so the real shape can be confirmed. Concurrent deliveries are collapsed by an atomic status claim.</p>
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
              New assignment; unassigned lead; task overdue (+escalation); stage SLA due soon; stage SLA breach
              (+escalation); document rejected; KYC update; KYC approval pending; KYC step failed / stalled /
              escalated; funding pending (+escalation); hold started / client reopened; dealer intro pending;
              excessive overdue workload; journey notify-manager; client disengaged; external task status
              changed; inbound WhatsApp message; WhatsApp account offline; low quality-review score; daily / weekly
              / monthly report send failed; bug report filed. Types are free text on <code>Notification.type</code>;
              rendering, push category and tap-through URL for each live in <code>src/lib/notifications/describe.ts</code>.
            </p>

            <h3>Business Rules</h3>
            <p>Escalation variants additionally notify the assignee&apos;s manager, not just the assignee. &quot;Mark all read&quot; clears the badge count only — it does not resolve the underlying condition.</p>
            <ul>
              <li>Dedupe is per event, not per unread state: stage breach and due-soon are keyed on (client, <code>stageEnteredAt</code>), funding-SLA and disengagement alerts on their own anchor timestamps (<code>createdAt &ge;</code> the stage-entry / last-contact time). Previously these checked only <em>unread</em> notifications, so reading an alert let the next 5-minute tick recreate it — harmless in the bell, but it would have re-buzzed phones.</li>
              <li><code>stage_sla_due_soon</code> fires when status reaches DUE_SOON (&ge;75% of the stage SLA), to the assigned RM only, with <code>hoursLeft</code> in the payload. Referral clients are exempt.</li>
              <li><code>unassigned_lead</code> goes to every active Admin and Manager; <code>kyc_approval_pending</code> to the RM&apos;s manager and every Admin.</li>
              <li>Every <code>Notification.create</code>, from any caller, also triggers phone push — see <a href="#push-notifications">Phone Push Notifications</a>.</li>
            </ul>

            <h3>Edge Cases</h3>
            <p>The daily Leads Activity email digest is a separate, email-only automation — it does not create an in-app <code>Notification</code> row or appear in the bell feed.</p>
          </section>

          <section className="module" id="push-notifications">
            <div className="module-eyebrow">Automation &amp; access</div>
            <h2>Phone Push Notifications</h2>

            <h3>Purpose</h3>
            <p>Deliver every in-app notification to a user&apos;s phone as a push, even with the app closed, with per-category opt-out.</p>

            <h3>Fields</h3>
            <p>
              <code>PushToken</code> (<code>userId</code>, <code>token</code> unique, <code>platform</code>,{" "}
              <code>lastSeenAt</code>); <code>User.pushMutedCategories String[]</code>. Categories (
              <code>notificationCategory()</code>): <code>sla_tasks</code>, <code>assignments</code>,{" "}
              <code>clients_kyc</code>, <code>messages</code>, <code>system</code>. Env:{" "}
              <code>FIREBASE_SERVICE_ACCOUNT_JSON</code> (raw or base64 service-account JSON), <code>PUSH_DRY_RUN=1</code> (logs instead of sending).
            </p>

            <h3>Business Rules</h3>
            <ul>
              <li>One hook, not 29 call sites: the Prisma extension in <code>src/lib/db/prisma.ts</code> calls <code>pushForNotification()</code> after any <code>Notification.create</code> (cron job, server action or webhook alike), regardless of actor, via Next&apos;s <code>after()</code> where there&apos;s a request and a 3-second-bounded await otherwise.</li>
              <li><code>pushForNotification</code> skips inactive users and muted categories, builds the message from the same <code>describeNotification()</code> the bell uses (title from a small map, falling back to &quot;Supportify&quot;; body capped at 180 characters), and sets the tap-through <code>url</code> from <code>notificationUrl()</code> (client page, <code>/tasks</code>, <code>/inbox</code>, <code>/quality-audit/&lt;id&gt;</code>, <code>/debugger</code>, else <code>/dashboard</code>).</li>
              <li>Sender: <code>firebase-admin</code> <code>sendEachForMulticast</code> to all of the user&apos;s tokens, Android high priority on channel <code>alerts</code>; tokens FCM reports as unregistered or invalid are deleted. Everything degrades quietly &mdash; no credentials is a no-op, and any failure is logged and swallowed so a push problem can never break the action that created the notification.</li>
              <li>Registration (<code>registerPushTokenAction</code>) upserts by token and <em>reassigns it to the current user</em>, which is correct for a shared phone. Sign-out unregisters that phone&apos;s token; the token is read at form-submit time (the <code>formdata</code> event) because it is stored asynchronously after the app registers, possibly after the sidebar first renders.</li>
              <li>Preferences and a &quot;Send test notification&quot; live under Settings &gt; Account &gt; Phone notifications; the test reports separately whether no phone is registered, the server key is missing, or delivery failed.</li>
            </ul>

            <h3>Edge Cases</h3>
            <p>Push needs the native <code>PushNotifications</code> plugin, which ships in the Android app build, so users must update to a build that includes it; Firebase setup (a <code>google-services.json</code> secret for the APK build and the service-account key on the server) is an operator task outside the app.</p>
          </section>

          <section className="module" id="device-sync">
            <div className="module-eyebrow">Automation &amp; access</div>
            <h2>Android App &amp; Call-Log Sync</h2>

            <h3>Purpose</h3>
            <p>Record a user&apos;s phone calls with their own clients on those clients&apos; Activity timelines, without ever storing calls that aren&apos;t with a client.</p>

            <h3>Fields</h3>
            <p>
              <code>DeviceToken</code> (<code>userId</code>, <code>tokenHash</code> unique — SHA-256 of a random 32-byte token,{" "}
              <code>label</code>, <code>appVersion</code>, <code>lastSeenAt</code>, <code>lastSyncAt</code>,{" "}
              <code>lastSyncMatched</code>, <code>revokedAt</code>); <code>DeviceCall</code> (<code>userId</code>,{" "}
              <code>clientId</code>, <code>deviceTokenId</code>, <code>activityId</code> unique, <code>phoneKey</code>,{" "}
              <code>direction</code>: INCOMING | OUTGOING | MISSED | REJECTED | OTHER, <code>startedAt</code>,{" "}
              <code>durationSeconds</code>; <code>@@unique([userId, phoneKey, startedAt, direction])</code>). The app is a Capacitor shell (<code>android-app/</code>) that loads the live site, plus a WorkManager worker and a native <code>CallLogSync</code> plugin; the APK is built by GitHub Actions and signed with a key kept outside the repo.
            </p>

            <h3>Business Rules</h3>
            <ul>
              <li>Auth: after an in-app consent screen, <code>registerDeviceAction</code> mints a token, stores only its hash and hands the plaintext once to the native plugin (encrypted preferences). <code>authenticateDevice()</code> fails closed for revoked tokens, deactivated users and roles outside ADMIN/MANAGER/RM; a 401 makes the app clear its token and stop. The user (or an Admin, from the user&apos;s page) can revoke; both are audited (<code>device_sync_enabled</code>/<code>device_sync_disabled</code>).</li>
              <li>Ingest: <code>POST /api/device/call-log</code> (Bearer token, 60 requests/min/IP, body &le; 200 KB, &le; 500 calls per request, calls older than ~31 days or more than 5 minutes in the future dropped). Numbers are reduced to their last 10 digits; short/private numbers are dropped. One query matches those keys against non-deleted, non-merged clients whose normalised mobile matches <em>and</em> whose assignee is inside the caller&apos;s <code>getVisibleUserIds()</code> (RM: own; Manager: team; Admin: all); several clients on one number resolve to the earliest-created.</li>
              <li>Only matches are stored. Each match creates a <code>CALL</code> Activity at the call&apos;s real time (<code>createdAt</code> back-dated) with <code>source: &quot;device&quot;</code>, direction and duration, plus its <code>DeviceCall</code> ledger row in one transaction; a unique-violation means already synced and rolls the Activity back. The response is counts only (<code>matched</code>, <code>duplicates</code>, <code>ignored</code>) &mdash; unmatched calls are never persisted or logged, and the request body is never logged.</li>
              <li>Cadence: on app open and a ~15-minute periodic job; the first sync backfills 30 days; the watermark only advances on a 2xx.</li>
              <li>Merge reparents <code>DeviceCall</code>; permanent erasure deletes them before activities.</li>
            </ul>

            <h3>Edge Cases</h3>
            <p>Android 13+ treats the call-log permission as &quot;restricted&quot; for sideloaded apps, so the user must first allow restricted settings in App info. iOS exposes no call-log API, so there is no iPhone equivalent. Behaviour on a real handset (permission flows, background scheduling, download/file-picker handling) can only be confirmed on a device, not in CI.</p>
          </section>

          <section className="module" id="whatsapp-inbox-spec">
            <div className="module-eyebrow">Automation &amp; access</div>
            <h2>WhatsApp Inbox</h2>

            <h3>Purpose</h3>
            <p>A shared, access-controlled inbox over several RMs&apos; WhatsApp numbers, with each conversation attached to its client and replies sent from the right number.</p>

            <h3>Fields</h3>
            <p>
              <code>WhatsAppAccount</code> (<code>sessionId</code> unique, <code>label</code>, <code>ownerUserId</code> unique, <code>phoneNumber</code>,{" "}
              <code>status</code>: DISCONNECTED | QR_PENDING | CONNECTING | CONNECTED | FAILED, <code>qrDataUrl</code>/<code>qrUpdatedAt</code>, <code>lastSeenAt</code>, <code>lastError</code>, <code>isActive</code>); on <code>Message</code>: <code>accountId</code>, <code>senderUserId</code>, <code>origin</code> (customer | crm | phone), <code>sentAt</code>, <code>readAt</code>, <code>claimedAt</code>, media type/URL, with <code>@@unique([accountId, externalId])</code>. A separate always-on package, <code>whatsapp-worker/</code>, drives the unofficial Openwa library (one OS process per number) and has no database credentials: it posts HMAC-signed events (<code>WHATSAPP_WORKER_SECRET</code>, &plusmn;5-minute window) to <code>/api/internal/whatsapp/events</code> and polls <code>/outbox</code> for queued sends, reporting each in <code>/outbox/&lt;id&gt;/result</code>.
            </p>

            <h3>Business Rules</h3>
            <ul>
              <li>Scope (<code>getInboxScope()</code>) is deliberately <em>not</em> <code>getVisibleUserIds()</code>: Admin and Manager see every conversation (including unassigned clients); an RM only those of clients assigned to them; other roles none. The boundary is always <code>Client.assignedToId</code>, so reassignment moves access on the next query with no separate ACL. Replying is Admin, or the assigned RM; Managers are view-only (<code>canReplyTo</code>, re-checked server-side in <code>replyBlockReason</code>).</li>
              <li>Ingest (<code>ingestMessage</code>): unknown/inactive account, system message types, groups/broadcasts/newsletters and <code>@lid</code> chat ids are ignored; redelivery is idempotent on (<code>accountId</code>, <code>externalId</code>); media becomes a bracketed placeholder body (<code>[Image]</code>, &hellip;) with no stored file; bodies are capped at 4,096 characters. The client is found by last-10-digit match; an unmatched <em>inbound</em> message creates a lead (<code>leadSource: WhatsApp</code>, assigned to the account&apos;s owner via <code>resolveInboundClient</code>), while an unmatched message sent from the phone is skipped so personal chats don&apos;t become leads. Messages the CRM just sent are recognised by external id so the phone echo isn&apos;t double-recorded.</li>
              <li>Send (<code>queueWhatsAppReply</code>): the reply account is that of the client&apos;s most recent WhatsApp message (falling back to the assigned RM&apos;s own number), the account must be active, CONNECTED and heard from within 90 seconds, and the body is 1&ndash;4,096 characters. A <code>QUEUED</code> outbound row is created; the worker claims it with <code>FOR UPDATE SKIP LOCKED</code> (a claim older than 60 seconds is re-claimable), so delivery is at-least-once &mdash; a crash between send and result can duplicate one message. Failed sends show Retry.</li>
              <li>Unread is cleared only when the <em>assigned RM</em> opens a thread. A new inbound message notifies the assigned RM (<code>inbound_message</code>) unless that client already has an unread one. <code>checkWhatsAppAccountHealth</code> flips a live account to DISCONNECTED when its heartbeat is over 5 minutes old and tells Admins once (<code>whatsapp_offline</code>). QRs are treated as stale after 90 seconds and are visible only to Admins and the owning RM.</li>
              <li>The CRM polls (list ~6s, open thread ~3s, paused when the tab is hidden) rather than holding sockets, since the web tier is serverless.</li>
            </ul>

            <h3>Edge Cases</h3>
            <p>The connection uses an unofficial library against WhatsApp Web, so it can break when WhatsApp changes, and carries ban risk; first-time linking (QR scan, receive, send, reconnect) can only be verified with a real phone. The official Meta Cloud API messaging adapter remains available as a separate path.</p>
          </section>

          <section className="module" id="activity-tracking">
            <div className="module-eyebrow">Automation &amp; access</div>
            <h2>Activity Tracking</h2>

            <h3>Purpose</h3>
            <p>Record who signed in and what each user did — sign-ins, page views, every data change and every download — with a viewer scoped to the right managers.</p>

            <h3>Fields</h3>
            <p>
              <code>UserEvent</code> (<code>userId</code> nullable, <code>userEmail</code> and <code>userRole</code> snapshots, <code>type</code>:
              LOGIN_SUCCESS | LOGIN_FAILED | LOGOUT | PAGE_VIEW | DATA_CREATE | DATA_UPDATE | DATA_DELETE | EXPORT, <code>entity</code>/<code>entityId</code>,{" "}
              <code>path</code>, <code>summary</code>, <code>details</code> JSON, <code>ipAddress</code>, <code>userAgent</code>, <code>createdAt</code>). <code>LoginAttempt</code> now also records IP and user agent.
            </p>

            <h3>Business Rules</h3>
            <ul>
              <li>Data changes are captured centrally, not per action: <code>prisma</code> is a Prisma client extension over <code>basePrisma</code> hooking <code>create</code>, <code>createMany</code>, <code>update</code>, <code>updateMany</code>, <code>upsert</code>, <code>delete</code> and <code>deleteMany</code>. Only <em>field names</em> are recorded (<code>details.fields</code>, or <code>count</code> for the <code>*Many</code> operations) &mdash; never values, so PAN, mobile, email and password hashes can&apos;t leak; old&rarr;new detail stays in <code>AuditLog</code>.</li>
              <li>Skipped: log/system models (<code>UserEvent</code>, <code>LoginAttempt</code>, <code>DataAccessLog</code>, <code>AuditLog</code>, <code>Notification</code>, <code>DailyJobRun</code>, <code>WebhookDelivery</code>, <code>RateLimitCounter</code>) and writes that touch only bookkeeping fields (the sign-in counters on <code>User</code>, the round-robin cursor). Events are only written when a signed-in user is the actor (a React-<code>cache()</code>-wrapped <code>auth()</code>, imported dynamically to avoid a cycle), so cron jobs, webhooks and seeds are not attributed. The write goes through <code>basePrisma</code> (no recursion) and is fire-and-forget: it never delays or fails the user&apos;s own write.</li>
              <li>Sign-in outcomes (<code>LOGIN_SUCCESS</code>/<code>LOGIN_FAILED</code> with reason: wrong password, account locked, unknown/inactive user, IP rate limited) are written from <code>recordLoginAttempt</code>; <code>LOGOUT</code> from the sign-out action. JWT sessions are stateless, so an idle-timeout expiry is not an event; &quot;last activity&quot; is the latest page view or action.</li>
              <li>Page views: <code>PageViewTracker</code> posts the pathname (never the query string) to <code>/api/activity/page-view</code> on route change, skipping the same path within 2 seconds; the route is a handler, not a server action, so it never queues behind real actions, and validates the path.</li>
              <li>Exports log <code>EXPORT</code> (<code>logExport</code>) from the Clients, Reports and Activity Log download routes. The Activity Log CSV is capped at 20,000 rows, neutralises spreadsheet-formula injection in text cells, and is itself logged.</li>
              <li>Viewer: <code>/activity-log</code> (Admin/Manager) with three 24-hour tiles, filters (user, type, IST date range, text) and 50-row pages; scope as in <a href="#roles-visibility">Roles &amp; Visibility</a>. Times are shown in IST (<code>formatIstDateTime</code>). Records are kept indefinitely; there is no purge job.</li>
            </ul>

            <h3>Edge Cases</h3>
            <p>Inside a <code>$transaction</code> the event is written outside it, so a later rollback could leave an event for a change that never committed — acceptable for an activity feed, not for the audit trail (<code>AuditLog</code>). This is employee-activity monitoring: staff should be told it is in place.</p>
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

            <ul>
              <li>Unassigned clients (<code>assignedToId = null</code>) are visible to Admins (always) and Managers (<code>includeUnassigned</code>) but not RMs; the Inbox deliberately does <em>not</em> use <code>getVisibleUserIds()</code> (see <a href="#whatsapp-inbox-spec">WhatsApp Inbox</a>).</li>
              <li>Activity Log: <code>requireRole([&quot;ADMIN&quot;, &quot;MANAGER&quot;])</code>; one rule (<code>buildUserEventWhere()</code>) scopes the page, the per-user card and the CSV export — Admins see everything including failed sign-ins for unknown emails, Managers only events by users in their team, and a user filter is honoured only inside that scope (see <a href="#activity-tracking">Activity Tracking</a>).</li>
              <li>KYC step decisions and KYC approval are ADMIN/MANAGER only, and a Manager is additionally limited to their team&apos;s clients and unassigned leads (<code>authorizeStep</code> / <code>completeKycAction</code>).</li>
              <li>Call sync and device tokens are ADMIN/MANAGER/RM only (<code>DEVICE_SYNC_ROLES</code>), and matching is limited to <code>getVisibleUserIds()</code> of the caller.</li>
            </ul>

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
              <li>Two revenue-ingestion paths: auto-sync from <code>Transaction.brokerageAmount</code> (<code>sourceSystem: &quot;txn_sync&quot;</code>) for BROKERAGE revenue that already exists from Household 360 data, or CSV import (<code>sourceSystem: &quot;csv_import&quot;</code>) for revenue types with no natural transaction link (trail/upfront commission, AMC payout, advisory fee). Both upsert by <code>(sourceSystem, externalRef)</code>.</li>
              <li>Rule-matching for a given <code>RevenueEvent</code> picks the single <strong>most specific</strong> active <code>CommissionRule</code>: a rule matching both <code>productCategory</code> and <code>transactionType</code> outranks one matching only one field, which outranks a catch-all (both null) rule.</li>
              <li>Recomputing accruals is idempotent via <code>@@unique([revenueEventId, partnerProfileId, commissionRuleId])</code>; accruals already <code>INCLUDED_IN_PAYOUT</code> (frozen once their run is approved) are never touched by a recompute.</li>
              <li>A <code>PayoutRun</code> submission (DRAFT → PENDING_APPROVAL) and a <code>CommissionAdjustment</code> both route through the same maker-checker engine as <a href="#masking-approvals">Field Masking &amp; Maker-Checker Approvals</a>, reusing the <code>PAYOUT_ADJUSTMENT</code>/<code>COMMISSION_ADJUSTMENT</code> action types respectively.</li>
              <li>Approving a <code>PayoutRun</code> flips it, its <code>Payout</code>s, and their included <code>CommissionAccrual</code>s to APPROVED/APPROVED/INCLUDED_IN_PAYOUT in one step. Finalizing an already-approved run needs no second approval — it&apos;s a bookkeeping close-out (locks the period), not a new financial decision.</li>
              <li><code>RECONCILED_EXTERNALLY</code> only records that Allvest&apos;s own external finance system confirmed a transfer separately — this system never executes one itself, per its &quot;estimation &amp; reporting only&quot; design.</li>
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
              against <code>process.env.CRON_SECRET</code> — 401 if it doesn&apos;t match. Runs 17 jobs every
              tick, each isolated so one failure can&apos;t block the rest: <code>checkOverdueTasks</code>,
              <code>checkStageSla</code> (breach and due-soon), <code>checkFundingSla</code>,{" "}
              <code>processDueJourneySteps</code>, <code>checkDisengagement</code>,{" "}
              <code>checkWhatsAppAccountHealth</code>, <code>sendDailyReportEmail</code> (the Leads Activity digest +
              per-RM Daily Reports), <code>sendWeeklyManagementReport</code>,{" "}
              <code>sendMonthlyManagementReport</code>, <code>seedDistributionOsDemoData</code>,{" "}
              <code>seedBaselineStages</code>, <code>seedSystemActor</code> (idempotent seed of the webhook
              system actor account), and <code>backfillCompletedClientsToFinalStage</code> (moves any
              legacy-completed client onto the real &quot;Onboarding Completed&quot; stage),{" "}
              <code>checkStaleVoiceAnalysis</code> and <code>sweepWhatsAppConversationReviews</code> (see{" "}
              <a href="#quality-audit-spec">Quality Audit</a>), <code>checkKycDropOffs</code> (see{" "}
              <a href="#kyc-pipeline">KYC Pipeline &amp; Approval</a>), and <code>pruneSecurityTables</code> (see{" "}
              <a href="#webhook-security">Webhook Security</a>). A live, queryable
              summary of these jobs plus every integration&apos;s current mode/enabled state is available to
              Admins at <a href="/settings/system">Settings → System Overview</a>. Jobs don&apos;t have their
              own cron expressions —
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
              (does the <code>Stage</code> table already contain all 6 baseline stages, not a mutex) so a
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
              Inbound event receiver for Freshdesk, Exotel, Clevertap, ClickUp, and Jira. Authenticates, de-duplicates and
              rate-limits the delivery (see <a href="#webhook-security">Webhook Security</a>), then hands
              the payload + headers to that adapter&apos;s own <code>handleWebhook()</code>. Each returned
              event either updates an externally-linked task (ClickUp/Jira status sync) or, if it carries a
              client phone/email, finds the matching client — creating one as a new lead when none exists — logs a
              CALL/TICKET/MESSAGE activity against it and dispatches a Journey &quot;Webhook Received&quot; trigger.
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

            <h3>Activity &amp; device routes</h3>
            <p>
              <code>POST /api/activity/page-view</code> &mdash; session-authenticated (401 otherwise), body{" "}
              <code>{"{ path }"}</code> (must start with <code>/</code>, &le; 300 characters), writes a <code>PAGE_VIEW</code> event.{" "}
              <code>GET /api/activity-log/export</code> &mdash; Admin/Manager, same scope and filters as the page, capped at 20,000 rows, logged as an export.{" "}
              <code>POST /api/device/call-log</code> &mdash; per-device Bearer token (no cookie), see <a href="#device-sync">Android App &amp; Call-Log Sync</a>.
            </p>

            <h3>WhatsApp worker &amp; voice-analysis routes</h3>
            <p>
              <code>POST /api/internal/whatsapp/events</code>, <code>GET /api/internal/whatsapp/outbox</code> and{" "}
              <code>POST /api/internal/whatsapp/outbox/[id]/result</code> are called only by the WhatsApp worker, authenticated with an HMAC of the timestamp and raw body (<code>WHATSAPP_WORKER_SECRET</code>) and refused outside a five-minute window.{" "}
              <code>POST /api/internal/exotel/voice-analyze-callback</code> receives Exotel&apos;s transcripts, secret-checked and rate-limited. See{" "}
              <a href="#whatsapp-inbox-spec">WhatsApp Inbox</a> and <a href="#quality-audit-spec">Quality Audit</a>.
            </p>

            <h3>Reporting PDFs</h3>
            <p>
              <code>GET /api/reports/summary-pdf</code>, <code>management-dashboard-pdf</code>,{" "}
              <code>leads-activity-pdf</code> and <code>rm-daily-report</code> render PDFs from the same data functions as their pages (so they can&apos;t drift), each behind the page&apos;s own role gate and visibility scoping, and each logged as an export.
            </p>

            <h3>Auth: <code>/api/auth/[...nextauth]</code></h3>
            <p>Standard NextAuth catch-all route handling sign-in and session management; not an app-specific API.</p>

            <h3>Edge Cases</h3>
            <ul>
              <li>Every integration (Freshdesk, Exotel, Clevertap, ClickUp, Jira, WhatsApp/SMS, Resend email) runs in Mock mode — behaving identically but against fake data — until an Admin adds live credentials in Settings &gt; Apps &amp; Integrations, which also lists the exact webhook URL to hand each provider.</li>
              <li>An event carrying neither a phone nor an email has nothing to key on and is skipped (acknowledged with 200) rather than erroring, since most providers retry on non-2xx. An event with at least one of them is matched, or creates a lead.</li>
            </ul>
          </section>

          <section className="module" id="webhook-security">
            <div className="module-eyebrow">Technical</div>
            <h2>Webhook Security</h2>

            <h3>Purpose</h3>
            <p>Make inbound webhooks safe to act on now that they can create real client records, not merely annotate existing ones.</p>

            <h3>Fields</h3>
            <p><code>WebhookDelivery</code> (<code>source</code>, <code>eventKey</code>, <code>receivedAt</code>; unique on source + key), <code>RateLimitCounter</code> (<code>key</code>, <code>count</code>, <code>expiresAt</code>), and a <code>webhookSecret</code> credential field on the Freshdesk and Exotel integrations.</p>

            <h3>Business Rules</h3>
            <ul>
              <li>Order in <code>POST /api/webhooks/[provider]</code>: per-IP rate limit (300/min) &rarr; resolve adapter (404 if unknown) &rarr; in a production runtime (<code>VERCEL_ENV=production</code>) refuse any adapter still in Mock mode &rarr; read the raw body &rarr; <code>adapter.verifySignature()</code> (401 on failure) &rarr; parse &rarr; de-duplicate &rarr; process. Authentication happens before parsing and before any database write.</li>
              <li>Verification is per provider and fails closed when no secret is configured: HMAC-SHA256 of the raw body for Meta, Jira and ClickUp (<code>verifyHmacSha256</code>, constant-time compare); a shared secret in a header (Freshdesk) or a <code>?secret=</code> query parameter on the callback URL (Exotel, which can&apos;t sign) &mdash; shared-secret verification, not cryptographic signing. The same secret check guards the Exotel voice-analysis callback and the messaging webhooks.</li>
              <li>De-duplication: <code>claimWebhookDelivery</code> keys on the provider&apos;s event id or a hash of the raw body; a retry of a processed delivery gets <code>{"{ ok: true, duplicate: true }"}</code>. Only authenticated deliveries are claimed (unauthenticated junk can&apos;t fill the table), and a failed processing run releases its claim so the provider&apos;s retry is processed.</li>
              <li>Rate limiting is a Postgres fixed-window counter (one atomic upsert per request, shared across serverless instances). It fails open if the counter can&apos;t be written, so a database blip never takes webhooks down; volumetric floods belong at the edge. <code>pruneSecurityTables</code> (every tick) deletes delivery keys older than 7 days and expired counters.</li>
              <li>Inbound contact: an event with a phone or email and no matching client calls <code>resolveInboundClient()</code> &rarr; <code>createClientCore()</code> as the system actor (<code>system@supportify.internal</code>, <code>ADMIN</code> but <code>isActive: false</code>, so it can never sign in and is outside the RM pool), reusing the normalised duplicate rules and the current assignment mode. <code>Client.mobile</code> is optional for this path (email-only contacts); the manual dialog and CSV import still require it. Lead Source is set from the channel (Email, Live Chat, WhatsApp, Inbound Call). A Freshdesk WhatsApp-channel ticket is logged as a <code>MESSAGE</code>, other tickets as <code>TICKET</code>, Exotel calls as <code>CALL</code> with direction and recording URL.</li>
            </ul>

            <h3>Edge Cases</h3>
            <p>Freshdesk Omni&apos;s exact payload shape isn&apos;t published, so the adapter reads channel, requester and ticket fields defensively and may need a small adjustment once real deliveries are seen. The separate messaging webhook (<code>/api/webhooks/messaging/[channel]</code>) has its own rate limit, authentication (Meta signature / Exotel SMS secret), mock-adapter refusal in production and the same de-duplication, but it only logs messages for clients it already knows and does not create clients.</p>
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
