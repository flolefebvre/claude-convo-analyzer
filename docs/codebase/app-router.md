# App Router

## When to use which

In order of preference — reach for the next one only when the previous doesn't fit:

1. **Server components** for display. Pages and layouts fetch their own data during render (through the
   `_lib` seams over `src/core`); never add an API route just to feed a page its own initial data.
2. **Server actions** for the page's main action — the mutation the user is there to perform (here, the
   Refresh scan). Actions are queued one at a time per client, which is fine for the main action and wrong
   for anything else.
3. **API routes** (route handlers) for what runs alongside the main flow — typeahead, polling, client-side
   reads after the initial render. None exist yet; don't add one while a server component can do the job.

## Structure

- The app's server actions live in `src/app/actions.ts`; a page that grows its own set moves them to an
  `actions.ts` next to its `page.tsx`.
- View components live in `src/app/_components/` (the underscore keeps the folder out of routing), grouped
  in a subfolder when a view has several (e.g. `_components/transcript/`). `src/components/ui/` is
  shadcn-vendored only.
- Server actions and route handlers are written with next-pipe (`actionPipe` / `routePipe` — the `next-pipe`
  skill has the details); reach for `pagePipe` when a page needs middlewares (gates, validated search
  params), not before.
- Components are server components by default; add `"use client"` only at the leaves that need
  interactivity, not on whole pages.
- Client components never import `src/core` (ADR-0002) — they receive data from server components or call a
  server action.
