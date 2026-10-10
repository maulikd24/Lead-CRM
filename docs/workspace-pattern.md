# The workspace pattern

Long pages become a **tabbed workspace**: no endless scroll. A header that stays put (identity, status chips, primary actions), a tab bar, **one section on screen at a time**, and a sticky rail of key facts and the next action. Marketing, Customer 360, the client record, the consent admin page, Support SLA, the call review list and detail, Today, Dashboard, Manager Dashboard, Insights, Agents, the Partner workspace, Duplicate review, Apps and Integrations and the back-office importer are built this way. Everything lives in `src/components/workspace/`.

```
┌───────────────────────────────────────────────────────────┐
│ header: name, chips, actions                              │  fixed
├───────────────────────────────────────────────────────────┤
│ Overview  Timeline  Portfolio  Consent  Tickets   [toolbar]│  tab bar
├──────────────────────────────────────────┬────────────────┤
│                                          │ rail           │
│  the ONE section on screen               │  key facts     │
│  (scrolls inside itself)                 │  next action   │
│                                          │  blocks        │
└──────────────────────────────────────────┴────────────────┘
```

Under 1024px the rail's facts become a swipeable strip **above** the tab bar, the tabs become a scrollable pill row, and the rail's blocks drop below the section.

## The pieces

| Piece | What it is |
| --- | --- |
| `WorkspaceShell` | The frame. Slots: `header`, `tabs`, `toolbar` (end of the tab row), `rail`, `children` (the panel). `fill` (default) pins it to the viewport on a wide screen so the section and rail scroll inside themselves. `hasRail` reserves the rail column when the rail streams inside `children`. |
| `WorkspaceTabs` | `role="tablist"` of `role="tab"` anchors. Real links (deep-linkable, work without JS), roving tabindex, Left/Right/Home/End move *and* select. |
| `WorkspacePanel` | The one `role="tabpanel"`, labelled by its tab, re-keyed per tab so it softly cross-fades in (220 ms). `busy` marks a loading placeholder. |
| `useUrlTab(keys, fallback)` | Tab state in the URL (`?tab=`) for pages that switch client-side. A selection is a `history.pushState` (instant, no server round trip); back/forward step through tabs. |
| `TabLink` | A link elsewhere on the page that opens a tab through the same mechanism. |
| `WorkspaceHeading` | Title, one line of context (hidden on a phone) and optional actions, for the `header` slot. |
| `StickyRail`, `RailFact`, `RailCard` | The rail. Facts are compact cards (strip on a phone); `RailCard` is a titled block. |
| `CountUp` | Number that counts up once (300 ms). Server render and reduced motion show the final value; assistive tech reads the final value once. |
| `DrawIn`, `motion.*` | CSS-only motion classes: `enter`, `lift`, `draw`, `drawLine`, `growX`, `growY`, `liveDot`. |
| `KpiStrip`, `KpiTile` | A row of key figures that stays above the tabs (the "command" layout): a swipeable strip on a phone, a grid from 1024px. A tile can link, tint by tone and hold a small accessory (a sparkline). |
| `TabbedWorkspace` | Recipe B packaged: pass `tabs`, one ReactNode per tab in `panels`, and optional `header`, `rail`, `toolbar` (or `toolbars[tab]`). Only the active section renders; switching is instant and keeps other query parameters. |
| `Skeleton` | Still block that fades in once. No shimmer loop, no spinner. |

Motion rules (enforced by `workspace-motion.test.ts`): every animation and transition is 300 ms or shorter, plays once (nothing loops), and is switched off under `prefers-reduced-motion`. No animation library: the existing `motion` toolkit stays lazily loaded and is not used here. Colours are theme tokens only.

## Convert a page in 10 minutes

There are two ways to switch tabs. Pick by where the data lives.

### A. Server-driven tabs (each tab loads its own data)

Use this when tabs need different queries (Customer 360, Marketing).

1. Define the tabs once, with a parser, in `src/lib/<feature>/tabs.ts`:

   ```ts
   import { parseTabParam, tabHref } from "@/components/workspace/tab-logic";
   export const TABS = [{ key: "overview", label: "Overview" }, { key: "timeline", label: "Timeline" }] as const;
   export const parseTab = (v: string | string[] | undefined) => parseTabParam(v, TABS.map((t) => t.key), "overview");
   ```

2. In `page.tsx` read `searchParams`, authorise first (before any tab is considered), then:

   ```tsx
   const tab = parseTab((await searchParams).tab);
   const tabs = TABS.map((t) => ({ ...t, href: tabHref(`/things/${id}`, "", t.key, { fallback: "overview" }) }));

   <WorkspaceShell
     hasRail
     header={<h1>…name, chips, actions…</h1>}
     tabs={<WorkspaceTabs tabs={tabs} active={tab} idPrefix="thing" label="Thing sections" />}
   >
     <Suspense fallback={<StickyRail><Skeleton className="h-24" /></StickyRail>}>
       <ThingRail id={id} tab={tab} />
     </Suspense>
     <WorkspacePanel tab={tab} idPrefix="thing">
       <Suspense key={tab} fallback={<Skeleton className="h-64" />}>
         <ThingSection id={id} tab={tab} />   {/* loads only what this tab needs */}
       </Suspense>
     </WorkspacePanel>
   </WorkspaceShell>
   ```

   Pass `href` on each tab (a function prop cannot cross from a server component to the client tab bar). Wrap shared loaders in React `cache()` so the rail and the section share one query per request.

### B. Client-driven tabs (all data already on the page)

Use this when the page already loads everything (the client record). Make the component that owns the tabs a client component, and give it the header and rail as props:

```tsx
"use client";
const defs = buildTabs(…);                                   // [{ key, label, count? }]
const { tab, select, hrefFor } = useUrlTab(defs.map((t) => t.key), "overview");

<WorkspaceShell hasRail header={header} rail={rail}
  tabs={<WorkspaceTabs tabs={defs} active={tab} idPrefix="thing" label="Thing sections" hrefFor={hrefFor} onSelect={select} />}>
  <WorkspacePanel tab={tab} idPrefix="thing">
    {tab === "overview" && <OverviewSection />}
    {tab === "history" && <HistorySection />}
  </WorkspacePanel>
</WorkspaceShell>
```

Render only the active tab's content. Server-rendered cards that belong to a tab go in as `ReactNode` props ("slots") and are placed inside that tab's block. A rail chip that should open a tab uses `<TabLink tab="history" keys={…} fallback="overview">`.

### C. Route-driven tabs (each tab is its own route)

Use this when sections already are routes with their own paging and filters (the Partner workspace). The tab list can depend on the server (the Partner workspace has seven tabs on its native source and five on the external one): the layout passes the list to the small client component that follows the URL. The layout renders the shell and a small client component that reads `usePathname()` to set `active`; each tab's `href` is its route. Each page returns its rail and its `<WorkspacePanel>` as siblings inside the shell. Share one request between the rail and a section with React `cache()`.

### Then

3. **Rail.** `StickyRail` with 3 to 5 `RailFact`s (what matters right now, most important first) and a couple of `RailCard`s. A fact can hold a `<CountUp>` or text. Leave out a rail block whose full version is the section on screen.
4. **Header.** Identity, status chips, primary actions. Keep it short; the stage tracker (or similar) can live in it.
5. **Motion.** Put `motion.enter` (with `style={{ "--i": index }}`) on cards, `motion.lift` on things you can point at, wrap charts in `<DrawIn>`, use `<CountUp>` for headline numbers, `<Skeleton>` while loading. Nothing else is needed for reduced motion: the module switches it all off.
6. **Test.** Keep tab keys and labels in a pure module and test them (see `src/lib/c360/tabs.test.ts`). The shared pieces already have tests for roles, keyboard, URL contract and reduced motion.

### C. The command layout (dashboards)

A dashboard is a fixed-height screen, not a long page: the header holds the title and a `KpiStrip`, the focus panel shows ONE tab (My day, Pipeline, Team), and the rail keeps the next actions in view. Build it with `TabbedWorkspace`; wrap each card in its own `<Suspense>` so the sections stream in, and put each tab's cards in an `@container` grid so they reflow to the panel width, not the screen's. Server components cannot pass functions to `CountUp`; use its `prefix`, `suffix` and `decimals` props. See `src/app/(dashboard)/dashboard/page.tsx`.

## Checklist before you ship a conversion

- Every section that existed is still reachable; nothing was dropped.
- Every flag still gates what it gated (a flag-off tab is not in the tab list, and `?tab=` for it falls back to the default).
- `?tab=` deep link works on reload; back/forward step through tabs.
- Arrow keys, Home and End work on the tab bar; focus ring visible.
- 390 px: the rail strip is above the tabs, tabs scroll as pills, nothing scrolls sideways at page level.
- Dark and light both read well.

## Notes from the operations pages (consent, Support SLA, calls)

- **Pure model first.** Each page has a small pure module for its tabs and numbers (`consent-model.ts`, `support-model.ts`, `src/lib/calls/tabs.ts`) with tests; the view only renders.
- **Client-driven for pages that already hold their data** (consent, Support SLA, one call). **Server-driven for the calls list**, because a filter change reloads the data anyway: tab links keep the current filters, and the filter form carries the open tab in a hidden field.
- **A tab with nothing to show is not in the list** (the calls Rollup tab exists only for managers, and only when there are calls); `?tab=` for it falls back to the default.
- **Something that must keep running across tabs belongs in the header, not in a tab.** The call recording player lives in the header slot, so one `<audio>` element survives every tab change (the panel remounts per tab). A tab can still show the playback position through shared state (`useCallAudio`).
- **A filter bar should not eat the sticky area.** One "Filters" button with a count in the toolbar slot, opening the form as a panel; do not close such a panel from `onSubmit` of a native GET form (removing the form during submit cancels the navigation).
- **Old page-local motion** (long count-ups, looping pulses) was cut to the shared budget; `converted-motion.test.ts` guards those files.


## Lazy tabs (heavy tabs load on demand)

`TabbedWorkspace` takes `lazy`. The page then builds only the section for `?tab=` with `lazyPanels(keys, searchParams.tab, defaultKey, { key: () => <Section /> })`, so the queries behind the other tabs never run. The tab is read on the server, so a deep link opens the right section and an unknown value falls back to the default. Choosing a tab that was not sent with the page is a normal navigation (`router.push`, in a transition), so history and the back button work; the current section stays on screen until the next one arrives. Use it where each tab owns its own queries (Dashboard, Today, Manager Dashboard activity and team tabs, Agents sent and rules). Do not use it where one loader feeds every tab (Insights) or where the rail and header already need the same data (the client record): split the loader first.

- The default tab must be the first tab in the list on both sides (server and `tabs` prop).
- Counts shown in the tab label or rail must come from queries that run for every tab.
- Switching tabs in a lazy workspace costs a server round trip; instant switching is for pages that already hold all their data.

## Notes from the final integration (duplicates, integrations, Today)

- **Duplicate review is for Admin, Manager and RM.** An RM sees only pairs that include one of their own customers (`rm-scope.ts`: `full` when both are theirs, `restricted` when one is, nothing otherwise). A restricted pair shows their own customer, why the two look alike, and **Ask a manager**; nothing about the other customer (no id, name, code or owner) is ever sent to the browser. The page gate, the loaders and every action use the same rule (`reviewAccess`, `mayMerge`), and an RM gets the same refusal whether or not a pair exists.
- **Apps & Integrations has four states, in words:** Connected, Mock mode (nobody has switched it to live: the deliberate default, nothing is broken), Needs setup (live chosen, no credentials saved) and Flag off. Typed but unsaved credentials survive tab switches in memory only (`credential-drafts.ts`) and are dropped on reload, on leaving the page, or on save.
- **Today for a manager or admin has a My day tab** (their own tasks, not the team's).
- **Nothing loops and nothing runs longer than 300 ms.** `src/components/workspace/motion-budget.test.ts` scans the whole of `src` for it; spinners are static.
