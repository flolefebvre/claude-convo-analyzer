# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues. Use the `gh` CLI for all operations; multi-line bodies go through a heredoc. Infer the repo from `git remote -v` — `gh` does this automatically when run inside a clone.

## Reading issues

- **Read an issue**: `gh issue view <number> --comments` for the human-readable form. For machine-readable output use `--json` (`--jq` requires it), e.g. `gh issue view <number> --json title,body,labels,comments --jq '{title, body, labels: [.labels[].name], comments: [.comments[].body]}'`.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.

## Writing

- **Create an issue**: `gh issue create --title "..." --body "..."`.
- **Make an issue a sub-issue of a parent**: `gh issue create --parent <parent> ...`, or `gh issue edit <parent> --add-sub-issue <child>` afterwards (`gh` 2.94+). On an older `gh`: `gh api --method POST repos/<owner>/<repo>/issues/<parent>/sub_issues -F sub_issue_id=<child-db-id>`, where `<child-db-id>` is the child's numeric **database id** (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, _not_ the `#number` or `node_id`).
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`. Triage labels: `docs/triage-labels.md`.
- **Close**: `gh issue close <number> --comment "..."`

## Blocking relationships

Use GitHub's **native issue dependencies** — the canonical, UI-visible representation.

- **Add an edge**: `gh api --method POST repos/<owner>/<repo>/issues/<blocked>/dependencies/blocked_by -F issue_id=<blocker-db-id>` — the blocker's database id, as for sub-issues.
- **Remove an edge**: `gh api --method DELETE repos/<owner>/<repo>/issues/<blocked>/dependencies/blocked_by/<blocker-db-id>`.
- **Read blockers**: `gh api repos/<owner>/<repo>/issues/<n> --jq .issue_dependencies_summary.blocked_by`. This field is REST-only — `gh issue view --json` does not expose it. It counts **open** blockers only, so it is the live gate: an issue is unblocked when it reaches 0. To see _which_ issues block it, `gh api repos/<owner>/<repo>/issues/<n>/dependencies/blocked_by --jq '[.[] | {number, title, state}]'`.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents:

- **Read a PR**: `gh pr view <number> --comments` and `gh pr diff <number>` for the diff.
- **List external PRs for triage**: `gh api --paginate 'repos/{owner}/{repo}/pulls?state=open' --jq '.[] | select(.author_association | IN("OWNER","MEMBER","COLLABORATOR") | not) | {number, title, author: .user.login, author_association, labels: [.labels[].name]}'`.
- **Comment / label / close**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either — resolve with `gh pr view 42` and fall back to `gh issue view 42`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. `gh issue create --label wayfinder:map`.
- **Child ticket**: an issue linked to the map as a sub-issue (see **Make an issue a sub-issue of a parent**), labelled `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the driving dev.
- **Blocking**: native issue dependencies, as in **Blocking relationships**. A ticket is unblocked when every blocker is closed.
- **Frontier query**: list the map's open sub-issues (`gh api repos/<owner>/<repo>/issues/<map>/sub_issues --jq '[.[] | select(.state == "open") | {number, title, assignees: [.assignees[].login]}]'`), drop any with an assignee or an open blocker (**Read blockers**); first in map order wins.
- **Claim**: `gh issue edit <n> --add-assignee @me`, the session's first write.
- **Resolve**: `gh issue comment <n> --body "<answer>"`, then `gh issue close <n>`, then append a context pointer (gist + link) to the map's Decisions-so-far.
