# Research: 183 clean-branches

## Decision: authoritative remote list from `git ls-remote`

- Decision: use `listRemoteBranches()` (`null` when the remote cannot be asked) for both phases, after
  `fetch --prune origin`.
- Rationale: it already keeps "unknown" apart from "no branches", so an unreachable remote deletes nothing.
- Alternatives considered: `refs/remotes/origin/*` (stale if the fetch is skipped).

## Decision: pure plan, then execute

- Decision: build the whole plan as data, print it, confirm once, then execute.
- Rationale: `--dry-run`, the prompt and the tests all use the same plan; matches `planRelease()`.
- Alternatives considered: delete while iterating (no dry run, no single prompt).

## Decision: same-repo pull requests only

- Decision: query `gh pr list --head <b> --state all --json number,state,isCrossRepository` and drop cross-repo ones.
- Rationale: `--head` matches the branch name only; a fork branch of the same name must not decide.
- Alternatives considered: reuse `listPullRequestsForHead` (has no fork field).

## Decision: lookup failure keeps the branch and gives exit 1

- Decision: report `keep (pull request lookup failed)` and count it as a failure.
- Rationale: an unauthenticated `gh` would otherwise exit 0 with every branch kept, a silent no-op.
- Alternatives considered: skip silently.

## Autonomous Decisions

See the Clarifications section of `spec.md`.
