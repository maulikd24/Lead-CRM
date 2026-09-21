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
            <div className="nav-group-label">Distribution OS</div>
            <a className="nav-link" href="#households">Households &amp; trading accounts</a>
            <a className="nav-link" href="#partner-home">Partner Home</a>
            <a className="nav-link" href="#management-console">Management Console</a>
            <a className="nav-link" href="#finance-console">Finance Console</a>
            <a className="nav-link" href="#earnings">Earnings Engine</a>
          </div>
          <div className="nav-group">
            <div className="nav-group-label">Wealth &amp; analytics</div>
            <a className="nav-link" href="#opportunities">Opportunities</a>
            <a className="nav-link" href="#wealth-workspace">Wealth Workspace</a>
            <a className="nav-link" href="#manager-dashboard">Manager Dashboard</a>
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
            <a className="nav-link" href="#debugger">Debugger</a>
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
              Everything else in this handbook depends on which of these nine roles you have — it decides both what
              you can see in the sidebar and which clients&apos;, partners&apos;, or payout data you&apos;re shown.
              The original four (Admin, Manager, RM, Dealer) work exactly as always; the five{" "}
              <strong>Distribution OS</strong> roles below (Team Manager, Partner, Affiliate, Distributor, Finance)
              are additive on top — see <a href="#households">Households</a>, <a href="#partner-home">Partner
              Home</a>, <a href="#management-console">Management Console</a>, and{" "}
              <a href="#finance-console">Finance Console</a> for what each one actually does day to day.
            </p>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Role</th>
                    <th>Sees which clients / partners</th>
                    <th>Sidebar access</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><span className="badge accent">Admin</span></td>
                    <td>Every client in the organization, no restriction.</td>
                    <td>Everything: Dashboard, Co-pilot, Clients, Tasks, Journeys, Reports, Exceptions, Households, Earnings, Finance Console, all of Settings.</td>
                  </tr>
                  <tr>
                    <td><span className="badge accent">Manager</span></td>
                    <td>Their own assigned clients plus every direct report&apos;s clients (including a report who has since left/gone inactive — their historical clients stay visible).</td>
                    <td>Same as Admin except the admin-only Settings pages (Stages, Templates, Users, Integrations, Approval Workflows, Data Privacy, Partner Directory) are hidden.</td>
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
                  <tr>
                    <td><span className="badge accent">Team Manager</span></td>
                    <td>Their own managed team&apos;s Users and Partners, via that team&apos;s Hierarchy Assignments — no client-row visibility of their own.</td>
                    <td>Management Console, Settings, Help, Release Notes.</td>
                  </tr>
                  <tr>
                    <td><span className="badge accent">Partner</span> / <span className="badge accent">Affiliate</span></td>
                    <td>No client visibility — only the clients they personally sourced (shown masked, see below) and their own commission/payout numbers.</td>
                    <td>Partner Home, Settings, Help, Release Notes.</td>
                  </tr>
                  <tr>
                    <td><span className="badge accent">Distributor</span></td>
                    <td>Same as Partner/Affiliate, plus their entire sub-partner network&apos;s referred clients and commission numbers.</td>
                    <td>Partner Home, Settings, Help, Release Notes.</td>
                  </tr>
                  <tr>
                    <td><span className="badge accent">Finance</span></td>
                    <td>No client-row visibility at all, by design — instead sees commission/payout data across every partner in the organization.</td>
                    <td>Finance Console, Earnings, Settings, Help, Release Notes.</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="box role">
              <span className="box-label">Good to know</span>
              <p>
                If you try to open a page your role doesn&apos;t allow, you&apos;re redirected to your own role&apos;s
                home page — Dealers to their Dealer Desk, Partner-family roles to Partner Home, Team Manager to
                Management Console, Finance to Finance Console, everyone else to the Clients list. This isn&apos;t an
                error; it just means that page isn&apos;t part of your role.
              </p>
            </div>
            <div className="box role">
              <span className="box-label">Field masking</span>
              <p>
                On Partner Home&apos;s Referred Clients panel, a Partner sees a client&apos;s PAN masked
                (e.g. <code>AB••••••4F</code>); an Affiliate additionally sees mobile and email masked. Masking is
                silent, but every time a role that&apos;s allowed to see a sensitive field actually views it
                unmasked, that view is logged — see <a href="#settings">Settings &gt; Data Privacy</a>.
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
              <li>Optionally enter a <strong>PAN</strong> — not required at this step, but validated against the standard format (e.g. <code>ABCDE1234F</code>) if you do enter one.</li>
              <li>Optionally add Email, CKYC Reference, Region, Preferred Language, Lead Source, Client Type, and Notes. Region and Preferred Language directly feed auto-assignment (see below) — fill them in if you know them.</li>
              <li>Optionally pick a <strong>Referral Source</strong> from the fixed list of RM referral codes, or choose <strong>Other</strong> to type one in.</li>
              <li>Leave <strong>Assigned RM</strong> blank to let Supportify auto-assign the lead, or pick a specific RM yourself to skip that entirely.</li>
              <li>Submit. If a duplicate is detected, see the box below for what happens next.</li>
            </ol>

            <div className="box block">
              <span className="box-label">Hard block — no override</span>
              <p>
                A matching <strong>PAN</strong>, <strong>CKYC reference</strong>, or <strong>mobile number</strong>{" "}
                stops creation outright. You&apos;re shown a link to the existing record instead — these are treated
                as unique identifiers, so two different people can never legitimately share one.
              </p>
            </div>
            <div className="box gate">
              <span className="box-label">Soft warning — you can proceed</span>
              <p>
                A matching <strong>email</strong> only warns you, with a <strong>&quot;Create Anyway&quot;</strong>{" "}
                option — this can legitimately happen (a shared family inbox, a typo on an earlier record), so
                it&apos;s your judgment call.
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
              <li><strong>Put On Hold</strong> (Admin/Manager) / <strong>Mark Not Proceeding</strong> — apply either outcome to every selected client in one action, with the same reason prompt as doing it one at a time.</li>
              <li><strong>Merge</strong> (RM, Manager, Admin) — select two or more clients and merge them into one surviving record; see <a href="#client-360">Client 360</a> for what happens to their history.</li>
              <li><strong>Export CSV</strong> — downloads whatever the current filters show, capped at 5,000 rows.</li>
              <li><strong>Export Selected</strong> — downloads only the checked rows instead of the full filtered list.</li>
              <li><strong>Bulk Import</strong> (Admin/Manager) — upload a CSV to create up to 1,000 clients at once. Required columns: <code>name</code>, <code>mobile</code>. Every optional field from manual creation — including <code>pan</code> — is also accepted as a column. Every row goes through the exact same PAN/CKYC/mobile/email duplicate rules as creating one client by hand — rows are processed in order so a duplicate PAN <em>within the same file</em> is still caught. After upload you get a per-row result: created, duplicate, or failed — a bad row never blocks the rest of the file.</li>
              <li><strong>Bulk Edit</strong> (Admin/Manager) — update Priority, Region, City, State, Preferred Language, Client Type, Lead Source, Referral Source, Product Interest, Existing Broker, and/or Trading Experience across every selected client at once. Leave a field blank in the dialog and it&apos;s left untouched on every client — only the fields you actually fill in get applied.</li>
              <li><strong>Add Note</strong> — log one note to every selected client&apos;s Activity timeline at once. Available to any role, same as adding a note to a single client.</li>
            </ul>
          </section>

          <section className="module" id="client-360">
            <div className="module-eyebrow">Daily work</div>
            <h2>Client 360</h2>
            <p className="lede">Click into any client and this is their entire world — one page, six tabs, covering everything from first contact to dealer handoff.</p>

            <p>The header shows their name, client code, priority and status badges, and a compact tracker of where they sit across all five pipeline stages. Below it, three stat cards summarize Current Stage, Time in Stage, and SLA Status at a glance.</p>

            <h3>Overview</h3>
            <p>
              A full read-only <strong>Client Details</strong> card sits at the top of this tab — PAN, CKYC
              reference, region, preferred language, city, state, lead source, client type, product interest,
              existing broker, trading experience, expected investment, referral source, notes, and operating
              instruction — so you can see everything about a client the moment you click their name, without
              opening Edit. Below that: KYC / Funding / Dealer status chips you can click to jump straight to
              that tab, the Co-pilot panel (priority, health, next best action, cross-sell flags, milestone
              checklist — see the <a href="#copilot">Co-pilot</a> section), and the five most recent activities.
            </p>

            <h3>Editing, archiving &amp; merging</h3>
            <p>
              <strong>Edit</strong> (top-right of the client header) lets anyone update any field on any client
              they can see — there&apos;s no field-level restriction. <strong>Archive</strong> (Admin only) soft-deletes
              the client: it disappears from the active Clients list and CSV export but is never physically
              removed, and can be restored from the same Actions panel at any time.
            </p>
            <p>
              <strong>Merge Duplicate</strong> combines two records that turned out to be the same person — available
              to RM, Manager, and Admin. Start it from a client&apos;s Overview tab, or select several clients on the
              Clients list and merge them in one action. Every document, task, activity, stage history entry,
              exception, trading account, and revenue history record moves onto the surviving record; if both
              records already have their own KYC/Funding/Dealer record, that conflict is flagged for manual review
              rather than silently overwritten.
            </p>
            <p>
              <strong>Request Permanent Deletion</strong> (Admin/Finance, requires a reason) sits next to Archive
              for a client with no financial history — it goes through the same maker-checker Approval Workflow
              as everything else sensitive (a <em>different</em> Admin must approve it), and only actually removes
              the client (Admin-only, type-the-client&apos;s-name-to-confirm) once approved. It&apos;s refused
              outright for a client with any trading account, household membership, revenue history, or advisory
              record on file — those must use Archive instead, since that history can never be discarded. A
              permanent record of who was deleted, when, and why survives in Audit History even after the client
              itself is gone.
            </p>

            <h3>Onboarding — the step-by-step flow</h3>
            <ol>
              <li><strong>Log first contact.</strong> Record how you reached out and the outcome. If the outcome is &quot;Not interested,&quot; &quot;Unreachable,&quot; or &quot;Wrong number,&quot; a note is required. If it&apos;s &quot;Call back requested&quot; or &quot;Interested,&quot; a next action is required.</li>
              <li><strong>Start document collection.</strong> This seeds a fixed six-item checklist: PAN, Address Proof, Bank Proof, Photograph, and Signature (all mandatory), plus Income Proof (optional). A <strong>Verify All</strong> action marks every pending document Verified in one click once you&apos;ve checked them.</li>
              <li>
                <strong>Submit for KYC.</strong> This becomes available once documents are started.
                <div className="box gate">
                  <span className="box-label">Gate</span>
                  <p>Every mandatory document must be Verified (or marked Not Applicable) before you can submit — unless a Manager or Admin explicitly checks &quot;Override incomplete mandatory documents.&quot; If the client has joint holders, this checks every holder&apos;s documents, not just the first holder&apos;s.</p>
                </div>
              </li>
              <li><strong>Record the KYC outcome.</strong> Approved, Rejected, or Additional Info Required, with a reference number and (if rejected) a required reason. Approval is what actually advances the client to the next stage — a rejection or info request keeps them right where they are and notifies the RM.</li>
            </ol>

            <h3>Joint account holding</h3>
            <p>
              A client can have a Second and/or Third holder, added from the Onboarding tab&apos;s Holders panel — each
              with their own name, PAN, CKYC reference, and document checklist. Set an <strong>Operating Instruction</strong>{" "}
              for how the account is operated: <strong>Jointly</strong>, <strong>Either or Survivor</strong> (only
              valid with exactly 2 total holders), or <strong>Anyone or Survivor</strong> (valid with 2 or 3 total
              holders). Removing a holder keeps their history — it&apos;s hidden, not deleted.
            </p>
            <div className="box gate">
              <span className="box-label">Locked once trading is live</span>
              <p>Once a client has an active Trading Account, holders can no longer be added, edited, or removed — the panel shows an explanatory note instead of the controls. Contact Ops for an account-level change at that point.</p>
            </div>

            <h3>Activity</h3>
            <p>The full communication timeline (calls, messages, notes, stage changes) plus a panel to send a WhatsApp/SMS/email using an approved template, and a way to add a manual note. Logging a note now also marks all of that client&apos;s open Tasks as Done — the same way completing a Task already logs a note, just the other direction.</p>

            <h3>Tasks</h3>
            <p>Every task tied to this specific client — see the <a href="#tasks">Tasks</a> section for how tasks work in general.</p>

            <h3>Funds &amp; Dealer</h3>
            <p>This tab shows two forms once the client has reached the relevant stage (or already has a record) — &quot;Not reached yet&quot; simply means the client hasn&apos;t gotten there in the pipeline yet.</p>
            <div className="box gate">
              <span className="box-label">Funding gate</span>
              <p>Marking funding as Partially or Fully Funded requires <strong>both</strong>: an amount of at least ₹5,000, <strong>and</strong> the &quot;Bank account penny-drop verified&quot; checkbox ticked.</p>
            </div>
            <p>The Dealer Introduction form records the Dealer Name (required to advance the stage), which Dealer account it&apos;s assigned to, introduction method, status, scheduled date, preferred trading segments, risk profile, and trading limits (max order value / max exposure). See <a href="#dealer-desk">Dealer Handoff Desk</a> for who can edit what here afterward. Once a Dealer Name is on file, a &quot;Mark Onboarding Completed&quot; button appears below this form — see <a href="#pipeline">The onboarding pipeline</a> for what that does.</p>

            <h3>Audit History</h3>
            <p>The full, structured before/after record of every change made to this client — the definitive compliance trail, distinct from the human-readable Activity tab.</p>
          </section>

          <section className="module" id="pipeline">
            <div className="module-eyebrow">Daily work</div>
            <h2>The onboarding pipeline</h2>
            <p className="lede">Every client moves through the same six fixed stages. The first five have an SLA clock; missing it is what drives most of the Dashboard and Exceptions alerts elsewhere in this handbook.</p>

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
              <div className="tline" />
              <div className="tstep"><div className="tnode"><div className="tcircle">6</div><div className="tlabel">Onboarding Completed</div><div className="tsla">No SLA</div></div></div>
            </div>

            <p>&quot;Onboarding Completed&quot; is reached by an explicit RM action, not automatically: once KYC is
            Approved, funding qualifies, and a Dealer Name is on file, a &quot;Mark Onboarding Completed&quot; button
            appears on the Funds &amp; Dealer tab. Clicking it re-checks all three conditions server-side and, if
            they hold, advances the client onto stage 6 and flips their <em>status</em> to Completed in the same
            step — there&apos;s no longer a silent, invisible completion path.</p>

            <h3>SLA math, in plain terms</h3>
            <p>Each stage has a target number of hours. Once a client has spent that many hours in the stage, they&apos;re <strong>Overdue</strong>. At 75% of the target, they&apos;re <strong>Due Soon</strong>. Under that, they&apos;re <strong>On Track</strong>.</p>

            <h3>Holds and exceptions</h3>
            <p>Putting a client &quot;On Hold&quot; opens an exception and pauses their status. While an exception is open, that time <strong>doesn&apos;t count</strong> against the SLA clock — resuming picks the clock back up from where it left off, so a legitimately blocked client is never wrongly flagged as overdue. Putting a client on hold is Manager/Admin only, so an RM can&apos;t pause their own SLA measurement — anyone can still resume a held client.</p>

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

          <section className="module" id="households">
            <div className="module-eyebrow">Distribution OS</div>
            <h2>Households &amp; trading accounts</h2>
            <p className="lede">
              The Client &amp; Product 360 layer — groups existing Clients into a family Household and gives each
              one a real brokerage/demat account with holdings and transactions, separate from the onboarding
              pipeline above.
            </p>

            <h3>Households</h3>
            <p>
              A Household groups two or more existing Clients (e.g. a family) so their combined portfolio can be
              seen in one place. Create one from the Households list, then add members by searching your visible
              clients — the same visibility scoping as everywhere else in the app.
            </p>

            <h3>Trading Accounts</h3>
            <p>
              A Trading Account is the actual brokerage/demat account — deliberately not called just
              &quot;Account&quot; to avoid confusion with a client&apos;s existing Second/Third{" "}
              <a href="#client-360">joint holder</a>, which is an unrelated concept. Each has an account number,
              type (Equity, Mutual Fund, PMS, etc.), and optionally a sourcing partner for commission attribution.
            </p>

            <h3>Holdings &amp; Transactions</h3>
            <p>
              The Household 360 page has Holdings and Transactions tabs, populated either by CSV import (same
              per-row created/updated/failed pattern as the Clients Bulk Import) or, for transactions with a
              brokerage amount, automatically feeding the <a href="#earnings">Earnings Engine</a>.
            </p>
            <div className="box gate">
              <span className="box-label">AUM is always the latest snapshot</span>
              <p>
                A holding&apos;s value shown anywhere — the Household list or its detail page — is always its{" "}
                <strong>most recent</strong> as-of-date snapshot, never a sum across every historical import. Both
                pages compute this the exact same way so they can never disagree.
              </p>
            </div>
          </section>

          <section className="module" id="partner-home">
            <div className="module-eyebrow">Distribution OS</div>
            <h2>Partner Home</h2>
            <p className="lede">
              What a Partner, Affiliate, or Distributor sees when they sign in — their own profile, the clients
              they&apos;ve referred, and their own earnings, and nothing else.
            </p>

            <h3>Profile card</h3>
            <p>Partner code, type, tier (Bronze/Silver/Gold/Platinum), and empanelment status.</p>

            <h3>Referred Clients</h3>
            <p>
              Every client sourced through a Trading Account tagged with this partner&apos;s ID, with PAN (and for
              Affiliates, mobile and email too) masked — see the <a href="#roles">field masking</a> note above.
              A Distributor also sees every client referred by their sub-partner network.
            </p>

            <h3>Earnings</h3>
            <p>
              A read-only summary: how much is estimated but not yet in a payout run, and a list of every payout
              run they&apos;ve been included in with its status. See <a href="#earnings">Earnings Engine</a> for
              what those statuses mean.
            </p>
          </section>

          <section className="module" id="management-console">
            <div className="module-eyebrow">Distribution OS</div>
            <h2>Management Console</h2>
            <p className="lede">A Team Manager&apos;s roster view of the Users and Partners in their managed team.</p>
            <p>
              Lists every team member and partner in scope, each partner tagged with their lifetime commission
              accrued. There&apos;s no separate client pipeline here — a Team Manager oversees people, not clients
              directly.
            </p>
          </section>

          <section className="module" id="finance-console">
            <div className="module-eyebrow">Distribution OS</div>
            <h2>Finance Console</h2>
            <p className="lede">Where Finance (and Admin) review approvals and reconcile payouts against the real external finance system.</p>

            <h3>Revenue Reconciliation</h3>
            <p>
              Every payout that&apos;s been Approved but not yet confirmed as actually paid shows here. &quot;Mark
              Reconciled&quot; records an external payout reference once Allvest&apos;s own finance/payroll system
              confirms it.
            </p>
            <div className="box block">
              <span className="box-label">This app never moves money</span>
              <p>
                Supportify&apos;s Earnings Engine is an internal estimation and reporting tool. It computes what a
                partner is owed and tracks whether it&apos;s been reconciled — the real transfer always happens
                outside this system, in Allvest&apos;s existing finance tools.
              </p>
            </div>

            <h3>Approval Workflows</h3>
            <p>
              The same pending-approvals queue as <a href="#settings">Settings &gt; Approval Workflows</a>,
              embedded here for convenience — Finance can review it, but only an Admin can actually approve or
              reject.
            </p>
          </section>

          <section className="module" id="earnings">
            <div className="module-eyebrow">Distribution OS</div>
            <h2>Earnings Engine</h2>
            <p className="lede">
              How a partner&apos;s commission gets computed and paid out — a fully traceable, immutable ledger from
              raw revenue all the way to a finalized payout.
            </p>

            <h3>Getting revenue in</h3>
            <p>
              <strong>Sync Revenue from Transactions</strong> pulls brokerage amounts already recorded on
              Household trading-account transactions automatically. <strong>Import Revenue (CSV)</strong> covers
              revenue types with no linked transaction — trail commission, upfront commission, AMC payouts,
              advisory fees.
            </p>

            <h3>Computing accruals</h3>
            <p>
              <strong>Recompute Accruals</strong> matches each piece of revenue against the sourcing partner&apos;s
              active Commission Plan and rule, and computes what they&apos;re owed. Revenue with no sourcing
              partner, or a partner with no active plan, simply produces no accrual — that&apos;s expected, not an
              error.
            </p>

            <h3>Payout Runs, step by step</h3>
            <ol>
              <li><strong>Create Payout Run</strong> for a date range — this groups every not-yet-paid-out accrual in that period into one payout per partner. A run still in Draft can be freely rebuilt.</li>
              <li><strong>Submit for Approval</strong> — this does not pay anyone; it creates a request in the Approval Workflows queue.</li>
              <li>An <strong>Admin</strong> (who did not submit the request) approves or rejects it from Settings &gt; Approval Workflows or the Finance Console.</li>
              <li>Once approved, <strong>Finalize</strong> closes the period out — no further approval needed, since the financial decision already happened at the approval step.</li>
            </ol>
            <div className="box gate">
              <span className="box-label">Maker-checker, always</span>
              <p>
                Submitting a Payout Run for approval, and any manual <strong>Adjustment</strong> (a clawback or
                correction to a specific partner&apos;s payout), both require a different Admin to approve them —
                you can never approve your own request.
              </p>
            </div>
          </section>

          <section className="module" id="opportunities">
            <div className="module-eyebrow">Wealth &amp; analytics</div>
            <h2>Opportunities</h2>
            <p className="lede">
              A separate, post-onboarding pipeline for tracking a client&apos;s interest in specific investment
              products — once a client is Active or Completed in onboarding, an &quot;Opportunities&quot; tab
              appears on their Client 360 page.
            </p>

            <h3>Adding one</h3>
            <p>
              Click <strong>Add Opportunity</strong>, pick a product (Mutual Fund, Broking, PMS, AIF, Bonds,
              Fixed Income, Unlisted/Pre-IPO, or Other), an estimated value, and an owner. It starts at{" "}
              <strong>Identified</strong>.
            </p>

            <h3>Moving it forward</h3>
            <p>
              Use the stage dropdown on each opportunity&apos;s card to move it through Discussed, Interested,
              Recommendation, Decision Pending, Committed, Funded, and Invested — in any order, not strictly
              sequential like onboarding. Moving one to <strong>Lost/Deferred</strong> is available from any
              stage, but always asks for a reason first.
            </p>
            <p>
              The tab shows a running <strong>open pipeline value</strong> — the total estimated value of
              everything still active (Lost/Deferred and already-Invested opportunities don&apos;t count toward
              it).
            </p>
          </section>

          <section className="module" id="wealth-workspace">
            <div className="module-eyebrow">Wealth &amp; analytics</div>
            <h2>Wealth Workspace</h2>
            <p className="lede">
              The &quot;Wealth&quot; tab on Client 360 (same Active/Completed gate as Opportunities) — a
              client&apos;s portfolio, analytics, and two advisory workflows, all in one place.
            </p>

            <h3>Portfolio Holdings &amp; Analytics</h3>
            <p>
              Shows the client&apos;s Trading Account holdings (same latest-snapshot AUM rule as Households, so
              it never double-counts an old import), an asset allocation breakdown by category, a
              concentration-risk badge, a flag if the same product is held across more than one account, and a
              check of whether the portfolio&apos;s growth/defensive mix lines up with the client&apos;s risk
              profile from Smart Allvest below.
            </p>

            <h3>Wealth Health Checkup</h3>
            <p>Track a health-checkup engagement for the client: status (Not Started/In Progress/Completed), a report link, and key findings.</p>

            <h3>Smart Allvest Profile</h3>
            <p>Record the client&apos;s investor risk profile (Conservative/Moderate/Aggressive), investment horizon, liquidity requirement, and goals — this is what the Portfolio Analytics risk-alignment check compares against.</p>

            <div className="box gate">
              <span className="box-label">A starting model, not a compliance ruling</span>
              <p>The concentration-risk and risk-alignment checks use straightforward, documented thresholds — they&apos;re a useful first read, not a substitute for an advisor&apos;s judgment.</p>
            </div>
          </section>

          <section className="module" id="manager-dashboard">
            <div className="module-eyebrow">Wealth &amp; analytics</div>
            <h2>Manager Dashboard</h2>
            <p className="lede">
              One page for Admins and Managers combining organization KPIs, lead trends, team performance, and
              the onboarding pipeline — everything the earlier Executive Dashboard showed, and more, now in one
              place.
            </p>

            <h3>What&apos;s on it</h3>
            <p>
              Org/team KPI tiles and the Leads Activity trend chart at the top; a date-range picker; a{" "}
              <strong>Team Performance</strong> table (Active/Completed/On-Hold/SLA % as of now, plus Leads
              Assigned/Contacted/Meetings/Follow-ups/KYC/Funds Received/Investments for the selected date range,
              per RM); a second <strong>RM Performance</strong> table (Active/Completed/Overdue Tasks/SLA %/Avg
              Onboarding Days/Capacity — the same table Reports itself shows); and a{" "}
              <strong>Pipeline View</strong> of client counts per onboarding stage.
            </p>
            <p>Click any stage in Pipeline View (including &quot;Lost&quot;) to open the exact filtered client list behind it, same as the Stage Funnel chart on Reports. A <strong>Download PDF</strong> button exports everything above for whatever date range is currently selected.</p>
          </section>

          <section className="module" id="reports">
            <div className="module-eyebrow">Oversight</div>
            <h2>Reports</h2>
            <p className="lede">Pipeline analytics for management oversight — ten sections, each answering a different operational question.</p>

            <div className="table-wrap">
              <table>
                <thead><tr><th>Section</th><th>What it tells you</th></tr></thead>
                <tbody>
                  <tr><td>KPI tiles</td><td>Total Leads, Active Onboarding, Completed, Not Proceeding, On Hold, currently-Overdue, overall SLA Compliance %, and average onboarding time.</td></tr>
                  <tr><td>Leads Activity</td><td>How many leads were created and updated over a period you choose (Daily, Weekly, Monthly, Quarterly, Yearly, or a custom date range), with a CSV download of the same data.</td></tr>
                  <tr><td>Stage Funnel</td><td>How many active clients sit in each stage right now, plus a &quot;Lost&quot; bucket for clients marked Not Proceeding. Click any bar (Lost included) to see the exact clients behind that number.</td></tr>
                  <tr><td>Stage Aging</td><td>A heatmap of where clients are piling up, and for how long, per stage.</td></tr>
                  <tr><td>SLA Breach &amp; Overdue Summary</td><td>Overdue/due-soon counts broken down by stage and by RM, linking straight to Exceptions.</td></tr>
                  <tr><td>Stage Conversion</td><td>Of everyone who ever reached stage 1, what % made it to each later stage — a drop-off funnel.</td></tr>
                  <tr><td>Bottleneck Analysis</td><td>Average time spent per stage, flagging anything averaging over 72 hours.</td></tr>
                  <tr><td>Lost Reasons</td><td>Why clients marked Not Proceeding were lost, grouped by reason.</td></tr>
                  <tr><td>Source Performance</td><td>Conversion rate by lead source, ranked.</td></tr>
                  <tr><td>RM Performance</td><td>Per-RM: active load vs. capacity, completions, overdue tasks, their own SLA %, and average onboarding time. Click any RM&apos;s name to open their full performance page, with the same KPIs, their assigned-clients list, their own Leads Activity trend, a personal Daily Report (below), and a 4-pillar Activity/Journey/Business/Relationship-Quality breakdown for a date range you choose.</td></tr>
                </tbody>
              </table>
            </div>

            <h3>Daily, weekly &amp; monthly email digests</h3>
            <p>
              A summary of that day&apos;s leads created/updated — plus stage-funnel movement, the highest-value
              open Opportunities, and the open Exceptions count — is emailed once at 9 PM IST to a single
              recipient your Admin configures outside the app. The same recipient also gets a coarser
              <strong> weekly</strong> summary every Monday and a <strong>monthly</strong> one on the 1st of the
              month. Every active RM additionally gets their own personal <strong>Daily Report</strong> each
              evening (see below) alongside the org-wide one. All of these are plain emails, not in-app
              notifications, so none of them appear in the bell icon.
            </p>

            <h3>RM Daily Report</h3>
            <p>
              On each RM&apos;s performance page, a Daily Report card summarizes that RM&apos;s day: clients
              contacted, meetings completed, follow-ups completed, KYC/funding/investment progress, funds
              received, their highest-priority clients, current blockers, and tomorrow&apos;s scheduled
              priorities. Pick any past date to regenerate it for that day, or download it as a PDF. Fields that
              depend on Opportunity Management data not yet available for a given client show an explicit
              &quot;Available once Opportunity Management ships&quot;-style note rather than a fake zero.
            </p>
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
            <p>Most tasks are created automatically — by the stage engine, an SLA check, or a Journey — but you can also create one manually from a client&apos;s page or a Co-pilot &quot;Follow-up&quot; suggestion. Tasks move through <span className="badge">Pending</span> → <span className="badge">Overdue</span> (automatically, once past due) → <span className="badge">Done</span>, or can be <span className="badge">Cancelled</span>. &quot;Mark done&quot; on any row closes it out and logs the completion to that client&apos;s activity timeline. A task&apos;s due date can be rescheduled directly from the task, without needing to cancel and recreate it.</p>
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
              <p>A Dealer&apos;s own <strong>Dealer Desk</strong> shows every client handed to them — contact info, current stage, and their portfolio preference/limits as read-only. The only things a Dealer can change are the handoff <strong>Status</strong> and <strong>Remarks</strong> — updating either correctly moves the client onto &quot;Introduction with Dealer&quot; if the RM hasn&apos;t already, so recording progress from either side works the same way.</p>
            </div>
          </section>

          <section className="module" id="settings">
            <div className="module-eyebrow">Administration</div>
            <h2>Settings</h2>
            <p className="lede">Everything configurable, split across several pages — all but Account are Admin-only.</p>

            <h3>Stages</h3>
            <p>The six stages themselves are fixed and can&apos;t be renamed or reordered — you can only tune each stage&apos;s SLA target (in hours) and toggle it active/inactive.</p>

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

            <h3>Approval Workflows</h3>
            <p>
              The maker-checker queue for every sensitive action across the app — a Manager&apos;s stage correction,
              a Payout Run submission, a commission Adjustment, an erasure request. Shows who requested what and
              why; Approve or Reject with one click. The person who requested an action can never also decide it,
              even if they&apos;re an Admin.
            </p>

            <h3>Data Privacy</h3>
            <p>
              Three things in one place: which fields are masked for which roles (a reference table, not
              editable), a log of every time someone viewed a masked field unmasked, and Data Retention Policies
              plus the Erasure Request queue (an erasure always routes through Approval Workflows before anything
              is actually removed).
            </p>

            <h3>Partner Directory</h3>
            <p>Every Partner/Affiliate/Distributor, grouped by tier and empanelment status — read-only.</p>

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

          <section className="module" id="debugger">
            <div className="module-eyebrow">Administration</div>
            <h2>Debugger</h2>
            <p className="lede">Hit something broken? Report it without leaving the page — anyone can, regardless of role.</p>
            <p>
              Click the bug icon in the top bar, describe what happened, and submit — the page you were on is
              captured automatically. Every active Admin is notified immediately in their notification bell.
              Admins triage the resulting queue at <strong>Debugger</strong> in the sidebar (Admin only), adding
              resolution notes when they close one out.
            </p>
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
            <details className="faq"><summary>Do I need a PAN to create a new client?</summary><p>No — PAN is optional at creation, since a lead&apos;s PAN isn&apos;t always on hand yet. If you do enter one, it&apos;s format-checked and used as a hard duplicate-detection key: a matching PAN blocks creation outright rather than just warning you. The actual PAN card document is still mandatory later, before a client can be submitted for KYC.</p></details>
            <details className="faq"><summary>A client shows &quot;PAN already belongs to an existing client&quot; — what do I do?</summary><p>Open the existing client from the link shown, or use &quot;Merge Duplicate&quot; from that client&apos;s Overview tab if it&apos;s genuinely a separate record that should be combined.</p></details>
            <details className="faq"><summary>What&apos;s the difference between the PAN/CKYC/mobile block and the email warning?</summary><p>PAN, CKYC, and mobile number are hard blocks with no override, because they&apos;re treated as unique identifiers. An email match can happen for innocent reasons (a shared family inbox, a typo on an earlier record), so you can review and &quot;Create Anyway.&quot;</p></details>
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

            <div className="faq-group-title">Distribution OS</div>
            <details className="faq"><summary>What&apos;s the difference between Partner, Affiliate, and Distributor?</summary><p>Partner and Affiliate both refer clients and earn commission on them; Affiliate is a lighter-weight tier with tighter masking (mobile/email masked too, not just PAN). Distributor manages a network of sub-partners and sees that whole network&apos;s referred clients and commission — not just their own.</p></details>
            <details className="faq"><summary>Why can&apos;t I see a client&apos;s full PAN, mobile, or email on Partner Home?</summary><p>Field masking applies per role — see the <a href="#roles">Roles &amp; permissions</a> section. It&apos;s not a bug; a Partner-family role is never shown the full value of a sensitive field they don&apos;t need to operate.</p></details>
            <details className="faq"><summary>Why did my Payout Run submission just disappear instead of taking effect?</summary><p>It didn&apos;t disappear — submitting a run for approval creates a request in Approval Workflows. It only takes effect once a different Admin approves it.</p></details>
            <details className="faq"><summary>Does Supportify actually pay out commissions?</summary><p>No. The Earnings Engine estimates and reports commission owed and tracks reconciliation status — the real bank transfer always happens in Allvest&apos;s existing external finance system.</p></details>

            <div className="faq-group-title">Wealth &amp; analytics</div>
            <details className="faq"><summary>What&apos;s the difference between an Opportunity and the onboarding pipeline?</summary><p>Opportunities are a separate, post-onboarding layer for tracking product interest — a client keeps their onboarding stage and status regardless of what happens to any Opportunity attached to them.</p></details>
            <details className="faq"><summary>Why can&apos;t I edit a client&apos;s joint holders anymore?</summary><p>Once a client has an active Trading Account, holder changes lock — contact Ops for an account-level change instead.</p></details>
            <details className="faq"><summary>Why can&apos;t I put a client on hold anymore?</summary><p>Put On Hold is Manager/Admin only now, so an RM can&apos;t pause the SLA clock they&apos;re personally measured against. You can still resume a held client yourself.</p></details>
            <details className="faq"><summary>What happened to Executive Dashboard?</summary><p>It&apos;s been folded into Manager Dashboard — the same KPIs, RM performance table, and lead trend now live there alongside Manager Dashboard&apos;s own Team Performance and Pipeline View.</p></details>

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
              <dt>Second / Third Holder</dt><dd>Additional account holders on a joint client, each with their own name, PAN, CKYC reference, and document checklist.</dd>
              <dt>Operating Instruction</dt><dd>How a joint account is operated: Jointly, Either or Survivor (2 holders only), or Anyone or Survivor (2 or 3 holders).</dd>
              <dt>Household</dt><dd>A group of existing Clients (e.g. a family) whose Trading Accounts are viewed together for a combined portfolio picture.</dd>
              <dt>Trading Account</dt><dd>A brokerage/demat account — distinct from a joint-holder &quot;Second/Third Holder,&quot; which is about a client&apos;s KYC record, not a financial account.</dd>
              <dt>Revenue Event</dt><dd>A single raw piece of revenue (brokerage, trail commission, AMC payout, etc.) ingested into the Earnings Engine.</dd>
              <dt>Commission Accrual</dt><dd>What a specific partner is computed to be owed for one Revenue Event, based on their active Commission Plan.</dd>
              <dt>Payout Run</dt><dd>A batch of accruals for a date range, grouped into one payout per partner, that moves through Draft → Pending Approval → Approved → Finalized.</dd>
              <dt>Maker-checker</dt><dd>The rule that whoever requests a sensitive action (a stage correction, a payout run, an adjustment) can never also be the one who approves it.</dd>
              <dt>Partner / Affiliate / Distributor</dt><dd>The three Distribution OS partner roles — see <a href="#roles">Roles &amp; permissions</a> for exactly how they differ.</dd>
              <dt>Team Manager</dt><dd>Oversees a team of Users and Partners via the Management Console — no client-row visibility of their own.</dd>
              <dt>Opportunity</dt><dd>A tracked interest in a specific investment product for a client, moving through its own 9-stage pipeline separate from onboarding.</dd>
              <dt>Wealth Health Checkup</dt><dd>A tracked advisory engagement (status, report, key findings) on a client&apos;s Wealth tab.</dd>
              <dt>Smart Allvest Profile</dt><dd>A client&apos;s recorded investor risk profile, investment horizon, liquidity needs, and goals — used to check their portfolio&apos;s risk alignment.</dd>
              <dt>Concentration Risk</dt><dd>A badge (Diversified/Moderate/Concentrated) showing how spread out a client&apos;s portfolio is across asset categories.</dd>
              <dt>Manager Dashboard</dt><dd>The consolidated Admin/Manager page for KPIs, lead trends, team and RM performance, and the onboarding pipeline — replaced the earlier Executive Dashboard.</dd>
            </dl>
          </section>

          <footer className="doc-footer">
            Supportify Handbook &middot; kept in sync with the in-app Help page &middot; see the{" "}
            <Link href="/feature-specs">Feature Specifications</Link> for rule-by-rule detail and the{" "}
            <Link href="/release-notes">Release Notes</Link> for what changed and when &middot; for questions not
            covered here, ask in your team channel.
          </footer>
        </main>
      </div>
    </div>
  );
}
