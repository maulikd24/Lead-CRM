# CRM UX Re-architecture — Review & Revamp Plan

## Context
The CRM (Next.js 16 / React 19, shadcn on Base UI, Tailwind v4, lucide, sonner) feels bloated and unintuitive. Inputs from product:
- **Primary roles:** RM/advisor, Manager/Team manager, Admin/Ops/Finance/Marketing (partners secondary).
- **Struggling tasks:** onboarding to KYC, daily triage, find-and-act-on-a-client, pipeline/leads (you also ticked "Something else" with no detail — see Open items).
- **Scope:** full re-architecture. **Evidence:** anecdotal. **Output:** strategy document only, no code yet.

Status: proposal written on 2026-10-17. **Pass 1 built on 2026-10-20** (branch `ux/revamp`).

**Done in pass 1:**
- **Navigation.** The Service workspace is gone. Inbox and Agent drafts moved to Today › Respond, and Co-pilot moved to Today › Ask. Insights became **Team**, with a Quality group for calls, quality audit, support SLA and exceptions. Developer tools moved to Admin › Advanced, behind "More". Non-admin roles now see at most three workspaces.
- **Header.** A **+ New** action hub (`createActionsFor`, shared with Cmd+K) and a Help menu.
- **Keyboard shortcuts.** C, /, ?, G-sequences and a shortcuts overlay. The palette shows each page's shortcut.
- **Campaign Studio** (`/marketing/studio`). A four-step broadcast wizard that saves a `BROADCAST_DRAFT` approval. Approving records the decision; nothing is sent.
- **Visual system.** Redaction retired, so there are two type families. The rules are in [design-system.md](design-system.md).

**Pass 2 (branch `ux/lead-views`): Lead CRM hybrid view.**
- **One place.** `/clients` shows the same filters as a **List** or a **Board** (`?view=board`). `/pipeline` and `/leads` redirect there and left the sidebar; `G P` opens the board. The board hides the filters it cannot apply (stage, status, SLA) and keeps its quick filters (Mine, Hot, At risk).
- **Inline edits in the list:** priority, owner (by the reassign rules) and next follow-up (creates a task). Each saves on pick, rolls back with a toast if refused, and priority and owner offer Undo.
- **Density:** Comfortable or Compact, remembered per person in a cookie.
- **Saved views:** named filter sets per person (new `SavedView` table), up to 20, sanitized to known filter keys.

Not started: the Command Center, the affiliate refresh, the unified Work queue and the client record restructure.

---

## 1. Diagnosis (grounded in the code)

**What I found**
| Symptom | Evidence |
|---|---|
| Nav mirrors the org chart and feature list, not jobs | 7 rail spaces + Reference, ~71 items in `src/lib/nav-items.ts`. `roleSpace` overrides move the same item to different places per role (Referrals, Integrations, Activity Log) |
| Fragmented "what needs me" | At least 9 queues: Today, Tasks, Approvals, Complaints & promises, Inbox, Exceptions, Agent drafts, Goals at risk, Campaign anomalies. They are split across Today, Service and Insights |
| Overlapping insight surfaces | Manager Dashboard, Management Console, management-intelligence, Customer Intelligence, Agent Insights, Reports, Co-pilot |
| Client lifecycle split four ways | Leads, Clients, Pipeline and Opportunities are separate pages. `/clients/[id]` and `/clients/[id]/360` are two versions of one record |
| Overloaded client record | 10 tabs (`client-tabs.ts`), about 50 component files, `stage-action-card.tsx` at 846 lines, plus an actions panel, copilot panel, decision panel, journey card and duplicate hints, all competing |
| Dashboard does too much | `dashboard/page.tsx` stacks about 10 cards (schedule, overdue, trend, two attention blocks, RM performance, next best actions, AI summary, KPIs, funnel). Nothing is clearly the main thing |
| Tabs posing as pages | `/marketing?tab=creative`, `?tab=campaigns` and `?tab=impact` each appear as separate nav items |
| Dev and ops tools in the product nav | Debugger, Decision shadow report, Investigate an action, System overview, Go-live |
| Inconsistent primitives | 3 skeleton systems, 2 sheet components, 70 files with raw `<button>`, 32 with raw `<table>`, browser `confirm()`/`alert()` in marketing and planner, only 14 `loading.tsx` / 6 `error.tsx` for 85 pages, `EmptyState` in 33 files |
| Typography sprawl | 3 families (Inter, Sora, Redaction). The lime brand colour `#99CC00` is unreadable as text on white (`--primary-ink` exists but its use must be enforced) |

**Top anti-patterns:** feature-shaped IA, duplicated destinations, competing calls to action, no single "next step", modal and tab overload, and inconsistent feedback.

**IA and flow audit process (run before Phase 2):**
1. **Inventory.** Export `NAV_ITEMS` plus `src/lib/access/surfaces.ts` into a sheet: route, role, space, flag, owner. Mark each route as Keep, Merge, Demote or Retire.
2. **Usage baseline.** Add page-view and key-action events now (`product-tracking-skills` can design the plan). With only anecdotal evidence, 2–3 weeks of data is the minimum before cutting anything.
3. **Card sort and tree test** (Optimal Workshop or similar) with 5–8 users per primary role, using today's route labels.
4. **Task flow mapping** for the four core tasks. Count clicks, screens, decisions and dead ends, and record the current time on task.
5. **Heuristic pass** (Nielsen 10) on the top 10 routes by usage, scoring severity 0–4.

---

## 2. Target information architecture

**Principles:** organize by jobs, not modules; one home for each thing; at most 5 rail items per role; progressive disclosure (show the default view and reveal advanced options on demand); one primary action per screen; secondary actions go in a "More" menu.

**New spaces** (replacing Today, Customers, Growth, Service, Partners, Insights, Admin and Reference):
1. **Home.** One **Work queue** that combines tasks, approvals, inbox replies, complaints and promises, exceptions, agent drafts, goals at risk and duplicates to review. Items filter by type and are sorted by due date and urgency. Beside it sits a slim "My day" (schedule plus 3 KPIs). Every other dashboard card moves out.
2. **Clients.** One list with lifecycle segments (Leads, Onboarding, Active, Dormant). The Pipeline kanban becomes a view toggle on the same data, households become a grouping, and Opportunities live inside the record. `/360` merges into the record.
3. **Growth** (Marketing). One workspace with three tabs: Plan (planner, briefs), Run (campaigns, creative, journeys, autopilot, referrals) and Measure (attribution, impact, closed loop, leakage, anomalies).
4. **Team** (Managers). Performance and targets, quality (calls, quality audit, support SLA), reports and intelligence. This replaces the 7 overlapping insight pages. Co-pilot becomes a global Cmd+K / side panel rather than a destination.
5. **Partners** (partner, finance and team-manager roles): programme, payouts, statements and earnings.
- **Admin** moves to the avatar menu as a Settings area (People & access, Configure, Connect, Health). Developer tools (Debugger, decision shadow, investigate) go in an "Advanced" section under the admin flag.
- **Help** moves to a `?` menu in the top bar (Handbook, Release notes, Help, Feature specs).

**Rail per role:** RM: Home, Clients. Manager: Home, Clients, Team. Marketing: Home, Growth. Finance: Home, Partners. Admin: all, plus Settings. Partner: Home (partner-home) and Partners. Delete the `roleSpace` overrides, because an item should live in one place.

**Turning dense workflows into flows:**
- **Client record:** go from 10 tabs to 5: *Overview* (snapshot, one "Next step" card, timeline), *Onboarding* (shown only until the client is Active), *Money* (funding & dealer, wealth, opportunities, payments), *Activity* (activity, tasks, messages, support) and *Compliance* (consent, audit). The record header holds the stage chip and one primary button driven by stage (e.g. "Complete KYC", "Record funding"), and everything else goes under More. Split `stage-action-card.tsx` into a per-stage step model.
- **Onboarding wizard:** replace the large `new-client-dialog` (402 lines) with a full-page stepper: Identity & contact → Holders → KYC documents → Review & submit. Save drafts automatically, validate each step, and show gate blockers (`gate-blocker-list.tsx`, `use-gate-check.ts`) as a checklist instead of errors at submit.
- **Dashboards** follow the rule of 1 question, 3 numbers and 1 list. Detail sits behind "View all".

---

## 3. Visual hierarchy & design system

- **Type:** use 2 families, Inter for UI and Sora for display headings only, and drop Redaction. Use a fixed scale of 12, 14 (body), 16, 20, 24 and 32, and two weights (400/600).
- **Spacing:** 4px base, using only 4, 8, 12, 16, 24, 32 and 48. Cards use 16 or 24 internal padding. Sections are 32 apart.
- **Colour:** neutrals carry 90% of the UI. Lime appears only on primary buttons, active nav and focus rings. Brand text always uses `--primary-ink`. Status colours (success, warning, danger, info) are reserved for status and never decorate. Extend the existing `status-ink.test.ts` and `sidebar-contrast.test.ts` into a full WCAG AA token test.
- **Clutter:** each card earns its place with one question. Remove borders inside cards. Icons go on nav and actions only, not on every label. Counts appear in badges only when the number is something the user can act on.

**Interaction standards** (these become a lint or test, like the existing `density-conformance.test.ts`):
| Need | Pattern |
|---|---|
| Primary action | One `Button` (default variant) per view, top right or in the sticky action bar |
| Quick edit | Inline edit |
| Edit in context | `Sheet` (pick one: consolidate `ui/sheet` and `workspace/sheet`) |
| Blocking decision or confirm | `Dialog`. Never `confirm()`/`alert()` |
| Destructive but reversible | Act at once, then show a toast with Undo |
| Success / failure | sonner toast with a clear verb ("Client saved"). Errors show inline and name the field |
| Loading | A single skeleton system, with `loading.tsx` on every route |
| Empty | `EmptyState` with one CTA on every list |
| Error | `error.tsx` on every route group, with a retry |

---

## 4. Revamp roadmap

**Phase 1: Quick wins and baseline (about 2–3 weeks)**
- Instrument page views and core-task events, and record a baseline (time on task, completion, clicks).
- Nav cleanup with no route changes: remove the `?tab=` duplicate items, move dev tools under Advanced, move Help to the `?` menu, remove `roleSpace` overrides, cap the rail at 5 per role.
- Replace `confirm()`/`alert()`, add the missing `loading.tsx`, `error.tsx` and `EmptyState`, and settle on one skeleton system and one sheet.
- Strip the Today dashboard down to the Work queue, My day and 3 KPIs.
- Client record header: stage chip, one primary "Next step" action, and everything else under More.
- Type and colour token cleanup (drop Redaction, enforce `--primary-ink`).

**Phase 2: Structural re-engineering (about 6–10 weeks)**
1. A unified **Work queue** data model and page (aggregates existing sources; add no new tables if possible).
2. **Clients** made one list, with lifecycle segments and a kanban toggle. Leads and Pipeline routes redirect to it.
3. **Client record** restructured to 5 tabs, with `/360` merged in and `stage-action-card` decomposed.
4. **Onboarding wizard.**
5. **Team** workspace consolidation, with the old insight routes redirected. Co-pilot becomes a global panel.
6. **Growth** reorganized into Plan, Run and Measure. Settings moves to the avatar menu.
- Add 301 redirects for every retired route (and update `surfaces.ts` and the palette).

**Phase 3: Validation & iteration (ongoing)**
- Moderated usability tests at the end of each Phase 2 milestone, with 5 users per primary role, on the 4 core tasks. Measure completion, time on task, errors and SEQ, plus SUS each quarter.
- Repeat the tree test on the new IA, with a target of at least 80% first-click success.
- Roll each restructure out behind a flag (the `nav-flags.ts` system exists) to a pilot team, compare against the baseline, then expand.
- Hold a monthly UX review of analytics: unused routes are candidates for retirement, and rage-clicks or dead ends feed the backlog.

**Success metrics:** onboarding time to KYC submitted −40%; daily triage fully handled from Home; a client action takes 3 clicks or fewer from Home; nav items per RM drop from about 20 to under 10; SUS of 75 or more.

---

## Open items
- A fifth struggling task ("something else") was flagged but not yet named. Add it to the task-flow mapping when it is.
- Phase 2 order assumes RMs are the main daily users (Work queue, then Clients, then Record). Confirm or reorder after the Phase 1 baseline.


---

## Appendix A — Route disposition

Every UI route in `src/lib/access/surfaces.ts` (API routes excluded), mapped to its home in the target IA. **Keep** = stays as is · **Move** = same page, new location · **Merge** = folded into another surface (old URL redirects) · **Demote** = out of the rail, reachable from a menu or link · **Retire** = remove after the usage baseline confirms low use.

| Route | Today | Target | Disposition |
|---|---|---|---|
| `/dashboard` | Today | Home (Work queue + My day) | Keep, reduced to the queue, My day and 3 KPIs |
| `/tasks` | Today | Home → Work queue (filter: Tasks) | Merge |
| `/approvals` | Today | Home → Work queue (filter: Approvals) | Merge |
| `/service` | Today | Home → Work queue (filter: Complaints & promises) | Merge |
| `/inbox` | Service | Home → Work queue (filter: Replies); thread opens in the client record | Merge |
| `/exceptions` | Service | Home → Work queue (filter: Exceptions) | Merge |
| `/agents` | Insights | Home → Work queue (filter: Agent drafts) | Merge |
| `/clients/duplicates` | Customers | Home → Work queue item, plus a banner on Clients | Merge |
| `/dealer-desk` | Today (DEALER) | Home for DEALER | Keep |
| `/partner-home` | Today (partners) | Home for partner roles | Keep |
| `/management-console` | Today (TEAM_MANAGER) | Team | Merge |
| `/finance-console` | Today (FINANCE) | Home for FINANCE | Keep |
| `/clients` | Customers | Clients (segments: Leads, Onboarding, Active, Dormant) | Keep |
| `/leads` | Customers | Clients → Leads segment | Merge |
| `/pipeline` | Customers | Clients → Kanban view toggle | Merge |
| `/clients/[id]` | Customers | Client record (5 tabs) | Keep, restructured |
| `/clients/[id]/360` | Customers | Client record → Overview | Merge |
| `/households`, `/households/[id]` | Customers | Clients → Group by household | Merge |
| `/product-registry` | Customers | Settings → Configure (read-only view linked from the record) | Move |
| `/journeys`, `/journeys/[id]` | Customers | Growth → Run | Move |
| `/marketing` | Growth | Growth (Plan / Run / Measure tabs) | Keep, restructured |
| `/marketing/needs-attention` | Growth | Growth → Measure → Anomalies | Merge |
| `/marketing/approved-claims` | Growth | Growth → Run → Claims | Move |
| `/planner`, `/planner/new`, `/planner/[id]` | Growth | Growth → Plan | Move |
| `/autopilot` | Growth | Growth → Run | Move |
| `/closed-loop` | Growth | Growth → Measure | Merge |
| `/referrals` | Growth / Partners | Growth → Run (one home; no role override) | Move |
| `/settings/lead-leakage` | Growth | Growth → Measure | Move |
| `/creative-print/[briefId]` | — | Print view | Keep |
| `/quality-audit`, `/quality-audit/[id]` | Service | Team → Quality | Move |
| `/calls`, `/calls/[id]` | Service | Team → Quality (calls also on the client timeline) | Move |
| `/support` | Service | Team → Quality → Support SLA | Move |
| `/management-dashboard` | Insights | Team → Performance | Merge |
| `/management-intelligence` | (unlisted) | Team → Intelligence | Merge |
| `/intelligence` | Insights | Team → Intelligence | Merge |
| `/agents/insights` | Insights | Team → Intelligence | Merge |
| `/reports`, `/reports/rm/[id]` | Insights | Team → Reports | Move |
| `/settings/targets` | Insights | Team → Performance → Targets | Move |
| `/activity-log` | Admin / Insights | Settings → Health (managers: Team → Reports) | Move |
| `/copilot` | Insights | Global Cmd+K / side panel | Demote |
| `/report-print`, `/shared/report/[token]` | — | Print / share views | Keep |
| `/partners` (+ `affiliates`, `affiliates/[id]`, `commissions`, `network`, `referred-users`) | Partners | Partners → Programme | Keep |
| `/partners/payouts` | Partners | Partners → Money | Keep |
| `/partners/statements`, `/partners/statements/[partnerId]` (+ `export`) | Partners | Partners → Money | Keep |
| `/partner-statement/[partnerId]` | — | Print view | Keep |
| `/earnings`, `/earnings/runs/[id]` | Partners | Partners → Money | Keep |
| `/settings/partner-tiers` | Partners | Partners → Programme → Directory | Move |
| `/settings/partner-finance` | Partners | Partners → Money | Move |
| `/settings/account` | Reference | Avatar menu → Account | Demote |
| `/settings/users`, `/settings/users/[id]`, `/settings/access`, `/settings/sign-in`, `/settings/data-privacy`, `/settings/consent` | Admin | Settings → People & access | Demote |
| `/settings/stages`, `/settings/templates`, `/settings/approval-workflows`, `/settings/lead-assignment`, `/settings/product-registry`, `/settings/ai-pilot` | Admin | Settings → Configure | Demote |
| `/settings/integrations`, `/settings/whatsapp`, `/settings/backoffice-import` | Admin | Settings → Connect | Demote |
| `/settings/control-plane`, `/settings/system`, `/settings/system/status`, `/settings/go-live` | Admin | Settings → Health | Demote |
| `/settings/control-plane/investigate`, `/settings/decision-shadow`, `/debugger` | Admin | Settings → Advanced (admin flag) | Demote |
| `/modules` | (All modules) | Replaced by Cmd+K plus the slimmer nav | Retire (candidate) |
| `/handbook`, `/help`, `/release-notes`, `/feature-specs` | Reference | `?` menu in the top bar | Demote |
| `/`, `/login`, `/change-password` | — | Unchanged | Keep |
