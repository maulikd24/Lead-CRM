import type { Metadata } from "next";
import Link from "next/link";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import { ArrowLeft } from "lucide-react";

import { requireUser } from "@/lib/auth/require-role";
import { Logo } from "@/components/logo";
import "./handbook.css";

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
  title: "Supportify Handbook",
  description: "A complete, step-by-step reference for every module in Supportify.",
};

export default async function HandbookPage() {
  await requireUser();

  return (
    <div className={`handbook ${plexSans.variable} ${plexMono.variable}`}>
      <div className="layout">
        <nav className="sidebar" aria-label="Guide sections">
          <Link href="/help" className="back-link">
            <ArrowLeft size={14} /> Back to Supportify
          </Link>
          <div className="brand">
            <Logo className="brand-mark" />
            <span className="brand-name">Supportify</span>
          </div>
          <p className="brand-sub">Handbook &middot; Allvest Securities</p>

          <div className="nav-group">
            <div className="nav-group-label">Start here</div>
            <a className="nav-link" href="#welcome">Welcome</a>
            <a className="nav-link" href="#getting-started">Getting started</a>
            <a className="nav-link" href="#roles">Roles &amp; permissions</a>
          </div>
          <div className="nav-group">
            <div className="nav-group-label">Daily work</div>
            <a className="nav-link" href="#dashboard">Dashboard</a>
            <a className="nav-link" href="#clients">Clients</a>
            <a className="nav-link" href="#client-360">Client 360</a>
            <a className="nav-link" href="#pipeline">The onboarding pipeline</a>
            <a className="nav-link" href="#copilot">Co-pilot</a>
          </div>
          <div className="nav-group">
            <div className="nav-group-label">Oversight</div>
            <a className="nav-link" href="#reports">Reports</a>
            <a className="nav-link" href="#exceptions">Exceptions queue</a>
            <a className="nav-link" href="#tasks">Tasks</a>
          </div>
          <div className="nav-group">
            <div className="nav-group-label">Automation</div>
            <a className="nav-link" href="#journeys">Journeys</a>
            <a className="nav-link" href="#dealer-desk">Dealer Handoff Desk</a>
          </div>
          <div className="nav-group">
            <div className="nav-group-label">Administration</div>
            <a className="nav-link" href="#settings">Settings</a>
            <a className="nav-link" href="#notifications">Notifications</a>
            <a className="nav-link" href="#command-palette">Command palette</a>
          </div>
          <div className="nav-group">
            <div className="nav-group-label">Reference</div>
            <a className="nav-link" href="#faq">FAQ</a>
            <a className="nav-link" href="#glossary">Glossary</a>
          </div>
        </nav>

        <main>
          <header className="doc-header" id="welcome">
            <span className="doc-eyebrow">Internal reference</span>
            <h1>The Supportify Handbook</h1>
            <p>
              A complete, step-by-step reference for every module in Supportify — Allvest&apos;s client onboarding
              and lifecycle system. Written for anyone who touches the platform: Relationship Managers, Managers,
              Admins, Dealers, and any team supporting them.
            </p>
            <div className="meta-row">
              <span className="meta-pill">Covers the full onboarding pipeline</span>
              <span className="meta-pill">Organized by module</span>
              <span className="meta-pill">Cross-referenced with in-app Help</span>
            </div>
          </header>

          <section className="module" id="getting-started">
            <div className="module-eyebrow">Start here</div>
            <h2>Getting started</h2>
            <p className="lede">
              What you&apos;ll see the first time you sign in, and the tools that are always available regardless of
              which page you&apos;re on.
            </p>

            <h3>Signing in</h3>
            <p>
              Go to the Supportify sign-in page and enter the email and password an Admin created for you.
              There&apos;s no self-service sign-up — every account is created by an Admin from{" "}
              <a href="#settings">Settings &gt; Users</a>. If you&apos;re a Dealer, signing in takes you straight to
              your <a href="#dealer-desk">Dealer Desk</a> instead of the main Dashboard.
            </p>

            <h3>The guided tour</h3>
            <p>
              The first time you land on the Dashboard, a short guided tour walks through the sidebar items you
              personally have access to. It only runs once — after you dismiss it, it&apos;s marked seen and won&apos;t
              reappear. This handbook is the place to come back to for the same information in more depth.
            </p>

            <h3>The sidebar, top bar, and theme</h3>
            <p>
              The left sidebar lists every page your role can see (see <a href="#roles">Roles &amp; permissions</a>{" "}
              for exactly what each role gets). It can be collapsed to icons only with the toggle at the top of the
              main content area. The top bar holds the global search/command palette and the notifications bell —
              both described in their own sections below. Your personal appearance preference (Light, Dark, or
              follow System) lives in <a href="#settings">Settings &gt; Account</a> and is remembered on that
              device.
            </p>
          </section>

          <section className="module" id="roles">
            <div className="module-eyebrow">Start here</div>
            <h2>Roles &amp; permissions</h2>
            <p className="lede">
              Everything else in this handbook depends on which of these four roles you have — it decides both what
              you can see in the sidebar and which clients&apos; data you&apos;re shown.
            </p>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Role</th>
                    <th>Sees which clients</th>
                    <th>Sidebar access</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><span className="badge accent">Admin</span></td>
                    <td>Every client in the organization, no restriction.</td>
                    <td>Everything: Dashboard, Co-pilot, Clients, Tasks, Journeys, Reports, Exceptions, all of Settings.</td>
                  </tr>
                  <tr>
                    <td><span className="badge accent">Manager</span></td>
                    <td>Their own assigned clients plus every direct report&apos;s clients (including a report who has since left/gone inactive — their historical clients stay visible).</td>
                    <td>Same as Admin except the four admin-only Settings pages (Stages, Templates, Users, Integrations) are hidden.</td>
                  </tr>
                  <tr>
                    <td><span className="badge accent">RM</span></td>
                    <td>Only clients assigned to them.</td>
                    <td>Dashboard, Co-pilot, Clients, Tasks, Settings, Help. No Journeys, Reports, Exceptions, or admin Settings.</td>
                  </tr>
                  <tr>
                    <td><span className="badge accent">Dealer</span></td>
                    <td>Only clients whose Dealer Handoff record is assigned to them.</td>
                    <td>Just three items: Dealer Desk, Settings, Help.</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="box role">
              <span className="box-label">Good to know</span>
              <p>
                If you try to open a page your role doesn&apos;t allow, you&apos;re redirected — Dealers land back on
                their Dealer Desk, everyone else lands on the Clients list. This isn&apos;t an error; it just means
                that page isn&apos;t part of your role.
              </p>
            </div>
          </section>

          <section className="module" id="dashboard">
            <div className="module-eyebrow">Daily work</div>
            <h2>Dashboard</h2>
            <p className="lede">Your personal landing page — what needs attention today, at a glance.</p>

            <h3>KPI strip</h3>
            <p>
              Eight tiles: Active Clients, New Today, Due Today, Overdue, KYC Pending, Funding Pending, Dealer Intro
              Pending, and Completed. These count only the clients you&apos;re allowed to see per your role.
            </p>

            <h3>My Day</h3>
            <p>
              Groups your clients into buckets that need attention: Overdue, Due Today, New Leads Not Contacted,
              Funding Pending, Dealer Intros Pending, and CRM Hygiene (active clients with no next action set). Each
              row links straight to the client.
            </p>

            <h3>Needs Manager Attention</h3>
            <p>
              <em>Managers and Admins only.</em> A live feed of clients across your team that are breaching SLA,
              overdue, or otherwise flagged — a lighter-weight preview of the full{" "}
              <a href="#exceptions">Exceptions queue</a>.
            </p>

            <h3>My Action Queue</h3>
            <p>
              Every pending or overdue task assigned to you, with due date, priority, and SLA status, so you
              don&apos;t need to open each client individually to know what&apos;s due.
            </p>
          </section>

          <section className="module" id="clients">
            <div className="module-eyebrow">Daily work</div>
            <h2>Clients</h2>
            <p className="lede">The master pipeline list — where every lead starts, and where you search, filter, and act in bulk.</p>

            <h3>Creating a client, step by step</h3>
            <ol>
              <li>Click <strong>New Client</strong> from the Clients list.</li>
              <li>Fill in <strong>Full Name</strong> and <strong>Mobile</strong> (both required).</li>
              <li>Enter a <strong>PAN</strong> — required, and validated against the standard format (e.g. <code>ABCDE1234F</code>) before you can submit.</li>
              <li>Optionally add Email, CKYC Reference, Region, Preferred Language, Lead Source, Client Type, Referral Source, and Notes. Region and Preferred Language directly feed auto-assignment (see below) — fill them in if you know them.</li>
              <li>Leave <strong>Assigned RM</strong> blank to let Supportify auto-assign the lead, or pick a specific RM yourself to skip that entirely.</li>
              <li>Submit. If a duplicate is detected, see the box below for what happens next.</li>
            </ol>

            <div className="box block">
              <span className="box-label">Hard block — no override</span>
              <p>
                A matching <strong>PAN</strong> or <strong>CKYC reference</strong> stops creation outright. You&apos;re
                shown a link to the existing record instead — PAN and CKYC are unique government identifiers, so two
                different people can never legitimately share one.
              </p>
            </div>
            <div className="box gate">
              <span className="box-label">Soft warning — you can proceed</span>
              <p>
                A matching <strong>mobile number or email</strong> only warns you, with a{" "}
                <strong>&quot;Create Anyway&quot;</strong> option — this can legitimately happen (a shared family
                number, a typo on an earlier record), so it&apos;s your judgment call.
              </p>
            </div>

            <h4>How auto-assignment picks an RM</h4>
            <p>When you leave Assigned RM blank, Supportify runs through these checks in order, on every active, available RM:</p>
            <ol>
              <li><strong>HNI eligibility</strong> — if the client type is HNI/U-HNI, or the expected investment is ₹1 crore or more, only RMs flagged as HNI-capable are considered.</li>
              <li><strong>Region &amp; language match</strong> — if the RM has any regions or languages tagged, the client&apos;s must be among them (an RM with nothing tagged is treated as having no constraint).</li>
              <li><strong>Capacity</strong> — the RM&apos;s current active client count must be under their configured capacity (defaults to 50 if unset).</li>
              <li><strong>Load balancing</strong> — among everyone left, the RM with the fewest active clients right now wins.</li>
            </ol>
            <p>If nobody clears every filter, the client is created <strong>unassigned</strong>, and every Manager and Admin gets a notification so it can be picked up manually.</p>

            <h3>The list page</h3>
            <p>Search by name, mobile, email, client ID, or KYC reference. Filter by Stage, Priority, SLA Status, Status, Assigned RM, KYC/Funding/Dealer status, Client Type, Lead Source, or a created-date range. Results page 25 at a time.</p>

            <h4>Bulk actions</h4>
            <ul>
              <li><strong>Bulk reassign</strong> (Admin/Manager) — select clients with the row checkboxes, choose a target RM, and reassign them all in one action.</li>
              <li><strong>Export CSV</strong> — downloads whatever the current filters show, capped at 5,000 rows.</li>
              <li><strong>Bulk Import</strong> (Admin/Manager) — upload a CSV to create up to 1,000 clients at once. Required columns: <code>name</code>, <code>mobile</code>, <code>pan</code>. Every optional field from manual creation is also accepted as a column. Every row goes through the exact same PAN/CKYC/mobile-email duplicate rules as creating one client by hand — rows are processed in order so a duplicate PAN <em>within the same file</em> is still caught. After upload you get a per-row result: created, duplicate, or failed — a bad row never blocks the rest of the file.</li>
            </ul>
          </section>

          <section className="module" id="client-360">
            <div className="module-eyebrow">Daily work</div>
            <h2>Client 360</h2>
            <p className="lede">Click into any client and this is their entire world — one page, six tabs, covering everything from first contact to dealer handoff.</p>

            <p>The header shows their name, client code, priority and status badges, and a compact tracker of where they sit across all five pipeline stages. Below it, three stat cards summarize Current Stage, Time in Stage, and SLA Status at a glance.</p>

            <h3>Overview</h3>
            <p>KYC / Funding / Dealer status chips you can click to jump straight to that tab, the Co-pilot panel (priority, health, next best action, cross-sell flags, milestone checklist — see the <a href="#copilot">Co-pilot</a> section), and the five most recent activities.</p>

            <h3>Onboarding — the step-by-step flow</h3>
            <ol>
              <li><strong>Log first contact.</strong> Record how you reached out and the outcome. If the outcome is &quot;Not interested,&quot; &quot;Unreachable,&quot; or &quot;Wrong number,&quot; a note is required. If it&apos;s &quot;Call back requested&quot; or &quot;Interested,&quot; a next action is required.</li>
              <li><strong>Start document collection.</strong> This seeds a fixed six-item checklist: PAN, Address Proof, Bank Proof, Photograph, and Signature (all mandatory), plus Income Proof (optional).</li>
              <li>
                <strong>Submit for KYC.</strong> This becomes available once documents are started.
                <div className="box gate">
                  <span className="box-label">Gate</span>
                  <p>Every mandatory document must be Verified (or marked Not Applicable) before you can submit — unless a Manager or Admin explicitly checks &quot;Override incomplete mandatory documents.&quot;</p>
                </div>
              </li>
              <li><strong>Record the KYC outcome.</strong> Approved, Rejected, or Additional Info Required, with a reference number and (if rejected) a required reason. Approval is what actually advances the client to the next stage — a rejection or info request keeps them right where they are and notifies the RM.</li>
            </ol>

            <h3>Activity</h3>
            <p>The full communication timeline (calls, messages, notes, stage changes) plus a panel to send a WhatsApp/SMS/email using an approved template, and a way to add a manual note.</p>

            <h3>Tasks</h3>
            <p>Every task tied to this specific client — see the <a href="#tasks">Tasks</a> section for how tasks work in general.</p>

            <h3>Funds &amp; Dealer</h3>
            <p>This tab shows two forms once the client has reached the relevant stage (or already has a record) — &quot;Not reached yet&quot; simply means the client hasn&apos;t gotten there in the pipeline yet.</p>
            <div className="box gate">
              <span className="box-label">Funding gate</span>
              <p>Marking funding as Partially or Fully Funded requires <strong>both</strong>: an amount of at least ₹5,000, <strong>and</strong> the &quot;Bank account penny-drop verified&quot; checkbox ticked.</p>
            </div>
            <p>The Dealer Introduction form records the Dealer Name (required to advance the stage), which Dealer account it&apos;s assigned to, introduction method, status, scheduled date, preferred trading segments, risk profile, and trading limits (max order value / max exposure). See <a href="#dealer-desk">Dealer Handoff Desk</a> for who can edit what here afterward.</p>

            <h3>Audit History</h3>
            <p>The full, structured before/after record of every change made to this client — the definitive compliance trail, distinct from the human-readable Activity tab.</p>
          </section>

          <section className="module" id="pipeline">
            <div className="module-eyebrow">Daily work</div>
            <h2>The onboarding pipeline</h2>
            <p className="lede">Every client moves through the same five fixed stages. Each has an SLA clock; missing it is what drives most of the Dashboard and Exceptions alerts elsewhere in this handbook.</p>

            <div className="tracker">
              <div className="tstep"><div className="tnode"><div className="tcircle">1</div><div className="tlabel">New Lead</div><div className="tsla">4h SLA</div></div></div>
              <div className="tline" />
              <div className="tstep"><div className="tnode"><div className="tcircle">2</div><div className="tlabel">Submitted for KYC</div><div className="tsla">24h SLA</div></div></div>
              <div className="tline" />
              <div className="tstep"><div className="tnode"><div className="tcircle">3</div><div className="tlabel">KYC completed</div><div className="tsla">72h SLA</div></div></div>
              <div className="tline" />
              <div className="tstep"><div className="tnode"><div className="tcircle">4</div><div className="tlabel">Pushed for funds</div><div className="tsla">120h SLA</div></div></div>
              <div className="tline" />
              <div className="tstep"><div className="tnode"><div className="tcircle">5</div><div className="tlabel">Introduction with Dealer</div><div className="tsla">48h SLA</div></div></div>
            </div>

            <p>There&apos;s no separate &quot;Completed&quot; stage — once KYC is Approved, funding qualifies, and the dealer introduction is Completed, the client&apos;s <em>status</em> flips to Completed automatically while they visually stay on stage 5.</p>

            <h3>SLA math, in plain terms</h3>
            <p>Each stage has a target number of hours. Once a client has spent that many hours in the stage, they&apos;re <strong>Overdue</strong>. At 75% of the target, they&apos;re <strong>Due Soon</strong>. Under that, they&apos;re <strong>On Track</strong>.</p>

            <h3>Holds and exceptions</h3>
            <p>Putting a client &quot;On Hold&quot; opens an exception and pauses their status. While an exception is open, that time <strong>doesn&apos;t count</strong> against the SLA clock — resuming picks the clock back up from where it left off, so a legitimately blocked client is never wrongly flagged as overdue.</p>

            <h3>Stage correction</h3>
            <p>Managers and Admins can move a client to any stage directly, bypassing the normal sequence — this always requires a reason, which is logged, and shows up in the Exceptions queue for visibility for the following 7 days.</p>
          </section>

          <section className="module" id="copilot">
            <div className="module-eyebrow">Daily work</div>
            <h2>Co-pilot</h2>
            <p className="lede">A prioritized worklist answering &quot;who needs my attention right now, and what should I do about it.&quot; The top of this page is the single best place to start your day.</p>

            <h3>The summary strip</h3>
            <p><strong>Critical</strong> and <strong>At Risk</strong> count clients by Health status (below). <strong>Disengaged</strong> counts anyone with no activity in 5+ days, regardless of health. <strong>Cross-sell Candidates</strong> counts clients flagged for a product-fit opportunity.</p>

            <h3>Three different numbers — don&apos;t confuse them</h3>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Signal</th><th>Answers</th><th>What feeds it</th></tr></thead>
                <tbody>
                  <tr>
                    <td><strong>Health</strong></td>
                    <td>How urgent is this, overall?</td>
                    <td>SLA status, time in stage vs. the typical average, days since last activity. Escalates to Critical if the SLA is already breached, there&apos;s been no activity in 7+ days, or time-in-stage is more than double the norm.</td>
                  </tr>
                  <tr>
                    <td><strong>Priority score</strong></td>
                    <td>What should I work on next? <em>(this is what the worklist is sorted by)</em></td>
                    <td>An additive 0–100 score: SLA overdue/due-soon, overdue task count, the client&apos;s manually-set Priority, and days since last contact.</td>
                  </tr>
                  <tr>
                    <td><strong>Propensity score</strong></td>
                    <td>How likely is this lead to actually convert?</td>
                    <td>Lead source, engagement activity count, how complete their profile is, and expected investment size. <strong>Display only</strong> — it never changes sort order or the recommended action.</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h3>Next Best Action</h3>
            <p>A concrete, stage-aware recommendation — for example: <em>&quot;Make first contact&quot;</em> for an untouched new lead, <em>&quot;Submit for KYC&quot;</em> once documents are verified, <em>&quot;Resolve KYC rejection&quot;</em> after a rejected KYC record, <em>&quot;Follow up on funding&quot;</em> once KYC is done but funds haven&apos;t arrived, or <em>&quot;Schedule dealer introduction&quot;</em> once funded.</p>

            <h3>Quick actions</h3>
            <p><strong>Follow-up</strong> opens a pre-filled dialog to create a task due in 24 hours. <strong>Message</strong> (shown only when a matching approved template exists) jumps to the client&apos;s Activity tab with the right channel and template pre-selected — it doesn&apos;t send anything on its own.</p>
          </section>

          <section className="module" id="reports">
            <div className="module-eyebrow">Oversight</div>
            <h2>Reports</h2>
            <p className="lede">Pipeline analytics for management oversight — nine sections, each answering a different operational question.</p>

            <div className="table-wrap">
              <table>
                <thead><tr><th>Section</th><th>What it tells you</th></tr></thead>
                <tbody>
                  <tr><td>KPI tiles</td><td>Total Leads, Active Onboarding, Completed, Not Proceeding, On Hold, currently-Overdue, overall SLA Compliance %, and average onboarding time.</td></tr>
                  <tr><td>Stage Funnel</td><td>How many active clients sit in each stage right now.</td></tr>
                  <tr><td>Stage Aging</td><td>A heatmap of where clients are piling up, and for how long, per stage.</td></tr>
                  <tr><td>SLA Breach &amp; Overdue Summary</td><td>Overdue/due-soon counts broken down by stage and by RM, linking straight to Exceptions.</td></tr>
                  <tr><td>Stage Conversion</td><td>Of everyone who ever reached stage 1, what % made it to each later stage — a drop-off funnel.</td></tr>
                  <tr><td>Bottleneck Analysis</td><td>Average time spent per stage, flagging anything averaging over 72 hours.</td></tr>
                  <tr><td>Lost Reasons</td><td>Why clients marked Not Proceeding were lost, grouped by reason.</td></tr>
                  <tr><td>Source Performance</td><td>Conversion rate by lead source, ranked.</td></tr>
                  <tr><td>RM Performance</td><td>Per-RM: active load vs. capacity, completions, overdue tasks, their own SLA %, and average onboarding time.</td></tr>
                </tbody>
              </table>
            </div>
          </section>

          <section className="module" id="exceptions">
            <div className="module-eyebrow">Oversight</div>
            <h2>Exceptions queue</h2>
            <p className="lede">One list, for Managers and Admins, of every client that needs a decision — the single most useful page for a manager&apos;s daily sweep.</p>

            <div className="table-wrap">
              <table>
                <thead><tr><th>Category</th><th>Appears when&hellip;</th></tr></thead>
                <tbody>
                  <tr><td>SLA breach</td><td>A stage SLA is overdue, or funding has sat pending for 48+ hours after KYC completed.</td></tr>
                  <tr><td>High-priority overdue</td><td>A HIGH-priority client&apos;s SLA is due soon (and not already a straight breach).</td></tr>
                  <tr><td>KYC rejection</td><td>The KYC record is Rejected or needs Additional Info.</td></tr>
                  <tr><td>No next action</td><td>The client has no next-action text set at all.</td></tr>
                  <tr><td>Repeated failed contact</td><td>Two or more logged attempts came back Unreachable, Wrong Number, or Not Interested.</td></tr>
                  <tr><td>Unresolved exception</td><td>The client has an open hold/blocker that hasn&apos;t been resumed.</td></tr>
                  <tr><td>Stage corrected</td><td>A Manager/Admin manually corrected this client&apos;s stage in the last 7 days (visibility only, no approval needed).</td></tr>
                </tbody>
              </table>
            </div>
            <p>From each row you can reassign the client, create a follow-up task pre-filled with the recommended action, or open the client directly.</p>
          </section>

          <section className="module" id="tasks">
            <div className="module-eyebrow">Oversight</div>
            <h2>Tasks</h2>
            <p className="lede">Every to-do across your clients in one place.</p>
            <p>Most tasks are created automatically — by the stage engine, an SLA check, or a Journey — but you can also create one manually from a client&apos;s page or a Co-pilot &quot;Follow-up&quot; suggestion. Tasks move through <span className="badge">Pending</span> → <span className="badge">Overdue</span> (automatically, once past due) → <span className="badge">Done</span>, or can be <span className="badge">Cancelled</span>. &quot;Mark done&quot; on any row closes it out and logs the completion to that client&apos;s activity timeline.</p>
          </section>

          <section className="module" id="journeys">
            <div className="module-eyebrow">Automation</div>
            <h2>Journeys (workflow automation)</h2>
            <p className="lede">Build automations that run on their own — for Managers and Admins who want a repeatable process instead of manual follow-up.</p>

            <h3>Building one, step by step</h3>
            <ol>
              <li>From the Journeys list, click <strong>New Journey</strong> and name it. It starts with a single trigger node already on the canvas.</li>
              <li>Drag out Action, Condition, or Wait nodes from the sidebar onto the canvas.</li>
              <li>Connect nodes by dragging from one node&apos;s edge to the next.</li>
              <li>Click any node to configure it in the side panel.</li>
              <li><strong>Save</strong> to persist the graph, then <strong>Activate</strong> to turn it on.</li>
            </ol>

            <h4>Node types</h4>
            <ul>
              <li><strong>Trigger</strong> — Client Created, Stage Changed, Field Updated, Webhook Received, or Manual Enrollment.</li>
              <li><strong>Action</strong> — send a message or email, create a task, update client status, reassign the client, notify a manager, add a note, or call an external integration (Freshdesk, Exotel, Clevertap, ClickUp).</li>
              <li><strong>Condition</strong> — branches True/False by checking a field against a value (equals, contains, greater/less than, exists, before/after a date, etc.).</li>
              <li><strong>Wait</strong> — pauses for a fixed duration, or until a condition becomes true (with an optional timeout so it doesn&apos;t wait forever).</li>
            </ul>

            <div className="box gate">
              <span className="box-label">Editing lock</span>
              <p>You can&apos;t restructure a journey while any client is actively mid-flow inside it — deactivate it first, or wait for those runs to finish. The journey detail page tells you how many clients are currently enrolled.</p>
            </div>
          </section>

          <section className="module" id="dealer-desk">
            <div className="module-eyebrow">Automation</div>
            <h2>Dealer Handoff Desk</h2>
            <p className="lede">Where a completed lead gets handed to a trading Dealer — split cleanly between what the RM/Manager sets up and what the Dealer can touch afterward.</p>

            <div className="box role">
              <span className="box-label">RM / Manager side</span>
              <p>Configured entirely from the client&apos;s <a href="#client-360">Funds &amp; Dealer</a> tab: which Dealer account it&apos;s assigned to, preferred trading segments, risk profile, and trading limits (max order value, max exposure).</p>
            </div>
            <div className="box role">
              <span className="box-label">Dealer side</span>
              <p>A Dealer&apos;s own <strong>Dealer Desk</strong> shows every client handed to them — contact info, current stage, and their portfolio preference/limits as read-only. The only things a Dealer can change are the handoff <strong>Status</strong> and <strong>Remarks</strong>.</p>
            </div>
          </section>

          <section className="module" id="settings">
            <div className="module-eyebrow">Administration</div>
            <h2>Settings</h2>
            <p className="lede">Everything configurable, split across five pages — the first four are Admin-only.</p>

            <h3>Stages</h3>
            <p>The five stages themselves are fixed and can&apos;t be renamed or reordered — you can only tune each stage&apos;s SLA target (in hours) and toggle it active/inactive.</p>

            <h3>Templates</h3>
            <p>Create a WhatsApp/SMS message template with a name, channel, and body (supports <code>{"{{variable}}"}</code> placeholders). Only templates marked <strong>Approved</strong> are selectable when actually sending a message — WhatsApp templates additionally need pre-approval with the provider itself before they&apos;ll go live.</p>

            <h3>Users</h3>
            <p>Create accounts and set role, manager, and workload capacity. For RMs specifically, four extra fields feed the routing engine directly: Availability (Available / On Leave / Unavailable), Regions, Languages, and whether they handle HNI clients.</p>
            <div className="box gate">
              <span className="box-label">One-time password</span>
              <p>A new account&apos;s temporary password is generated and shown <strong>once</strong>, in the creation dialog — copy it immediately, since it can&apos;t be retrieved again afterward.</p>
            </div>
            <p>Marking an RM On Leave or Unavailable automatically reassigns their active clients to another eligible RM — or leaves them unassigned with a notification if nobody qualifies.</p>

            <h3>Apps &amp; Integrations</h3>
            <p>Connects Supportify to Freshdesk (ticketing), Exotel (calls), Clevertap (profile sync), ClickUp and Jira (two-way task sync), WhatsApp/SMS (messaging), and Resend (email). Every integration runs in <strong>Mock mode</strong> — behaving exactly like the live version but against fake data — until real credentials are added. The <strong>Webhook URLs</strong> card at the bottom lists the exact endpoint to hand each provider so their events flow back in.</p>

            <h3>Account</h3>
            <p>Your own profile (name, email), password change, and Appearance (Light / Dark / System theme, remembered per device).</p>
          </section>

          <section className="module" id="notifications">
            <div className="module-eyebrow">Administration</div>
            <h2>Notifications</h2>
            <p className="lede">The bell icon in the top bar — every alert type and exactly what triggers it.</p>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Notification</th><th>Trigger</th></tr></thead>
                <tbody>
                  <tr><td>New assignment</td><td>A client is assigned to you (creation, auto-assignment, or a manager alert when auto-assign failed).</td></tr>
                  <tr><td>Task overdue (+ escalation)</td><td>One of your tasks passed its due date; the escalation variant also alerts your manager.</td></tr>
                  <tr><td>Stage SLA breach (+ escalation)</td><td>A client&apos;s stage SLA is breached; the escalation variant also alerts the manager.</td></tr>
                  <tr><td>Document rejected</td><td>A KYC document is marked Rejected.</td></tr>
                  <tr><td>KYC update</td><td>KYC status set to Additional Info Required or Rejected.</td></tr>
                  <tr><td>Funding pending / escalation</td><td>Funding recorded as not-yet-qualifying; escalation fires once it&apos;s been 48+ hours since KYC completed.</td></tr>
                  <tr><td>Hold started / Client reopened</td><td>A client is put on hold, or a Manager/Admin reopens a closed/not-proceeding client.</td></tr>
                  <tr><td>Dealer intro pending</td><td>A dealer introduction is recorded as Pending or Scheduled (not yet Completed).</td></tr>
                  <tr><td>Excessive overdue workload</td><td>An RM has accumulated too many overdue tasks at once.</td></tr>
                  <tr><td>Journey notify manager</td><td>An automated Journey&apos;s &quot;notify manager&quot; action fired.</td></tr>
                  <tr><td>Client disengaged</td><td>No contact recorded with a client for an extended period.</td></tr>
                  <tr><td>External task status changed</td><td>A linked task&apos;s status changed on the external system (ClickUp/Jira).</td></tr>
                </tbody>
              </table>
            </div>
            <p>&quot;Mark all read&quot; clears the badge. While the app is open, new SLA breaches also surface as a live browser notification for RMs and Managers.</p>
          </section>

          <section className="module" id="command-palette">
            <div className="module-eyebrow">Administration</div>
            <h2>Command palette</h2>
            <p className="lede">The fastest way to get anywhere without touching the sidebar.</p>
            <p>Press <code>&#8984;K</code> (Mac) or <code>Ctrl+K</code> (Windows), or click the search bar in the top bar, from any page. Type a client&apos;s name, client code, or mobile number to jump straight to their record — results only ever include clients you&apos;re normally allowed to see. It also lists every page you have access to and a couple of quick actions (New Client, Toggle theme). Navigate with the arrow keys and Enter, or just click.</p>
          </section>

          <section className="module" id="faq">
            <div className="module-eyebrow">Reference</div>
            <h2>Frequently asked questions</h2>
            <p className="lede">The same questions people actually ask, grouped by area — kept in sync with the in-app Help page.</p>

            <div className="faq-group-title">Leads &amp; clients</div>
            <details className="faq"><summary>Why do I need a PAN to create a new client?</summary><p>PAN is the unique government ID Supportify uses to catch true duplicate leads before they&apos;re created — a matching PAN blocks creation outright rather than just warning you.</p></details>
            <details className="faq"><summary>A client shows &quot;PAN already belongs to an existing client&quot; — what do I do?</summary><p>Open the existing client from the link shown, or use &quot;Merge Duplicate&quot; from that client&apos;s Overview tab if it&apos;s genuinely a separate record that should be combined.</p></details>
            <details className="faq"><summary>What&apos;s the difference between the PAN/CKYC block and the mobile/email warning?</summary><p>PAN and CKYC are hard blocks with no override, because they&apos;re unique identifiers. Mobile/email matches can happen for innocent reasons, so you can review and &quot;Create Anyway.&quot;</p></details>
            <details className="faq"><summary>Why was a new client left unassigned?</summary><p>No RM satisfied every routing rule (available, right region/language, HNI-capable if needed, under capacity). Every Manager and Admin is notified so it can be assigned manually.</p></details>
            <details className="faq"><summary>Can I still pick the RM myself?</summary><p>Yes — the Assigned RM field on New Client is optional; picking someone there skips auto-assignment entirely.</p></details>
            <details className="faq"><summary>What happens to bad rows in a CSV bulk import?</summary><p>Each row is validated independently — an invalid PAN or a duplicate is skipped and reported as failed/duplicate, without stopping the rest of the file. Only successful rows count toward the 1,000-row cap.</p></details>

            <div className="faq-group-title">Onboarding pipeline</div>
            <details className="faq"><summary>What&apos;s the difference between &quot;Not Interested&quot; and &quot;Mark Not Proceeding&quot;?</summary><p>&quot;Not Interested&quot; is a contact outcome logged while recording an attempt. &quot;Mark Not Proceeding&quot; closes the client out of the active pipeline entirely, with a reason — use it once the lead is truly dead.</p></details>
            <details className="faq"><summary>Why is my Submit for KYC button disabled?</summary><p>One or more mandatory documents aren&apos;t yet Verified. The same check blocks submission until they&apos;re resolved, or a Manager/Admin overrides it.</p></details>
            <details className="faq"><summary>The Funds or Dealer Handoff tab says &quot;Not reached yet&quot; — why?</summary><p>Those tabs only show their form once the client has reached the relevant stage, or already has a record. Move the client forward in Onboarding first.</p></details>
            <details className="faq"><summary>What happens to a client&apos;s history when I merge a duplicate?</summary><p>All documents, tasks, activity, stage history, and exceptions move onto the surviving record. If both records already have their own KYC/Funding/Dealer record, the conflict is flagged for manual review rather than silently overwritten.</p></details>

            <div className="faq-group-title">Activities, notes &amp; audit history</div>
            <details className="faq"><summary>What&apos;s the difference between Activities, Notes, and Audit History?</summary><p>Activities is the full human-readable timeline. Notes is that same timeline filtered to manual notes only. Audit History is the raw, structured before/after record of every state change — the compliance trail.</p></details>
            <details className="faq"><summary>Can I filter the Activities tab?</summary><p>Yes — category chips above the timeline filter it instantly, and only show categories that actually have entries for that client.</p></details>

            <div className="faq-group-title">Journeys</div>
            <details className="faq"><summary>Why can&apos;t I edit a Journey?</summary><p>Editing locks while any client is actively mid-flow (Running or Waiting) in it — deactivate first, or wait for those runs to finish.</p></details>
            <details className="faq"><summary>What&apos;s the difference between a Condition and a Wait node?</summary><p>Condition branches the flow immediately based on a true/false check. Wait pauses the flow for a fixed time, or until a specific event, before continuing.</p></details>

            <div className="faq-group-title">Co-pilot &amp; reports</div>
            <details className="faq"><summary>What do the Health badges mean?</summary><p>They&apos;re computed from SLA status, time in the current stage, and days since last activity — Critical means several of those are already flagged at once.</p></details>
            <details className="faq"><summary>Does the SLA clock keep running while a client is on hold?</summary><p>No — time in an open exception is excluded from SLA and stage-age calculations, so a legitimately blocked client won&apos;t wrongly show as overdue.</p></details>
            <details className="faq"><summary>Is Propensity the same thing as Priority score?</summary><p>No. Priority is &quot;how urgent is this right now&quot; and drives the worklist&apos;s sort order. Propensity is &quot;how likely is this lead to convert&quot; — shown for context only, with no effect on sort order or the recommended action.</p></details>

            <div className="faq-group-title">Admin</div>
            <details className="faq"><summary>How do I approve a WhatsApp/SMS template?</summary><p>Create it in Settings &gt; Templates, then set its status to Approved. WhatsApp templates must also be pre-approved with your provider first.</p></details>
            <details className="faq"><summary>What does &quot;Mock mode&quot; mean for an integration?</summary><p>The integration behaves exactly like the real one — tasks sync, messages &quot;send&quot; — but talks to fake data instead of the live API. Safe until you add real credentials.</p></details>
            <details className="faq"><summary>Where do I find the webhook URL to give an integration provider?</summary><p>Settings &gt; Apps &amp; Integrations has a Webhook URLs card at the bottom listing the exact endpoint for each connected provider.</p></details>
            <details className="faq"><summary>Who can see what?</summary><p>See the <a href="#roles">Roles &amp; permissions</a> section above for the full breakdown.</p></details>
          </section>

          <section className="module" id="glossary">
            <div className="module-eyebrow">Reference</div>
            <h2>Glossary</h2>
            <p className="lede">Terms used throughout this handbook that aren&apos;t always self-explanatory outside the core team.</p>
            <dl className="glossary">
              <dt>PAN</dt><dd>Permanent Account Number — India&apos;s unique taxpayer ID; used here as the primary duplicate-detection key for a client.</dd>
              <dt>CKYC</dt><dd>Central KYC Registry reference — a shared, government-linked KYC record ID, also used as a hard duplicate check.</dd>
              <dt>KYC</dt><dd>Know Your Customer — the identity/compliance verification process every client goes through before they can be funded.</dd>
              <dt>HNI / U-HNI</dt><dd>High Net-Worth / Ultra-High Net-Worth Individual — a client type that requires an HNI-capable RM and factors into propensity scoring.</dd>
              <dt>SLA</dt><dd>Service Level Agreement — here, the target number of hours a client should spend in a given pipeline stage before being flagged overdue.</dd>
              <dt>NBA</dt><dd>Next Best Action — Co-pilot&apos;s stage-aware recommendation for what to do with a client next.</dd>
              <dt>RM</dt><dd>Relationship Manager — the role that owns day-to-day contact with a client.</dd>
              <dt>Dealer</dt><dd>The trading-execution role a completed client is handed off to; scoped only to their own assigned handoffs.</dd>
              <dt>Journey</dt><dd>Supportify&apos;s name for a configurable, visual workflow automation.</dd>
              <dt>Mock mode</dt><dd>An integration state where it behaves exactly like the live version but talks to fake data instead of a real external API.</dd>
            </dl>
          </section>

          <footer className="doc-footer">
            Supportify Handbook &middot; kept in sync with the in-app Help page &middot; for questions not covered here, ask in your team channel.
          </footer>
        </main>
      </div>
    </div>
  );
}
