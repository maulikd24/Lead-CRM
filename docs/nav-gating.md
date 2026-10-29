# Nav gating

## Two-level navigation (Wave 4)

The sidebar is a slim **rail** of labelled workspaces (Today, Customers, Growth, Service, Partners, Insights, Admin) and a **panel** of grouped items for the active workspace. Nothing in the layout lists items: every item in `src/lib/nav-items.ts` declares its `space` (workspace), its `group` (Plan, Run, Grow, Measure ... inside the panel) and its policy `area`; a module that arrives later only declares those three. `src/lib/nav/model.ts` derives everything else.

- A role gets an entry only if the item lists the role AND the central registry allows the area (default deny). A workspace with no entry for the role is not on its rail.
- A flag that is off hides the item from every role except **ADMIN**, who sees it greyed with "Off"; a flag that is on but missing its setup (`src/lib/nav/setup.ts`, env presence only) shows "Needs setup" to ADMIN. A role that cannot open an item never learns it exists.
- `roleSpace` moves an item for one role (Finance sees Referrals under Partners); `alsoIn` lists an item in another workspace too (none use it today: nothing is listed twice); `more` tucks a rare item behind "N more" in the panel.
- **All modules** (`/modules`, ADMIN only) lists every entry once with its state: Active, Off, Needs setup.
- The rail collapses to icons only; the choice is remembered per person in a cookie. Counts (unread inbox, overdue tasks, approvals waiting, duplicates) badge items and sum onto the rail icon.
- Cmd+K reads the same entries and the same registry (`src/lib/palette/`): see `universal-search.ts` and `commands.ts`.
- `src/lib/nav/legacy-nav.json` is the pre-convergence nav per role; `model.test.ts` fails if a role that could reach a page no longer can.

A sidebar, Cmd+K, Help or first-run-tour item is hidden by two things only: the roles listed on the item, and an optional feature flag.

- Items live in `src/lib/nav-items.ts`. A gated item carries a `flag` field, for example `flag: "calls-review"`. Nothing in that file reads an environment variable.
- Flags are defined and evaluated in one place, `src/lib/nav-flags.ts`. Each entry reuses the predicate the page itself uses, so a menu item and its page cannot disagree. `enabledNavFlags()` returns the flags that are on.
- The dashboard layout (and the dashboard page, for the tour) calls `enabledNavFlags()` on the server and passes the list to the client components. They call `visibleNavItems(role, flags)` (or `primaryNavFor(role, flags)`), the one function that applies role and flag.
- Every flag is off unless its environment variable is exactly `1`.

| Flag | Env var | Item |
|---|---|---|
| `partner-workspace` | `PARTNER_WORKSPACE_ENABLED` | Partner workspace |
| `calls-review` | `NEXT_PUBLIC_CALLS_REVIEW` | Call recordings |
| `merge-review` | `NEXT_PUBLIC_MERGE_REVIEW` | Duplicate customers |
| `support-sla` | `NEXT_PUBLIC_SUPPORT_SLA` | Support SLA |
| `marketing` | `NEXT_PUBLIC_MARKETING` | Marketing |
| `backoffice-import` | `BACKOFFICE_IMPORT_ENABLED` | Back-office import (Admin only, Administration group) |
| `insights` | `NEXT_PUBLIC_INSIGHTS` | Insights |
| `outcomes` | `NEXT_PUBLIC_OUTCOMES` | Goals at risk: Today's Needs attention tab (`/dashboard?tab=attention`) |
| `attribution` | `NEXT_PUBLIC_ATTRIBUTION` | Attribution: Marketing campaigns tab (`/marketing?tab=campaigns`; Admin, Marketing) |
To add a gated item: add the flag to `NAV_FLAGS`, give the item `flag`, and add the item to the `CONTRACT` table in `src/lib/nav-gating.test.ts`. That test fails if an item is missing from the table, if a flag guards nothing, or if any flagged item shows with its flag off.

The nav flag only controls the menu. The page and its actions keep their own server-side flag and role checks.
