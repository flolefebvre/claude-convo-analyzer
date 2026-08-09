# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues. Use the `gh` CLI for all operations; multi-line bodies go through a heredoc. Infer the repo from `git remote -v` — `gh` does this automatically when run inside a clone.

## Reading issues

- **Read an issue**: `gh issue view <number> --comments` for the human-readable form. For machine-readable output use `--json` (`--jq` requires it), e.g. `gh issue view <number> --json title,body,labels,comments --jq '{title, body, labels: [.labels[].name], comments: [.comments[].body]}'`.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.

## Writing

- **Create an issue**: `gh issue create --title "..." --body "..."`.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

## Blocking relationships

Use GitHub's **native issue dependencies** — the canonical, UI-visible representation.

- **Add an edge**: `gh api --method POST repos/<owner>/<repo>/issues/<blocked>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker's numeric **database id** (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, _not_ the `#number` or `node_id`).
- **Remove an edge**: `gh api --method DELETE repos/<owner>/<repo>/issues/<blocked>/dependencies/blocked_by/<blocker-db-id>` — the database id again, not the `#number`.
- **Read blockers**: `gh api repos/<owner>/<repo>/issues/<n> --jq .issue_dependencies_summary.blocked_by`. This field is REST-only — `gh issue view --json` does not expose it. It counts **open** blockers only, so it is the live gate: an issue is unblocked when it reaches 0. To see _which_ issues block it, `gh api repos/<owner>/<repo>/issues/<n>/dependencies/blocked_by --jq '[.[] | {number, title, state}]'`.

## Labels

The skills' canonical labels — `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`, and the `prd` type label — exist under those exact names; use them as-is. When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the matching label directly.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents:

- **Read a PR**: `gh pr view <number> --comments` and `gh pr diff <number>` for the diff.
- **List external PRs for triage**: `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments` then keep only `authorAssociation` of `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, or `NONE` (drop `OWNER`/`MEMBER`/`COLLABORATOR`).
- **Comment / label / close**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either — resolve with `gh pr view 42` and fall back to `gh issue view 42`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.
