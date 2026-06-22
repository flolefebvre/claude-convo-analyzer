---
name: design-pass
description: Structure-first visual/UX redesign loop for this app. Use when improving how the UI looks or feels — layout, hierarchy, sections, spacing, density, then color. Orchestrates the frontend-design and webapp-testing skills with an autonomous screenshot-and-critique loop and the project's validation gate. Trigger on "make it look nicer", "polish the UI", "improve the layout/design/UX" of a screen.
---

# Design Pass

A repeatable loop for improving the look & feel of this app (a Claude Code
conversation **analyzer**: usage + cost across projects). It glues together two
installed skills and the project's quality gate. **Structure before color** —
that ordering is deliberate; do not jump to palette first.

## Skills this builds on
- **`frontend-design`** (`.claude/skills/frontend-design/`) — aesthetic direction,
  typography, anti-templated choices, and the brainstorm→plan→critique method.
  Invoke it for Phases 1–2.
- **`webapp-testing`** (`.claude/skills/webapp-testing/`) — Playwright server +
  browser. Its `scripts/with_server.py` boots the app; pair it with this skill's
  `scripts/shoot.py` to capture screens.

## One-time setup (skip if the venv already exists)
```bash
bash .claude/skills/design-pass/scripts/setup-screenshots.sh
pnpm prisma:generate   # app needs the generated Prisma client to boot
```
The venv lives at `~/.cache/design-playwright-venv` (outside the repo). Real data
to design against is in `data/analyzer.db` (~90 conversations, 24 projects).

## The screenshot loop (the core mechanic)
**The user runs the dev server; you only screenshot it.** Do not start, stop, or
kill servers — that plumbing is fragile and unnecessary. Ask the user to run
`pnpm dev`, then capture a route in light + dark with one command:
```bash
.claude/skills/design-pass/scripts/capture.sh --name phaseN-slice --path "/"
```
Output → `design/screenshots/phaseN-slice-{light,dark}.png` (gitignored).
Then **Read the PNGs back** — actually look at them; "looks better" must be backed
by a screenshot you viewed, not assumed. `shoot.py --help` for routes/viewports.

### Server protocol — simple and safe
- **Exit 0** → captured against the user's running server.
- **Exit 2** (nothing on :3000) → **ask the user to run `pnpm dev`**, wait, retry.
  Never start or kill a server yourself.
- **Exit 3** → venv missing; run `scripts/setup-screenshots.sh` first.

## Process — run in order, stop at each gate for the user

**Phase 0 — Baseline.** Capture current screens (list `/`, a folder-scoped view
`/?folder=<key>`, the empty state) in light + dark. This is the "before".

**Phase 1 — Brief & IA** (use `frontend-design`; mostly thinking + a short plan).
State the page's single job. Decide the information architecture: what becomes a
distinct **section** and its priority. For this app the known gaps are: no
analysis/overview surface (it's an "Analyzer" showing only a flat 90-row table),
an inert sidebar (flat folder links, no counts/cost), and uniform density with no
hierarchy. Deliverable: ASCII wireframe(s) of the main view + rationale.
**Stop — user reacts to the wireframes before any code.**

**Phase 2 — Tokens & direction** (use `frontend-design`). Only after structure is
settled: type scale + roles, spacing/density, then a restrained palette and one
signature element — each justified for this subject, not a templated default.
**Stop — user approves the direction.**

**Phase 3 — Build in vertical slices.** Smallest-valuable-first (e.g. tokens →
sidebar → overview band → table hierarchy → empty/loading states → color/signature
last). For each slice: implement → screenshot light+dark → **self-critique against
the plan** (frontend-design's "remove one accessory") and iterate → run the gate
(below) → show before/after → user steers or approves.

**Phase 4 — Final pass.** Full-app sweep (all screens, both themes, responsive +
keyboard focus), last critique, clean commit.

## Validation gate (definition of done — every slice)
```
pnpm test    # TEST OK
pnpm lint    # LINT OK
pnpm fallow  # FALLOW OK
pnpm build   # BUILD OK
```
All four sentinels must print. Respect **ADR-0002**: no `next`/`react` imports in
`src/core`; the UI reaches core only through the app-zone readers.

## Principles
- Structure & hierarchy first; color and signature last.
- Pixels, not guesses — view every screenshot.
- Incremental & reversible — one reviewed slice at a time, gate stays green.
- Design around the real seeded data, never lorem ipsum.
- Keep boldness in one place; cut decoration that doesn't serve the brief.
