# The Conversation export is a page the server fetches from itself

## Status

accepted

## Context

A Conversation export is one self-contained HTML file: no script, no request
outside the file, and it looks like the Transcript view. Rendering it through
the Transcript components and Next's own compiled CSS is what keeps the two
from drifting apart. Several of those components are client components, and
the CSS is Tailwind, compiled only by Next's pipeline.

## Decision

- **The export is an ordinary page** that renders the whole Conversation with
  the Transcript components, under its own root layout (no app bar, no theme
  script: its dark theme follows the OS color scheme). It sets `instant = false` and awaits its data outside any
  `<Suspense>`, so the whole Conversation is in the first HTML response instead
  of streamed chunks that only a script would put in place.
- **One section per Agent, switched by the fragment.** Each Agent's section
  (`#agent-<tree key>`, depth-first in tree order, the main thread first) is
  the Transcript view as it renders that Agent: its own copy of the agent tree,
  its node marked current, and its whole Transcript. The file's links between
  Agents are plain `#` links, and the CSS shows the section that is the
  `:target` or `:has(:target)`, or the first one when nothing is targeted; print
  shows them all. No script picks the Agent, and no per-Agent CSS is generated.
- **The download is a route handler that fetches that page from its own
  server**, at the request's origin, then writes the home directory as `~`,
  inlines its stylesheets with the fonts they reference as `data:` URLs, and
  strips every `<script>` and every `<link>`.

## Considered options

- **Render with `react-dom/server` in the route handler**: rejected. A static
  import fails the build; a dynamic one renders server components but throws on
  every client component, since a route handler is bundled for the server
  components environment.
- **Render in a plain Node process** (tsx): rejected. It works, but as a second
  renderer outside Next — no React Compiler, no `next/font`, a dev dependency at
  run time — and it still needs Next's CSS.
- **Compile the CSS separately** (a Turbopack loader running Tailwind) or read
  it from `.next`: rejected. The first is a second CSS pipeline; the second
  reads Next's internal build files, laid out differently in dev.

## Consequences

- The handler rewrites Next's HTML output with string operations, which a Next
  upgrade can break. The export's e2e spec guards it: the downloaded file has no
  script and no external URL.
- The export page is a blocking route: it renders nothing until the whole
  Conversation is read.
- The handler needs its own server reachable at the request's origin, which a
  local-only app always has.
