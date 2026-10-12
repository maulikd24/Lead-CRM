# Nav gating

A sidebar, Cmd+K, Help or first-run-tour item is hidden by two things only: the roles listed on the item, and an optional feature flag.

- Items live in `src/lib/nav-items.ts`. A gated item carries a `flag` field, for example `flag: "calls-review"`. Nothing in that file reads an environment variable.
- Flags are defined and evaluated in one place, `src/lib/nav-flags.ts`. Each entry reuses the predicate the page itself uses, so a menu item and its page cannot disagree. `enabledNavFlags()` returns the flags that are on.
- The dashboard layout (and the dashboard page, for the tour) calls `enabledNavFlags()` on the server and passes the list to the client components. They call `visibleNavItems(role, flags)` (or `primaryNavFor(role, flags)`), the one function that applies role and flag.
- Every flag is off unless its environment variable is exactly `1`.

| Flag | Env var | Item |
|---|---|---|

To add a gated item: add the flag to `NAV_FLAGS`, give the item `flag`, and add the item to the `CONTRACT` table in `src/lib/nav-gating.test.ts`. That test fails if an item is missing from the table, if a flag guards nothing, or if any flagged item shows with its flag off.

The nav flag only controls the menu. The page and its actions keep their own server-side flag and role checks.
