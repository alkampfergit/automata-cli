# Feature Specification: Azure DevOps PR / work item write adapter

**Branch**: `feature/093-azdo-write-adapter` | **Issue**: #93 (part of #89) | **Depends on**: #90 foundation

## User Story 1 — Wire a PR to its work item (P1)
Code that finishes a piece of work can, in Azure DevOps mode, find the PR of a branch, link it to a work item
(`azdo pr work-items link` plus an `AB#<id>` reference in the description), rewrite its description, add a reviewer,
and post a comment on the PR.

## User Story 2 — Talk to the work item (P2)
The same code can comment on a work item (markdown) and assign it, through the same function shapes the GitHub
callers use.

## Requirements
- FR-001 `src/remote/writeService.ts` defines `RemoteWriteService` and `selectWriteService(config)`; the choice goes
  through `selectBackend` and an absent `remoteType` is GitHub.
- FR-002 `src/remote/azdoWriteService.ts` implements it with `azdo` via `spawnSync`, every call with
  `--no-update-check`, array argv (no shell).
- FR-003 PR descriptions and PR comments reach azdo on stdin (`--description-file -`, `--file -`), never argv.
- FR-004 Linking appends `AB#<id>` to the description unless already present (word boundary) and then links the work
  item; an already-linked work item is success.
- FR-005 A description over azdo's 4000-character limit fails before any call with a message naming the limit.
- FR-006 Failures throw with azdo's stderr, or a fallback naming the operation.
- FR-007 Unit tests stub `spawnSync`; no command is wired to the adapter.
- FR-008 `docs/azdo-gap.md` records every mapping and decision below.

## Assumptions
- [AUTO] Claim the PR: skipped (a no-op), not "add the agent as reviewer". Azure DevOps has no PR assignee; a reviewer
  entry would ask the agent to vote on its own work and clutter the reviewer list.
- [AUTO] Issue comment body: `azdo comments add <id> <text>` has no file/stdin form in 0.20.0, so the body is one
  argv element (no shell, so no quoting problem). Bodies over 30000 characters (Windows command-line limit) are
  refused rather than truncated.
- [AUTO] Reviewer: the caller supplies it (configuration is wired in Phase C); the adapter does not invent a Copilot
  equivalent and fails when none is given.
- [AUTO] `getCurrentBranchPr` returns `assignees: []` always, as PRs have no assignees.
- [AUTO] The posted issue comment returns its `url` if azdo reports one, else `undefined`.
- [AUTO] No live tenant: tests use recorded-shape stubs read from azdo-cli 0.20.0.
