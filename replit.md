# Hazari Khatabook (হাজারী খাতাবুক)

A mobile-first, fully Bengali-localized billing & ledger web app for shop owners to track money owed by customers and owed to suppliers, built to feel and function like the Khatabook mobile app. Single-column, phone-frame layout (no desktop split-screen) with a native-app-like view switcher: a home/directory feed and a full-screen party ledger view.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server
- `pnpm --filter @workspace/khatabook run dev` — run the web frontend
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec (run after editing `lib/api-spec/openapi.yaml`)
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite (`artifacts/khatabook`), wouter router, TanStack Query, shadcn/ui, Tailwind v4
- API: Express 5 (`artifacts/api-server`)
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec) — generates React Query hooks + Zod schemas from `lib/api-spec/openapi.yaml`
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — source-of-truth API contract (parties, ledger entries, dashboard summary, business settings)
- `lib/db/src/schema/` — Drizzle tables: `parties.ts`, `ledgerEntries.ts`, `businessSettings.ts`
- `artifacts/api-server/src/routes/` — route handlers (`parties.ts`, `dashboard.ts`, `settings.ts`)
- `artifacts/api-server/src/lib/khatabook.ts` — shared balance-calculation and dashboard-aggregation helpers
- `artifacts/khatabook/src/pages/` — `home.tsx` (View 1: directory/feed, formerly the desktop left panel), `party-view.tsx` (View 2: full-screen ledger for one party)
- `artifacts/khatabook/src/components/modals/` — `add-party-modal.tsx`/`add-transaction-modal.tsx` (bottom `Drawer` half-sheets, not centered dialogs — mobile-first input pattern), `settings-drawer.tsx` (language stub, opened from the home header gear icon)
- Generated hooks: `lib/api-client-react/src/generated/api.ts` (do not hand-edit; regenerate via codegen)

## Architecture decisions

- A party's balance is stored as an unsigned `currentBalance` + a `balanceType` enum (`YOU_WILL_GIVE` / `YOU_WILL_GET`) rather than a signed number, matching the OpenAPI contract. Server-side helpers (`toSignedBalance`/`fromSignedBalance` in `khatabook.ts`) convert to/from a signed value to make the add/subtract math simple.
- Balance recalculation happens entirely server-side when a ledger entry is created — the client never computes or sends the new balance.
- `BusinessSettings` is a lazily-created singleton row (`getOrCreateBusinessSettings`), not a fixed seeded row, so the schema doesn't need a hardcoded ID.
- No auth, no real i18n, no real SMS/payment gateway — the settings-drawer language picker is an intentionally non-functional stub (writes to `BusinessSettings.language` for display only); only the Payment Reminder button calls a real (mocked-response) endpoint.
- The entire UI is hardcoded Bengali (not translated at runtime); currency is always displayed with ৳ via `formatCurrency` in `lib/utils.ts`.
- The mock SMS reminder message is built server-side in the `/parties/:id/reminder` route with the exact Bengali template the product spec requires; the frontend shows it in a copyable dialog, not a toast.
- DB stays PostgreSQL + Drizzle (established monorepo stack) even though a later spec text-mentioned SQLite — treated as a UI/UX-layer spec, not a stack migration request, to stay consistent with the rest of the project.
- Routing IS the view switcher: `/` renders `HomeView` (View 1) and `/party/:id` renders `PartyView` (View 2) full-screen; `MainLayout` no longer renders a persistent sidebar, just a centered single-column phone-frame shell at all viewport widths.

## Product

- Mobile-first single-column app (no split-screen, even on desktop — content is capped at phone width and centered): Home view lists customers ("কাস্টমার")/suppliers ("সাপ্লায়ার") with a sticky header (search + quick add), summary cards ("পাবেন"/"দেবেন"/"অনলাইন কালেকশন"), due-date filter chips, and a tap-through contact feed.
- Tapping a contact navigates to a full-screen ledger view: sticky blue header (back arrow, avatar, name/role badge, phone, bell icon for reminders), a centered "🔒 only you and X can see these entries" privacy badge, a scrollable stream of color-bordered entries (red = "আপনি দিয়েছেন", green = "আপনি পেয়েছেন"), and two sticky bottom action buttons.
- Tapping a bottom action button opens `TransactionEntryScreen` (`components/modals/transaction-entry-screen.tsx`) — a full-screen overlay (not a drawer/dialog) replicating the native Khatabook calculator screen: contextual colored header showing the live total, an amount card with a live raw-formula sub-bar, description/bill-no/date/attach-bill fields, and a custom on-screen 4/5-column calculator keypad (digits, ÷×−+, %, C, ⌫, =, M+/M-) that replaces the device keyboard entirely — no real `<input type=number>` for amount. `evaluateMathExpression`/`expandPercent` in `lib/utils.ts` sanitize and evaluate the tapped expression client-side before the numeric result is sent to the API.
- `add-party-modal.tsx` still uses the bottom half-sheet `Drawer` pattern (only the ledger-entry amount flow needed the full custom-keypad screen).
- `TransactionEntryScreen` is a single-page state machine: STATE A (empty/zero amount) hides the metadata panel (details, bill no., date, attach) via a `max-height:0 / opacity-0 / overflow-hidden` wrapper; the instant a keypad tap produces a nonzero amount it flips to STATE B and the panel smoothly expands to `max-h-[320px] / opacity-100`. Everything (header, amount card, save button, keypad) fits one viewport without scrolling.
- Home screen (`pages/home.tsx`) uses a deep-blue (`#0b57d0`) fixed header with a shop-name dropdown (decorative/single-shop for now) and a "স্টাফ যোগ করুন" button that opens an honest "coming soon" dialog (`add-staff-dialog.tsx`) — real multi-staff login is tracked separately as its own project task, not faked here.
- Below the header, a white summary card overlaps the header edge (negative top margin) showing পাবেন/দেবেন plus a "রিপোর্ট দেখুন" row that opens `report-drawer.tsx` — a real printable report (totals, net balance, party counts) exportable to PDF via `window.print()` with print-only CSS (`.print-report` rules in `index.css`).
- Utility bar has a filter icon (toggles the due-filter chip row, previously always-visible) and a document icon (opens the same report drawer) instead of PDF/filter being unimplemented. The add-party action moved to a floating crimson FAB; a 3-tab bottom nav (পার্টিস/রিপোর্ট/সেটিংস) replaced the old inline settings icon.
- Calculator keypad evaluator (`lib/utils.ts: evaluateCalculatorExpression`) uses classic sequential four-function-calculator semantics (operations applied strictly left-to-right in press order, not algebraic ×/÷-before-+/- precedence) — required for chained "%" to resolve like a real ledger calculator, e.g. `10+5+40×5÷10%` = 2750. Percent after +/- means "N% of the running total"; percent after ×/÷ means the literal fraction N/100. Replaces the old `evaluateMathExpression`/`expandPercent` pair (removed).
- "+ কাস্টমার/সাপ্লায়ার যোগ করুন" FAB now opens a full-screen two-step onboarding flow (`add-party-modal.tsx`, replacing the old bottom-drawer form): Screen 1 is a contact-directory selector with search, a manual-add row, and — only when the browser supports the Contact Picker API (`navigator.contacts.select`, Chrome/Android only) — a real device-contact import button; Screen 2 is the Add Party form. No fake/hardcoded contact data is ever shown; unsupported browsers just get a note and the manual-add path.
- Party `phone` is fully optional end-to-end: `openapi.yaml` PartyInput no longer requires it, the `parties.phone` DB column now has `.default("")` (stays NOT NULL to avoid `string | null` ripple through the app; blank is stored as `""`, never surfaced as null), and the API server route coerces missing phone to `""`. Any change to `phone`'s optionality must stay consistent across all three (openapi spec → regenerate via `pnpm run codegen` in `lib/api-spec` → drizzle schema → `pnpm run push` in `lib/db`).

## User preferences

- None recorded yet.

## Gotchas

- Always run `pnpm --filter @workspace/api-spec run codegen` after editing `lib/api-spec/openapi.yaml`, before touching frontend/backend code that depends on the new shapes.
- Zod-generated schemas coerce date-only fields (e.g. `dueDate`) into JS `Date` objects even though the DB column is a calendar-only `date`; route handlers must convert back to `YYYY-MM-DD` strings before inserting (see `toDateOnlyString` in `khatabook.ts`).

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
