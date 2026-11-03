# LEMO design rules

These are the rules the interface follows. Read them before changing UI code.

## Type

- UI and display: `Instrument Sans Variable`, imported from `@fontsource-variable/instrument-sans`.
- Every figure, address, hash and table cell: `IBM Plex Mono`, imported from `@fontsource/ibm-plex-mono/400.css` and `500.css`.
- No Google Fonts, no font CDN, no unused font packages.
- No uppercase micro-labels with wide tracking. Labels are sentence case.
- No emoji in the interface.

## Color

Use the tokens in `app/tokens.css`; do not introduce raw hex values in components.

- Surfaces: `--color-void`, `--color-canvas`, `--color-surface`, `--color-raised`, `--color-overlay`.
- Lines: `--color-line`, `--color-line-strong`, `--color-line-bright`.
- Text: `--color-ink`, `--color-ink-2`, `--color-muted`, `--color-faint`.
- One accent: `--color-accent` with `--color-accent-bright` for the active element only.
- Verdicts use `--color-ok`, `--color-warn`, `--color-bad`; never use accent as a success color.

## Shape and chrome

- Radii come from `--radius-xs` through `--radius-lg`. Nested radii add up; do not nest a large radius inside a larger one.
- Chrome is solid, not glass. No `backdrop-blur` on nav, headers or dialogs.
- No decorative grid overlays, no infinite loops, no blinking live dots, no fade-in or blur-in entrance animation.
- One easing curve per transition. Do not animate layout properties.
- One primary action and one secondary action per view. Icon-only controls are at least 32px with a 44px hit area.
- Tooltips are one shared component (`components/ui/tooltip.tsx`), not floating ad-hoc text.
- Dialogs keep their size between steps.

## Components

- `components/ui/tooltip.tsx` is the only tooltip.
- `components/console/primitives.tsx` holds the console primitives:
  - `PageHeader`: every console page opens with it (22px title, one mono meta line, at most one action). No second right-hand meta line.
  - `Panel`, `Row`, `State`, `Skeleton`.
  - `FigureBand` + `Figure`: headline figures sit in one hairline-divided band, never loose or as separate cards.
  - `Notice`: the one status component for boundaries, failures and empty states. State each boundary (paused gate, placeholder commitment, EVM-only predecessor, single-node checkpoint) once per page, in a Notice or in one footnote, never both.
- `components/console/root-source.tsx` is the only place the gate's root source (feed type) is named. A new feed kind is a new case there; the overview Runtimes table and the gate panel read the label from it.
- `components/console/copy-button.tsx` is the only copy control.
- `components/wallet/wallet-provider.tsx` owns wallet discovery and account state; do not create a second wallet store.
- `components/console/flow/*` owns the transaction console panels. The page composes panels; it does not duplicate their logic.

## Type scale in the console

- Sizes: 11px (meta, mono footnotes), 12px (mono values, secondary), 13px (body, row labels), 14px (panel titles), 22px (page title), 24/28px (figures). Nothing below 11px; no half-pixel sizes.
- Radii: `rounded-md` for top-level panels and bands, `rounded-sm` for inputs, wells and anything nested, `rounded-xs` for skeletons and tooltips.
- Buttons use `.btn` sizes as defined; do not override `.btn--sm` height.
- Row and form labels are sentence case.
- Hashes are middle-truncated mono with the full value in `title` and a `CopyButton` where the user may need it.

## Copy and data

- No fabricated addresses, balances, roots, block numbers or preview values. If a value is unknown, render the variable name or the empty state.
- No marketing claim that a contract is deployed unless its address is in `docs/EVIDENCE.md`.
- Numbers use tabular figures and one format. Addresses are shortened only in display, never in a transaction payload.
- No exclamation marks.

## Before shipping

Run `npx tsc --noEmit`, `npm run build`, `forge test` and `cd server && npm test`.
