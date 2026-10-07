# Feature Specification: Azure DevOps unresolved PR threads

**Branch**: `feature/092-azdo-pr-comments` | **Issue**: #92 (part of #89)

## User Story 1 — Unresolved threads in azdo mode (P1)
`automata git get-pr-comments` (and `--json`) lists the unresolved file-anchored review threads of the PR of the
current branch in Azure DevOps mode, in the same human and JSON shape and with the same exit codes as GitHub mode.

## User Story 2 — fix-comments (P2)
`execute-prompt fix-comments` consumes the same list, so it works in azdo mode with no further change.

## Requirements
- FR-001 Map each thread to `PrComment`: `author` ← display name, `body` ← content, `path` ← `threadContext`,
  `line` ← `line`, `createdAt` ← `publishedAt`.
- FR-002 Unresolved = status `active` or `pending`; `fixed`, `wontFix`, `closed`, `byDesign` are skipped.
- FR-003 General (non-file) threads and system comments are excluded (`--code-related-only`, `--exclude-system`).
- FR-004 The "unsupported" outcome and the "GitHub only" help text and docs are removed.
- FR-005 Tests use recorded-shape fixtures: resolved, active, pending, system and general threads.

## Assumptions
- [AUTO] PR lookup: `azdo pr list --branch <b> --status active`, then `pr comments --pr-number <id>`; this gives the
  existing "no pull request found" outcome for a branch without PR (azdo's own auto-detection would fail instead).
- [AUTO] One comment per thread (first non-system), mirroring GitHub mode which reports the thread's first comment.
- [AUTO] A missing author is shown as `Unknown`, a missing date as an empty string.
- [AUTO] Author is a display name and is not used for authorization.
- [AUTO] Fixtures are hand-written from azdo-cli 0.20.0's output shape (read from its source); no live tenant available.
