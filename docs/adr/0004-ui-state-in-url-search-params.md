# UI interaction state lives in URL search params, not client state

## Status

accepted

## Context

The conversation list is growing interactive controls: column sorting (already
shipped), and now a **folder filter** (issue: per-folder scoping) and a **dark
mode** toggle. Each could be built as client React state, but that would pull
the page off its current shape — a React Server Component that reads
`searchParams`, queries the core, and streams the table in via `<Suspense>`
with `cacheComponents`/PPR on (ADR-0002). Client state would also mean shipping
all rows to the browser and losing shareable/bookmarkable views.

## Decision

**View state is URL state.** Sorting and folder filtering are both encoded as
search params (`?sortBy=`, `?dir=`, `?folder=`). The server component reads them,
filters and sorts the rows it already fetched (both in the app zone — the core's
comparator handles only top-level scalars), and re-renders. Header links and the
folder **sidebar** are plain `<a>` tags — no client JS, no `onClick`. The
`?folder=` key is the Project's dash-encoded `folderName` (unique per on-disk
folder, slash-free, already stored); folders are displayed by their **friendly
name** (path basename) with the full path shown beneath.

**Client JS is the deliberate exception, used only where the platform forces it:**
row expand/collapse (local UI state + lazy detail fetch, already shipped) and the
**theme toggle** (dark mode needs a client `ThemeProvider`). Dark mode uses
`next-themes` with `attribute="class"`, `defaultTheme="system"`; the `.dark`
design tokens already exist in `globals.css`.

## Consequences

- Filtered/sorted views are shareable and bookmarkable; reloads preserve them;
  the RSC/PPR streaming model is untouched.
- No client-side data-table library; filtering and sorting stay in the
  app-zone pure modules (`_lib/sort.ts`, and a new `_lib/folders.ts`), unit-test
  friendly and free of React/I/O.
- Instant (no round-trip) filtering is given up. Acceptable for a local,
  single-user tool where each navigation is a fast local DB read.
- `next-themes` is the one new client dependency; the `<html>` element needs
  `suppressHydrationWarning` because the provider mutates its class.
