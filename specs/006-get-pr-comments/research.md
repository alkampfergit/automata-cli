# Research: Get PR Open Comments

**Feature**: 006-get-pr-comments | **Date**: 2026-03-31

## Autonomous Decisions

### Decision 1: GitHub data source for review threads

- **Decision**: Use `gh pr view <branch> --json reviewThreads` to retrieve review thread data.
- **Rationale**: The `gh` CLI's `pr view` command already accepts a `reviewThreads` JSON field that returns all review threads with `isResolved`, `isOutdated`, and a `comments` sub-array containing `author.login`, `body`, `path`, `line`, and `createdAt`. This matches exactly what the spec requires and is consistent with how `get-pr-info` uses `gh pr view --json statusCheckRollup`.
- **Alternatives considered**: GitHub REST API via `gh api repos/{owner}/{repo}/pulls/{pr}/comments` — returns individual review comments but does not group them into threads or expose an `isResolved` flag; would require extra logic to correlate. GraphQL via `gh api graphql` — provides full `reviewThreads` structure but adds parsing complexity. `gh pr view --json reviewThreads` is the simplest single-call path.

### Decision 2: "Open comment" definition

- **Decision**: A comment is "open" if its parent thread has `isResolved === false`. Outdated threads (`isOutdated === true`) that are still unresolved are also included, because the reviewer comment is still visible and actionable.
- **Rationale**: Matches GitHub's own UI behaviour where outdated-but-unresolved threads appear in the "unresolved" count.
- **Alternatives considered**: Exclude outdated threads — would silently hide feedback the reviewer may still want addressed; chosen against to err on the side of completeness.

### Decision 3: JSON shape per thread entry

- **Decision**: Each entry in the JSON array represents the first (top-level) comment of an unresolved thread: `{ author, body, path, line, createdAt }`. `line` is `null` for file-level comments.
- **Rationale**: Users primarily need the root comment to understand what the reviewer flagged; reply bodies add noise. Consistent with the spec assumption.
- **Alternatives considered**: Include all replies — richer but significantly increases output volume for threads with long discussions; deferred to a future `--verbose` flag if ever needed.

### Decision 4: Azure DevOps gap — confirmed unsupported

- **Decision**: `azdo pr status --json` returns only `{ id, title, status, url }` per PR (confirmed by reading `src/config/azdoService.ts`). The `azdo` CLI has no command to list PR review threads or comments.
- **Rationale**: Direct inspection of the azdoService implementation shows `checks: []` is always returned, confirming no comment/thread data is available. Azure DevOps REST API (`/_apis/git/repositories/{id}/pullRequests/{id}/threads`) could provide this, but automata-cli's design principle avoids direct REST API calls that bypass the CLI layer.
- **Alternatives considered**: Direct Azure DevOps REST API call — would require storing and managing a PAT, which is out of scope and violates the simplicity principle.
- **Gap documented in**: `docs/azdo-gap.md` (Gap #3, added during implementation).

### Decision 5: Human-readable output format

- **Decision**: For each unresolved thread, print a block:
  ```
  [author] on path/to/file:42
  body text here
  ```
  Separated by blank lines. If no open comments: print `No open comments.`.
- **Rationale**: Mirrors the density of existing `formatChecks()` output — concise, scannable, no excessive borders or headers. File and line on the same line as the author reduces vertical noise.
- **Alternatives considered**: Table format — too wide for long file paths; numbered list — adds visual clutter when there are many threads.
