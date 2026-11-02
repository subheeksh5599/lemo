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
- `components/console/primitives.tsx` holds the console panel, label and value primitives.
- `components/console/copy-button.tsx` is the only copy control.
- `components/wallet/wallet-provider.tsx` owns wallet discovery and account state; do not create a second wallet store.
- `components/console/flow/*` owns the transaction console panels. The page composes panels; it does not duplicate their logic.

## Copy and data

- No fabricated addresses, balances, roots, block numbers or preview values. If a value is unknown, render the variable name or the empty state.
- No marketing claim that a contract is deployed unless its address is in `docs/EVIDENCE.md`.
- Numbers use tabular figures and one format. Addresses are shortened only in display, never in a transaction payload.
- No exclamation marks.

## Before shipping

Run `npx tsc --noEmit`, `npm run build`, `forge test` and `cd server && npm test`.
