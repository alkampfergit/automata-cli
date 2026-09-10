# Phase 0 Research: `do-work` pre-flight repository hygiene

**Feature**: `feature/032-do-work-repo-hygiene` | **Date**: 2026-09-10

---

## Decision: where the pre-flight lives

**Decision**: A new module `src/git/repoHygiene.ts` exporting `runRepoHygiene(options)`, called
once from `runTick` in `src/commands/doWork.ts`. Low-level git and `gh` invocations are added to
`src/git/gitService.ts` and `src/github/ghWorkService.ts`.

**Rationale**: Both service modules own a private `spawnSync` runner (`gitService.ts:77`,
`ghWorkService.ts:152`); adding a third would duplicate the `ENOENT` → "CLI is not installed"
handling the constitution's no-duplication rule forbids. Keeping the policy out of those files
also keeps it unit-testable by mocking the service module, which is how
`tests/unit/workspaceService.test.ts` already tests the per-item sequencer.

**Alternatives considered**:

- *Inline in `doWork.ts`* — rejected: the file is already 1253 lines and its tests mock whole
  modules, so inlined policy could only be tested through the command surface.
- *Extend `workspaceService.ts`* — rejected: that module's documented contract is "every
  function here refuses before touching git when the tree is dirty", which is the exact
  opposite of the rescue step's job. Overloading it would make that comment false.

---

## Decision: how "has no remote" is determined

**Decision**: One `git ls-remote --heads origin` per tick, parsed into a set of branch names, and
a local branch is a candidate when its name is absent from that set. Verified output shape:
`<sha>\trefs/heads/<name>` per line.

**Rationale**: Answers the issue's "has no remote" directly and independently of whether an
upstream was ever configured locally — a branch created by `git checkout -b` on another machine
and copied over has no upstream but may well exist on `origin`. One network round trip instead
of one per branch. The existing `isUpstreamGone(branch)` does the same query per branch and is
kept as-is for `finish-feature`, which only ever asks about one.

**Alternatives considered**:

- *`git for-each-ref --format='%(upstream:track)'` looking for `[gone]`* — rejected: `gone` only
  appears after a `git fetch --prune` has run, so a branch whose remote was deleted elsewhere
  reads as healthy until then, and a branch with no upstream configured reads as empty rather
  than gone. Two false answers in the cases that matter most.
- *Calling `isUpstreamGone` per branch* — rejected: N network calls where one suffices, on a
  step that runs on every tick.

---

## Decision: delete only what the base branch already contains

**Decision**: For a candidate with no open pull request, run
`git rev-list --count <base>..<branch>`. `0` means every commit is already reachable from the
base branch → `git branch -D`. Non-zero → push the branch, open a draft pull request, keep it.

**Rationale**: The issue asks for unconditional `-D`, but its own stated purpose is "so the user
can avoid losing work", and `do-work`'s documented contract is that it never discards work it
did not create. `rev-list --count` makes the safe case provable rather than assumed, and it
costs one local call. The unsafe case becomes idempotent: after the rescue the branch has a
remote and an open pull request, so the next tick keeps it without doing anything.

**Alternatives considered**:

- *Unconditional `git branch -D`* — rejected for the reason above. Raised explicitly on issue
  #47 and answered "sounds ok proceed".
- *`git branch -d` (safe delete)* — rejected: it refuses on any branch not merged into the
  *current* branch and prints a message rather than telling us what to do next, so we would
  still need the reachability count to decide whether to rescue. It also fails on a
  squash-merged branch, which is the single most common case in this repository — the base
  branch contains the change but not the commit.

---

## Decision: rescue target branch

**Decision**: If HEAD is a branch other than the base branch, commit onto it. If HEAD is the base
branch or detached, create `rescue/<source>-<YYYYMMDDTHHMMSSZ>` off HEAD first. Then
`git push -u origin <branch>`, then ensure an open pull request exists.

**Rationale**: Committing onto the branch the work already belongs to avoids spawning a parallel
branch for changes that are plainly part of an in-flight feature — the common case, since
`do-work` leaves the checkout on the pull-request branch it last worked. It also makes the step
self-limiting: the branch then has a remote and an open pull request, so neither the rescue nor
the prune touches it again. A `rescue/*` branch is only needed when the alternative would be
committing to the base branch, which `do-work` must never do.

**Alternatives considered**:

- *Always create `rescue/<base>-<ts>`* — the original sketch on the issue; rejected as a
  refinement: it would fork a second branch off an in-flight feature branch and leave the
  reviewer two pull requests for one change.
- *`git stash` and restore later* — rejected outright: a stash is invisible to the remote, so an
  interrupted or crashed tick loses it, which is the failure the feature exists to prevent.

---

## Decision: pull-request shape and `gh` invocations

**Decision**: `gh pr create --draft --head <branch> --base <base> --title <t> --body <b> --label rescue`,
retried once without `--label` if the label does not exist. Lookup with
`gh pr list --head <branch> --state all --json number,state,url,updatedAt`, newest `updatedAt`
first. Verified against this repository: the payload is a JSON array, empty when there is none,
and `state` is one of `OPEN` / `CLOSED` / `MERGED`.

**Rationale**: `--head` means neither call needs the branch checked out, so the prune step never
moves the working tree. Draft keeps rescue pull requests out of review queues. The label is
cosmetic, so a repository that has not defined it must not break the rescue — hence the retry
rather than pre-creating the label, which would be a write to repository settings the feature
was not asked to make.

No exclusion from work detection is needed: detection is issue-driven and maps pull requests to
issues through closing references (`getOpenPrLinkMap`), and a rescue pull request deliberately has
none, so it can never be selected as an issue's pull request.

**Alternatives considered**:

- *Reuse `getCurrentBranchPr` from `config/githubService.ts`* — rejected: it wraps
  `gh pr view`, which resolves only the *default* (open, else most recent) pull request and
  distinguishes "none" from an error by matching English stderr text. The prune decision needs
  every state for a named head, which is `gh pr list`'s job.
- *`gh pr create --fill`* — rejected: it derives the title and body from the commits, which for a
  rescue would produce a title indistinguishable from a real feature.
- *Non-draft pull request* — rejected: it would notify reviewers and, in this repository, start
  a CI run on work that was never claimed to be finished.

---

## Decision: staging the rescue commit

**Decision**: `git add -A -- . ':(exclude)<run lock path>'` then `git commit -m <message>`.

**Rationale**: `-A` is the only form that stages untracked files, deletions and modifications
together, and the dirtiness test the rescue triggers on (`hasUncommittedChanges([RUN_LOCK_RELATIVE_PATH])`)
counts exactly those. The pathspec exclusion mirrors that test's own exclusion, so the lock file
automata created for this very run is not committed — without it, the rescue would commit a lock
naming a pid, and the next tick would find the tree dirty again for a file it just committed.

**Alternatives considered**:

- *`git commit -a`* — rejected: it does not stage untracked files, so the tree stays dirty and
  every item still skips.
- *Gitignoring the lock instead* — rejected: this repository's own `.gitignore` is not something
  the feature should change on a user's behalf, and the exclusion pathspec already exists as the
  established pattern.

---

## Decision: failure and exit-code semantics

**Decision**: Any pre-flight failure is reported, sets a `degraded` flag on the report, and lets
the tick continue. A degraded pre-flight forces exit 2 where the tick would otherwise exit 0.
Exit 1 keeps its documented meaning.

**Rationale**: Exit 1 is documented as "a precondition or configuration check failed. Nothing was
attempted", which would be a lie once discovery and items have run. Exit 2 already means "the
tick ran but something was not clean", and a failed rescue leaves the pre-existing per-item
`dirty-tree` skip in place, so nothing unsafe happens — the operator just needs to know.

**Alternatives considered**:

- *Abort the tick on a failed rescue* — rejected: it would convert today's degraded-but-working
  tick into a hard stop, a regression for anyone whose remote is briefly unreachable.
- *A new exit code 3* — rejected: cron consumers key on the documented 0/1/2 contract.

---

## Decision: ordering, and the run lock

**Decision**: Inside the run lock, before issue discovery: rescue → checkout + pull base → prune
→ discovery → items. Per-item `prepareBaseBranch` / `preparePrBranch` are left untouched.

**Rationale**: The rescue must precede the prune so a branch whose commits are about to be pushed
is not a deletion candidate, and it must precede the base checkout because it operates on the
current HEAD. The prune must precede the items so it cannot delete a branch a run has just
created, and it must follow the base checkout so the "never delete the current branch" rule
resolves to "never delete the base branch". The lock is required because every step writes to the
checkout; a dry run takes no lock and mutates nothing, matching the existing behaviour.

Per-item preparation stays because those calls are also the per-item dirty-tree guard — an
executor that leaves changes behind must still not have the next item started on top of them.
The cost is one extra fast-forward pull that is already up to date.

**Alternatives considered**:

- *Hoist the per-item base checkout out entirely* — the original sketch; rejected on inspection:
  `prepareBaseBranch` is what stops item N+1 running on item N's leftovers, and removing it
  would trade a real guard for one cheap call.
- *Run the pre-flight before taking the lock* — rejected: two concurrent ticks would race on
  `git checkout` in the same working tree.

---

## Autonomous Decisions

Every decision above was made without user input, as `speckit-full` requires. The two questions
that had been put to the maintainer on issue #47 — force-delete vs rescue, and the pull-request
shape — were answered "sounds ok proceed", i.e. the recommendation in that comment stands; both
are recorded above with their rationale, and the one place where the design was narrowed relative
to that comment (rescue target branch) is called out as such.
