# Design system: rules for every screen

These rules apply from UX revamp pass 1 onward. They keep the brand (lime accent, dark mode by default) and remove choices nobody needed. When you're unsure, pick the quieter option.

## Type

**Families.** There are two:
- **Inter** for the interface.
- **Sora** for display text and headings, through the `--font-display` token.

Redaction has been retired. `src/app/display-font.test.ts` pins this.

**Sizes.** Use only these:

| Use | Size | Weight | Tailwind |
|---|---|---|---|
| Caption, meta, kbd | 12 | 400/500 | `text-xs` |
| Body, table cells, inputs | 14 | 400 | `text-sm` |
| Emphasised body, card titles | 16 | 600 | `text-base font-semibold` |
| Section titles | 20 | 600 | `text-xl font-semibold` |
| Page titles (`PageHeader`, `WorkspaceHeading`) | 24 → 28 at `sm` | 600 | `font-display text-2xl sm:text-[1.75rem] font-semibold` |
| Hero numbers (one per screen) | 32 | 600 | `font-heading text-3xl font-semibold tabular-nums` |

**Weights.** Use 400 and 600. Use 500 only for labels and chips.

**Numbers.** Use `tabular-nums` wherever numbers line up.

## Spacing

Spacing uses a 4 px base. The allowed steps are 4, 8, 12, 16, 24, 32 and 48 (`1 2 3 4 6 8 12`):
- Inside a card: 16 on a phone, 24 from `sm` (`p-4 sm:p-6`).
- Between cards: 16 or 24 (`gap-4` / `gap-6`).
- Between sections: 32 (`gap-8`).
- The header cluster: `gap-2`.

## Colour

- **Neutrals do 90% of the work.** That means `background`, `card`, `muted` and `border`.
- **Lime (`--primary`) appears in only three places:** the one primary button on a screen, the active navigation item, and focus rings. Brand-coloured text always uses `--primary-ink`; plain lime text on white fails contrast.
- **Status colours (`success`, `warning`, `destructive`) mean status only, never decoration.** Use them as `Badge` variants or `*-ink` text. The contrast tests are `src/app/status-ink.test.ts` and `src/app/sidebar-contrast.test.ts`.
- **Write every colour as a token, never as hex in a component.** Dark mode works through the same tokens (`.dark` in `globals.css`).

## Layout

- **One primary action per screen**, at the top right (in `PageHeader actions`) or in the sticky action bar on a phone. Everything else is `outline` or `ghost`, or goes in a menu.
- **Progressive disclosure.** Rarely used settings sit behind `<details>`-style "Advanced" sections, or behind "More" in the sidebar (`more: true`). The Campaign Studio review step is the reference.
- **Sidebar.** At most three workspaces on the rail for any role other than admin (`src/lib/nav/model.test.ts`). Developer tools live in Admin under "Advanced".

## Interaction patterns

| Need | Use | Never |
|---|---|---|
| Create something | The header's **+ New** menu (`createActionsFor`), `C`, or Cmd+K | A page-specific "New" button that duplicates the menu |
| Quick edit | Inline, saved on blur or Enter | A modal for one field |
| Edit in context, or preview a record | The workspace `Sheet` (side drawer from 1024 px, bottom sheet on a phone) | The `ui/sheet` in workspace directories |
| Blocking decision or confirm | `Dialog` | `window.confirm()` / `alert()` |
| Reversible destructive action | Do it, then a toast with **Undo** | A confirm dialog |
| Multi-step creation | A stepper with the step in the URL (`?step=`), the live summary always visible, Next disabled with the reason shown | A long single form |
| Success | `toast.success("<Object> <past verb>")`, e.g. "Broadcast sent for approval" | "Success!" |
| Failure | Inline next to the field, or `toast.error` saying what to do next | A raw error code |
| Loading | The still `Skeleton` (fades in once), and a `loading.tsx` per route | Spinners and shimmer |
| Empty | `EmptyState` with one call to action | A blank table |

## Motion

The source of truth is `src/components/motion/tokens.ts`, and `motion-budget.test.ts` enforces it:
- Every animation is **300 ms or less and plays once**. Nothing loops, and there is no `animate-pulse` / `spin` / `ping` / `bounce`.
- Under `prefers-reduced-motion`, everything is instant (`motion-reduce:*`, `MotionConfig reducedMotion="user"`).

| Moment | Spec |
|---|---|
| Menus and popovers | Fade plus zoom 95% → 100%, 100 ms (`data-open:animate-in fade-in-0 zoom-in-95`) |
| Dialogs | Fade plus scale, 150–200 ms |
| Side drawer | Slide from the edge, 260 ms, `cubic-bezier(0.2, 0.7, 0.2, 1)` |
| Wizard step change | Fade plus 8 px slide from the right, 200 ms, ease-out (`animate-in fade-in-0 slide-in-from-right-2 duration-200`) |
| Hover / focus | Colour, border and shadow only, 150 ms. Button press scales to 0.98 |
| Number change | `CountUp`, 300 ms, once |
| Optimistic update | Apply at once. On failure, roll back with a toast that names the reason |

## Keyboard

Shortcuts are defined in `src/lib/shortcuts/` and listed in the overlay on `?`.

| Keys | Does |
|---|---|
| ⌘K / Ctrl+K | Search and commands |
| `/` | Search and commands |
| `C` | Create (+ New menu) |
| `?` | Keyboard shortcuts |
| `G` `H` | Today |
| `G` `C` | Clients |
| `G` `P` | Pipeline |
| `G` `I` | Inbox |
| `G` `M` | Marketing |
| `G` `B` | Broadcasts |
| `G` `T` | Team |
| `G` `S` | Settings |

When shortcuts work:
- They never fire while you type, while a dialog or menu is open, or while a modifier key is held.
- A role only gets "Go to" shortcuts for pages it can open (`registry.test.ts`).
- The palette shows each page's shortcut next to it.

## Copy

- **Sentence case** everywhere. Buttons start with a verb and name the object: "Submit for approval", "New broadcast".
- **Say what will happen**, especially when nothing is sent or nothing moves: "It goes to a colleague for approval; nothing sends from here."
- **Disabled controls say why**, in a line next to them, never only in a tooltip.
- **Use numbers in Indian format** (`en-IN`). Write "≈" when a number is estimated.
