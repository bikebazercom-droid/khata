---
    name: orval-date-query-param-coercion
    description: OpenAPI query params with format:date generate a zod schema requiring a real Date object, not a string, so req.query always fails validation
    ---

    Orval's generated Zod query-param schemas use `zod.date()` (no `.coerce`) for OpenAPI params with `format: date`, even though Express `req.query` always delivers plain strings. Passing `req.query` straight into `.safeParse()` on the generated schema for such params fails 100% of the time (400 on every request), while `format: date-time` fields elsewhere in the same generator output correctly use `zod.coerce.date()`.

    **Why:** confirmed via a generated `ListXQueryParams` schema where `startDate`/`endDate` (format: date) used `zod.date()` but `createdAt` (format: date-time) used `zod.coerce.date()` — inconsistent coercion by format type, not a one-off typo.

    **How to apply:** don't reuse the orval-generated query-param schema directly for Express route validation when it has date-only fields. Either validate the raw query string manually (regex/date-fns) in the route handler, or reprocess with a local zod schema (`z.string().regex(/^\d{4}-\d{2}-\d{2}$/)`) before parsing.
    