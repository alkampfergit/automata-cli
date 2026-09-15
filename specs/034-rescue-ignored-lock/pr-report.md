# PR Report: Rescue survives an ignored run lock, and pre-flight failures are reported separately

**Branch**: `feature/034-rescue-ignored-lock`
**Date**: 2026-09-15
**Spec**: [specs/034-rescue-ignored-lock/spec.md](../../specs/034-rescue-ignored-lock/spec.md)

## Summary

In a checkout that adds `.automata/automata.lock` to its `.gitignore`, `do-work`'s pre-flight rescue
could not stage anything: naming an ignored path in a pathspec makes `git add` exit 1 even though it
staged everything correctly. The rescue therefore aborted, the working tree stayed dirty, and every
discovered issue was skipped as `dirty-tree`. This makes the rescue drop exclusions git already ignores,
stops it from leaving an empty recovery branch behind, and carries the pre-flight rescue and base-branch
failures onto the per-item skip lines so the two causes can be read apart.

## What's New

- **`gitService.stageAllExcept`**: filters its exclusions through a new `pathIsIgnored()`
  (`git check-ignore -q -- <path>`) and drops the ones git already ignores, falling back to the bare
  `git add -A` form when nothing is left. `check-ignore` consults the index, so an exclusion for a path
  the repository *tracks* survives even when a `.gitignore` pattern matches it — the run lock is still
  never committed. A `check-ignore` that fails for any other reason keeps the exclusion, which is
  exactly the pre-change behaviour.
- **Pre-flight rescue ordering**: staging now happens before the `rescue/…` branch is created. A
  staging failure leaves no empty branch, which is what made the reported run announce a recovery
  branch the operator could not find.
- **Prune protection**: the branch the rescue created — or, in a dry run, would create — is off limits
  to the same tick's prune phase. Previously an empty branch left by a failed rescue read as "nothing
  outside the base branch" and was deleted while the work it was made for was still uncommitted.
- **`RescueOutcome`**: the `failed` variant became a named `RescueFailure` interface carrying an
  optional `branch` — the branch the rescue was committing onto, once it exists in the checkout — and
  an optional `createdBranch`, set when that branch is one the rescue itself created. A failure past
  that point names the branch in the log, in the `--json` `preflight` object, in the tick summary and
  in the per-item skip.
- **`describeRescueRemains(rescue)`**: new export saying where a failed rescue left the work, per step
  — the tree for a `stage`, `branch` or `commit` failure, a local commit for a `push` failure, an
  unreviewed pushed branch for a `pr` failure. Shared by the skip suffix and the tick summary so the
  two cannot drift, and so the summary stops claiming "the tree is still dirty" about a rescue that
  had in fact committed and pushed.
- **`describePreflightFailures(report)`**: new export returning the rescue failure and the
  base-preparation failure as two independent, human-readable causes.
- **Per-item skips in `do-work`**: when the pre-flight failed, the skip progress line, the tick
  summary's detail and the operation log entry all carry ` [pre-flight: …]` naming every cause. With a
  clean pre-flight the wording is unchanged.
- **`docs/do-work.md`**: documents the ignored-lock behaviour, the stage-before-branch ordering and the
  prune exemption, adds a "Recovering a base branch that will not fast-forward" section with the
  inspection commands and all three recovery paths, and shows the new skip-line format.

## Testing

- **Integration (real `git`, `tests/unit/stageAllExcept.git.test.ts`)**: builds a scratch repository
  matching the reported checkout — dirty tracked file, untracked file, gitignored
  `.automata/automata.lock` — and asserts staging succeeds and commits both files but not the lock.
  Also covers a repository that does not ignore the lock, one that both tracks and ignores it, and
  pins the underlying git behaviour so a future reinstatement of the pathspec cannot pass silently.
  Mocking `spawnSync` could never have caught this defect; only git can say what git does.
- **Unit (`tests/unit/gitService.hygiene.test.ts`)**: `pathIsIgnored` argv and its fail-closed
  behaviour; `stageAllExcept` dropping only the ignored exclusions, keeping the rest, and keeping a
  tracked one.
- **Unit (`tests/unit/repoHygiene.test.ts`)**: no branch created when staging fails; the recovery
  branch named on a later failure; the reported tick running to a completed rescue; the rescue's branch
  not deleted when the push failed, when it is empty after a failed commit, or under `--dry-run`; a
  pre-existing branch still subject to the normal prune rules; and `describePreflightFailures` across
  clean, rescue-only, base-only and both-failed reports.
- **Unit (`tests/unit/doWork.cmd.test.ts`)**: a skipped item's progress line and summary detail carry
  the rescue cause, carry both causes when the base pull also failed, and are byte-for-byte unchanged
  after a clean pre-flight.
- **Unit (`describeRescueRemains`)**: every step's wording pinned directly, since the tick summary is
  the only report an operator gets when no item was blocked.
- **Full suite**: `npm test` (1058 tests, 33 files) and `npm run lint` pass; `npm run build` succeeds.

## Notes

- Behaviour for a diverged base branch is deliberately unchanged — `git pull --ff-only` still refuses,
  because deciding what to do with a local-only commit on the base branch is a human judgement. Only
  the reporting and the documentation changed.
- `PrepareFailureReason` was left a closed union on purpose; the pre-flight cause is appended to the
  existing reasons rather than introducing a new one, since the JSON output and the operation log
  consume those values.
- Review round (Copilot on PR #70), all three addressed: the commit-step failure now names its branch
  on the log line and in the summary, not only in the skip suffix; the `docs/do-work.md` branch-
  selection bullet and the skip-line example were corrected to match the stage-before-branch ordering
  (the old example showed a `stage` failure naming a branch, which that ordering makes impossible);
  and the diverged-base-branch section now says which turns are actually stopped — `issue-discuss`
  items prepare the base branch and skip, while `pr-work` and `pr-orphan` items prepare their own head
  branch and still run.
