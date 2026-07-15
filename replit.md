# Hazari Khatabook

A desktop billing & ledger app for shop owners to track money owed by customers and owed to suppliers, inspired by the Khatabook mobile app but built for a split-screen desktop workflow.

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
- `artifacts/khatabook/src/pages/` — `dashboard.tsx` (default right-panel view), party detail view, left panel/party list
- Generated hooks: `lib/api-client-react/src/generated/api.ts` (do not hand-edit; regenerate via codegen)

## Architecture decisions

- A party's balance is stored as an unsigned `currentBalance` + a `balanceType` enum (`YOU_WILL_GIVE` / `YOU_WILL_GET`) rather than a signed number, matching the OpenAPI contract. Server-side helpers (`toSignedBalance`/`fromSignedBalance` in `khatabook.ts`) convert to/from a signed value to make the add/subtract math simple.
- Balance recalculation happens entirely server-side when a ledger entry is created — the client never computes or sends the new balance.
- `BusinessSettings` is a lazily-created singleton row (`getOrCreateBusinessSettings`), not a fixed seeded row, so the schema doesn't need a hardcoded ID.
- No auth, no real i18n, no real SMS/payment gateway — language selector and several action buttons (Report, Request Money, SMS, Add Staff, Cashbook, View Reports) are intentionally non-functional stubs; only the Payment Reminder button calls a real (mocked-response) endpoint.

## Product

- Split-screen desktop app: left panel lists customers/suppliers with balances, search, and due-date filters; right panel shows either the business dashboard (no party selected) or a selected party's ledger history with "You Gave"/"You Got" entry recording.
- Dashboard totals (You Will Get / You Will Give / Online Collections) are aggregated live from party balances plus stored business settings.

## User preferences

- None recorded yet.

## Gotchas

- Always run `pnpm --filter @workspace/api-spec run codegen` after editing `lib/api-spec/openapi.yaml`, before touching frontend/backend code that depends on the new shapes.
- Zod-generated schemas coerce date-only fields (e.g. `dueDate`) into JS `Date` objects even though the DB column is a calendar-only `date`; route handlers must convert back to `YYYY-MM-DD` strings before inserting (see `toDateOnlyString` in `khatabook.ts`).

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
