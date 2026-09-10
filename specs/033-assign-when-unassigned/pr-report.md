# PR Report: Claim an unassigned issue and pull request for the agent

**Branch**: `feature/033-assign-when-unassigned`
**Date**: 2026-09-10
**Spec**: [specs/033-assign-when-unassigned/spec.md](../../specs/033-assign-when-unassigned/spec.md)

## Summary

The assignee column now answers one question consistently: is anyone on this? When
`do-work` picks up an issue or works on its pull request, the agent account is added
only if that surface has no assignee at all — and an issue or pull request somebody
already owns is left completely untouched. This replaces the previous rule, which
added the agent even to an issue a human had taken, and extends the claim to the pull
request, which nothing assigned before.

## What's New

- **Turn decision (`src/github/workDetection.ts`)**: `needsAssignment` is now
  `issueSurface.assignees.length === 0` instead of "the agent is not among the
  assignees", and a new `prNeedsAssignment` says the same about the pull request a
  build turn works on. Both live on `WorkItem`, so the dry-run plan and the real claim
  read the same fact. `isAssignedToAgent()` is deleted — membership is no longer part
  of the rule, and leaving the comparison behind would invite the old behaviour back.
- **Pull-request claim (`src/github/ghWorkService.ts`)**: new `assignPrToAgent()`
  running `gh pr edit <n> --add-assignee <login>`, and `PrSurface` now carries
  `assignees`, fetched with the surface `do-work` already reads — no extra `gh` call.
  `gh issue edit` is not reused for a pull request: its `updateIssue` GraphQL mutation
  does not accept a pull-request node.
- **`do-work` (`src/commands/doWork.ts`)**: a build turn claims its pull request next
  to the existing issue claim; a discuss turn claims the pull request the model opened
  inside `repairIssueLink()`, where that pull request is first visible. Both are
  advisory in the same shape as the existing `claimIssue` — a warning, and the turn
  keeps its outcome and exit code.
- **Current-branch pull request (`src/config/githubService.ts`)**:
  `getCurrentBranchPr()` also returns `assignees` (normalised, absent → `[]`), which
  is what lets the post-run claim decide without a second lookup.
- **Plan reporting**: the dry-run header's `Assign` line and the plan's per-item
  suffix name both surfaces in every state (`issue already assigned · would assign
  pull request #57 to automata-bot`), and `--dry-run --json` carries
  `prNeedsAssignment` per entry. A dry run still writes nothing.
- **`implement-next` (`src/commands/getReady.ts`)**: claims the pull request it caused
  to be opened, for `config.agentUser` or `@me` when none is configured, through the
  existing best-effort `warnOnFailure()` wrapper.
- **Docs**: `docs/do-work.md`'s Assignment section is rewritten as a per-surface table
  with the empty-list rule, the independence of the two surfaces, and the advisory
  contract; `docs/implement-next.md` documents the new post-run claim. `README.md` is
  untouched — no install, quick-start, command-table or dev-setup change.

## Breaking Changes

- **`do-work` no longer adds the agent to an issue a human already owns.** This is the
  point of the change, but it is a behaviour reversal: a workflow that relied on the
  agent appearing alongside a human assignee will not see it any more. Nothing is ever
  un-assigned, so no existing assignment is lost.
- **`do-work --dry-run --json` plan entries gain a `prNeedsAssignment` field.**
  Additive, but a consumer comparing the whole object for equality will see a
  difference. The human-readable `Assign` line also changed wording
  (`would assign to X` → `would assign issue to X`, plus a pull-request half).

## Testing

- **Unit — decision rule** (`tests/unit/workDetection.test.ts`): the four issue states
  (empty, human, agent, both) and the three pull-request states (unassigned build
  turn, assigned build turn, discuss turn). The two pre-existing assignment tests were
  rewritten to the new rule rather than deleted.
- **Unit — `gh` wrappers** (`tests/unit/ghWorkService.test.ts`,
  `tests/unit/githubService.test.ts`): assignee flattening on `getPrSurface` and
  `getCurrentBranchPr`, absent-field → `[]`, the exact argv of `assignPrToAgent`
  (`pr edit … --add-assignee`), and its failure messages. The `--json` field lists are
  asserted, so a dropped field fails the suite.
- **Command level** (`tests/unit/doWork.cmd.test.ts`): claim/skip on both turn kinds,
  the discuss-turn claim of a newly opened pull request, an advisory failure that
  warns and still runs the turn and still links the pull request, the dry-run text in
  each assignment state, and that a dry run calls neither assign function.
- **Command level** (`tests/unit/getReady.cmd.test.ts`): `implement-next` claims with
  `agentUser`, falls back to `@me`, skips an already-assigned pull request, and warns
  on failure. The `gh` stub dispatches on argv rather than call order, because the
  post-run path issues several `pr` calls whose order is an implementation detail.
- **Gates**: `npm test` → 823 passed / 28 files; `npm run lint` (via `rtk proxy`, so
  the real `eslint src/` gate) → clean. Touched test files typechecked explicitly with
  `tsc --noEmit --strict`, since `tsconfig.json` covers only `src` and vitest does not
  typecheck.
- **Not done**: no live `gh` run against a real repository. Every GitHub interaction
  here is a write to an issue or pull request, so it was verified at the argv level
  instead; `gh pr edit --add-assignee` and `gh pr view --json assignees` were checked
  against the installed `gh` binary rather than from memory. `specs/033-assign-when-unassigned/quickstart.md`
  records the manual sequence for a maintainer who wants the live check.

## Notes

- Two pre-existing type errors in the test files touched here were fixed in passing
  (a `ReviewThread` fixture missing `url`, an `IssueSurface` fixture missing `labels`),
  so both files now typecheck under `--strict`. No test behaviour depends on either.
- The five `src/` files edited already failed `prettier --check` on `develop` and still
  do; verified by stashing. Per `AGENTS.md` the gate is `npm test && npm run lint`, and
  a repo-wide reformat would bury this diff.
- **Deferred**: `implement-next` does not claim the *issue* it picks up — only the pull
  request. Issue claiming on a human-driven command was not part of the request; say
  the word and it is a three-line follow-up.
- Race window: the claim decision uses the state read at the start of the item, so
  somebody assigning themselves during a long run can end up beside the agent. The
  underlying calls are additive, so nothing is lost, and the next tick sees the
  non-empty list and stops claiming.
