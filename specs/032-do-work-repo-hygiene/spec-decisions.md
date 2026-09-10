# Spec Decisions: `do-work` pre-flight repository hygiene

**Branch**: `feature/032-do-work-repo-hygiene`
**Date**: 2026-09-10
**Spec**: [specs/032-do-work-repo-hygiene/spec.md](../../specs/032-do-work-repo-hygiene/spec.md)
**Plan**: [specs/032-do-work-repo-hygiene/plan.md](../../specs/032-do-work-repo-hygiene/plan.md)
**Research**: [specs/032-do-work-repo-hygiene/research.md](../../specs/032-do-work-repo-hygiene/research.md)

## Planning Decisions

- **Where the pre-flight lives**: a new `src/git/repoHygiene.ts` holding the sequencing and the
  keep/delete/rescue decisions, with the git and `gh` invocations added to
  `src/git/gitService.ts` and `src/github/ghWorkService.ts`. **Rationale**: those two modules
  already own private `spawnSync` runners with the `ENOENT` → "CLI is not installed" handling, so
  a third runner would duplicate it; keeping the policy outside them makes it unit-testable by
  mocking the service module, exactly as `tests/unit/workspaceService.test.ts` already does.
  **Alternatives considered**: inlining it in `doWork.ts` (already 1253 lines, and its tests mock
  whole modules, so inlined policy could only be tested through the command surface); extending
  `workspaceService.ts` (its documented contract is "refuses before touching git when the tree is
  dirty" — the exact opposite of the rescue step's job).

- **Detecting "has no remote"**: one `git ls-remote --heads origin` per tick, parsed into a set of
  branch names; a local branch is a candidate when its name is absent from that set.
  **Rationale**: it answers the requirement directly and independently of whether an upstream was
  ever configured locally, in one network round trip rather than one per branch.
  **Alternatives considered**: `%(upstream:track)` looking for `[gone]` (only true after a
  `fetch --prune`, and empty rather than gone for a branch with no upstream — false answers in
  both cases that matter); calling the existing per-branch `isUpstreamGone` N times.

- **Deleting only what the base branch already contains**: for a candidate with no open pull
  request, `git rev-list --count <base>..<branch>` decides — `0` deletes, non-zero pushes the
  branch, opens a draft pull request and keeps it. **Rationale**: the issue asked for
  unconditional `git branch -D`, but its stated purpose is avoiding lost work and `do-work`'s
  documented contract is that it never discards work it did not create; the count makes the safe
  case provable, and the unsafe case becomes idempotent because the branch then has a remote and
  an open pull request. **Alternatives considered**: unconditional `-D` (raised on issue #47 and
  answered "sounds ok proceed"); `git branch -d`, which fails on a squash-merged branch — the most
  common case in this repository, where the base branch has the change but not the commit.

- **Rescue target branch**: commit onto the branch already checked out when it is not the base
  branch; create `rescue/<source>-<YYYYMMDDTHHMMSSZ>` only from the base branch or a detached
  HEAD. **Rationale**: it keeps the work on the branch it belongs to instead of forking a parallel
  branch off an in-flight feature, and it makes the step self-limiting — the branch then has a
  remote and an open pull request, so neither step touches it again. **Alternatives considered**:
  always creating a `rescue/*` branch (would leave the reviewer two pull requests for one change);
  `git stash` (invisible to the remote, so an interrupted tick loses it — the exact failure the
  feature exists to prevent).

- **Pull-request shape**: draft, against the base branch, labelled `rescue` best-effort with a
  single retry without the label, created with `gh pr create --head <branch>` so no checkout is
  needed; looked up with `gh pr list --head <b> --state all`. **Rationale**: draft keeps rescue
  pull requests out of review queues; `--head` means the prune step never moves the working tree;
  a repository that has not defined the label must not break the rescue. No work-detection
  exclusion is needed because detection maps pull requests to issues through closing references
  and a rescue pull request deliberately has none. **Alternatives considered**: reusing
  `getCurrentBranchPr` (wraps `gh pr view`, which resolves only the default pull request and
  detects "none" by matching English stderr text); `gh pr create --fill` (title indistinguishable
  from a real feature); a non-draft pull request (notifies reviewers and starts CI).

- **Staging the rescue commit**: `git add -A -- . ':(exclude)<run lock path>'`. **Rationale**: `-A`
  is the only form that stages untracked files, deletions and modifications together, which is
  exactly what the dirtiness test counts; mirroring that test's own lock exclusion stops the
  rescue committing the lock file naming this run's pid, which would leave the next tick dirty
  again. **Alternatives considered**: `git commit -a` (leaves untracked files, so the tree stays
  dirty and every item still skips); gitignoring the lock (a change to the user's repository the
  feature was not asked to make).

- **Failure and exit-code semantics**: a pre-flight failure is reported, marks the report
  degraded, and lets the tick continue; a degraded pre-flight forces exit 2 where the tick would
  otherwise exit 0, and exit 1 keeps its meaning. **Rationale**: exit 1 is documented as "nothing
  was attempted", which would be false once discovery and items have run, and a failed rescue
  leaves the pre-existing per-item `dirty-tree` skip in place so nothing unsafe happens.
  **Alternatives considered**: aborting the tick (turns today's degraded-but-working tick into a
  hard stop when the remote is briefly unreachable); a new exit code 3 (cron consumers key on the
  documented 0/1/2 contract).

- **Ordering, and keeping per-item preparation**: inside the run lock, rescue → checkout + pull
  base → prune → discovery → items, with `prepareBaseBranch` / `preparePrBranch` left untouched.
  **Rationale**: the rescue must precede the prune so a branch about to be pushed is not a
  deletion candidate; the prune must precede the items so it cannot delete a branch a run just
  created, and follow the base checkout so "never delete the current branch" resolves to "never
  delete the base branch"; the per-item calls are also the guard that stops item N+1 running on
  item N's leftovers. **Alternatives considered**: hoisting the per-item checkout out entirely
  (the original sketch — it would trade a real safety guard for one cheap already-current pull);
  running the pre-flight before taking the lock (two concurrent ticks would race on
  `git checkout` in one working tree).

- **Project structure**: single project, flat modules under `src/`, `repoHygiene.ts` beside
  `workspaceService.ts`. **Rationale**: they are the same kind of thing — a sequencer over
  `gitService`'s runner — differing only in scope (whole-tick vs per-item), and the constitution
  prefers a flat module structure. **Alternatives considered**: a `src/git/hygiene/` subdirectory
  (nesting for one module); putting the policy in `gitService.ts` (which owns the runner and must
  stay free of policy).

- **No new configuration key and no new CLI flag**: the behaviour is unconditional and inspectable
  through the existing `--dry-run`. **Rationale**: the issue asked for it unconditionally, and in
  this repository every new config key must be reachable both from `automata config set` and from
  the wizard — a cost not justified here. **Alternatives considered**: a `doWork.hygiene` config
  section and a `--no-prune` flag.
