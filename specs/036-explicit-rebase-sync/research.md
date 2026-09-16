# Phase 0 Research: Explicit branch-synchronisation strategy for `do-work`

**Feature**: `036-explicit-rebase-sync` | **Date**: 2026-09-16

Everything below that describes git behaviour was executed against the git binary installed in this container, not
recalled. The transcripts are summarised inline.

## The defect, reproduced

Issue #73 reports a local tip and a remote tip that are different commits with the **same parent and the same tree**.
Reproduced in a throw-away repository:

```text
local  = 4c00136…  tree 4bca68b…
remote = 435d8fe…  tree 4bca68b…
git cherry refs/remotes/origin/<branch> HEAD  →  "- 4c00136…"
git rebase refs/remotes/origin/<branch>       →  "Successfully rebased", HEAD == remote tip
```

`git pull --ff-only` refuses this, correctly — it is a genuine divergence. The existing force-push recovery in
`resetToForcePushedRemote` also refuses it, because the local tip was never reachable from the previously-known
remote-tracking ref: the local commit was created locally. So today the item is skipped as `pull-failed` on every tick,
permanently, even though the two tips carry byte-identical content.

## Decisions

### Decision 1 — The safety predicate is `git cherry`, guarded by a merge count

**Decision**: Classify `refs/remotes/origin/<branch>..refs/heads/<branch>` with `git cherry <upstream> <head>` and treat
the branch as safe to rebase only when the output is non-empty, every line is `-` (already upstream by patch-id), and
`git rev-list --count --merges <upstream>..<head>` is `0`.

**Rationale**: `git cherry` is git's own answer to "has this commit already been applied upstream", computed from
patch-ids — exactly the relationship issue #73 describes ("the normalized patch IDs were also identical"). Comparing
trees directly would only catch the single-commit case; comparing `rev-list` counts would catch nothing.

The merge guard is not decoration. Measured: a range holding one ordinary commit plus one merge commit reports
`rev-list --count` = 2, `--merges` = 1, and `git cherry` prints **one** line — it silently omits the merge. Without the
guard, a branch whose only unpushed content sits behind a local merge would classify as "everything is already
upstream" and be rebased away.

**Alternatives considered**:

- *`git merge-base --is-ancestor` only* — already in place as `resetToForcePushedRemote`, and by construction it cannot
  see this case.
- *Compare `HEAD^{tree}` with `origin/<branch>^{tree}`* — true in the reported reproduction, but it is a property of
  that one example, not of the class. Two equivalent commits applied in a different order have equal end trees and
  unequal intermediate ones; three commits where one is genuinely new have unequal end trees and would be refused
  correctly by patch-id anyway. Patch-id is the general predicate; equal trees is a coincidence of the report.
- *`git patch-id` invoked by hand over `rev-list`* — reimplements `git cherry` with more moving parts and the same
  answer.

### Decision 2 — `git rebase <remote-tracking ref>`, not `git pull --rebase`

**Decision**: Rebase with `git rebase refs/remotes/origin/<branch>` against the ref `preparePrBranch` already fetched.

**Rationale**: Two reasons, both from the issue. First, determinism: `git pull --rebase` still consults `rebase.*` and
`pull.*` configuration for *how* it rebases, and the whole complaint in #73 is that behaviour depended on the machine's
git configuration. A bare `git rebase <ref>` names the operation and the target outright. Second, cost: `preparePrBranch`
has already run `git fetch origin +refs/heads/<b>:refs/remotes/origin/<b>` a few lines earlier, so `git pull` would be a
second network round trip for a ref that is already local.

**Alternatives considered**:

- *`git config pull.rebase true` then `git pull`* — the literal workaround in the issue. Rejected: mutating the
  operator's git configuration from an unattended tool is a side effect outside the checkout, and it changes the
  behaviour of every other tool on that machine.
- *`git pull --rebase origin <branch>`* — correct but redundant with the fetch, and still configuration-sensitive.
- *`git reset --hard origin/<branch>`* — the outcome is identical **in the equivalent-commit case**, and it is what the
  force-push path already does. Rejected as the primary mechanism because it is destructive by construction: if the
  classification is ever wrong, a reset loses the commits while a rebase replays them and stops on a conflict. The
  weaker operation is the right default for the newer, less-proven predicate.

### Decision 3 — Genuinely unpushed commits are refused, not rebased

**Decision**: When any local-only commit is not already upstream, refuse the item and leave every ref where it is.

**Rationale**: A rebase would preserve the commits, so it is tempting. But rebasing them rewrites them, and the rewritten
branch can only reach the remote through a force push — which `do-work` does not do and whose safety rules
(`docs/do-work.md`, "never discards work it did not create") do not cover. The issue asks for the work to be *preserved
and reported*, which a refusal does exactly. The refusal message is upgraded to name the count and the inspection
command so the operator is not left to guess.

**Alternatives considered**: *Rebase and force-push* — rejected, outside the documented safety envelope, and it would
make `do-work` capable of rewriting a human's branch.

### Decision 4 — A conflicting rebase is aborted and gets its own reason

**Decision**: On a non-zero `git rebase`, run `git rebase --abort` and return a new `rebase-conflict` failure reason.

**Rationale**: Measured: `git rebase` exits `1` on a conflict and leaves the checkout on a detached HEAD with a `UU`
entry in the index; `git rebase --abort` exits `0` and restores the branch to the exact pre-rebase sha (verified by
comparing `rev-parse HEAD` before and after). Leaving the rebase in progress would make the *next* tick's
`hasUncommittedChanges` check report a dirty tree, converting one item's conflict into a repository-wide `dirty-tree`
for every item — the same "stuck forever" shape the feature exists to remove. The distinct reason is what the issue asks
for: "a distinct actionable failure instead of repeating the same skip forever".

**Alternatives considered**: *Leave the conflict for a human* — rejected for the cascade above. *Reuse `pull-failed`* —
rejected; it is the reason the original defect was hard to see in the logs.

### Decision 5 — Order of recovery: fast-forward → force-push reset → rebase

**Decision**: Try `git pull --ff-only` first, then the existing `resetToForcePushedRemote`, then the new rebase.

**Rationale**: The first two are cheaper and rest on stronger evidence (reachability, not patch equivalence). Putting
the new path last means it only ever runs where the current code already refuses, so no behaviour that works today can
regress.

**Alternatives considered**: *Rebase first, uniformly* — simpler to describe but it would replace two proven paths with
an unproven one for no gain.

### Decision 6 — The base branch stays fast-forward-only

**Decision**: `prepareBaseBranch` and `repoHygiene`'s `prepareBase` are unchanged.

**Rationale**: The issue asks for base-branch synchronisation to "remain safe and must not rewrite or discard unrelated
local work", and the documented contract is that a diverged base branch is a situation for a human. The base branch is
also not subject to the force-push churn that motivates the PR-branch path.

### Decision 7 — `checkoutAndPull`'s bare `git pull` becomes `git pull --ff-only`

**Decision**: The pull inside `checkoutAndPull` (used by `automata git finish-feature`) names `--ff-only`.

**Rationale**: `fatal: Need to specify how to reconcile divergent branches` — the first error quoted in the issue — is
what a bare `git pull` produces on a machine with no `pull.rebase`/`pull.ff` set. That call site is the only remaining
bare `git pull` in the CLI. Making it explicit turns a confusing configuration-dependent failure into the same "a
diverged branch is a situation for a human" message the rest of the code already gives, and satisfies FR-001/FR-010.

**Alternatives considered**: *Leave it alone* — rejected; it is the same defect class in a second place, and the issue's
expected behaviour is "pull strategy should be explicit and deterministic".

### Decision 8 — Operation-log shape

**Decision**: Add an optional `sync` field to `TickLogItem`, render it on the work-record line for items that ran the
executor, and append an aggregate `sync=<strategy>:<n>,…` field to the execution line for every item whose
synchronisation was not a plain fast-forward — which covers refusals, since those items never reach the work record.

**Rationale**: The work record's membership rule is "the executor ran", deliberately, so that it can never disagree with
`--max-runs`. A refused item therefore cannot appear there. The execution line is the aggregate, per-tick record and is
where a refusal count belongs. Omitting the field entirely when nothing interesting happened keeps the common line
unchanged for existing greps.

**Alternatives considered**: *Put refused items in the work record* — rejected, it breaks the documented equivalence
with `--max-runs`. *Fold the strategy into the existing `detail` string* — rejected, `detail` is free text truncated at
200 characters and is not greppable as a field.

### Decision 9 — Dependency refresh scope, and why TypeScript stays on 5.x

**Decision**: Move every direct dependency to the newest version this project can adopt; keep `typescript` on the latest
`5.x`.

**Rationale**: `npm audit` already reports zero vulnerabilities on `develop`, so this refresh is a currency exercise,
not a remediation. `npm outdated` lists `@types/node`, `prettier` and `vitest` as ordinary in-range refreshes and
`typescript` `5.9.3 → 7.0.2` as a major. Constitution principle II fixes the stack at "TypeScript 5.x (strict mode)";
adopting TypeScript 7 is a stack change that needs a constitution amendment and its own risk assessment (it is the
native-port compiler, and `typescript-eslint` support has to be verified against it). It is out of scope here and stays
as the open Dependabot pull request it already is.

**Note on `@types/node`**: `npm outdated`'s *Latest* column reads `22.20.3` because DefinitelyTyped tags `22.x` as
`latest`; the highest published version is `26.x`. This is recorded in `.specify/memory/speckit-memory.md` and the row
must be read as "behind within the `^26` range", not "ahead of latest".

**Alternatives considered**: *Take TypeScript 7 and revert if the gate fails* — rejected once the constitution was
re-read; shipping it green would still be an undeclared stack change. *Skip the refresh* — rejected, explicitly asked
for.

## Autonomous Decisions

Every decision above was taken without consulting the maintainer. The five that most change the shape of the feature are
mirrored in `spec.md`'s `## Assumptions` and `## Clarifications`: refusing rather than rebasing unpushed work
(Decision 3), no configuration key for the strategy (Decision 2), the base branch staying fast-forward-only
(Decision 6), the release being the maintainer's step (`CHANGELOG.md` `Unreleased` only), and TypeScript staying on
5.x (Decision 9).

## Measured git facts this feature depends on

| Fact | How it was established |
|---|---|
| `git cherry <up> <head>` prints `- <sha>` for a commit already applied upstream under a different sha | Reproduced the issue's shape; output was `- 4c00136…` |
| `git rebase <ref>` on that shape lands HEAD exactly on `<ref>` and skips the duplicate | `rev-parse HEAD` equalled `rev-parse refs/remotes/origin/<branch>` afterwards |
| `git cherry` **omits merge commits** | Range with 1 ordinary + 1 merge commit: `rev-list --count` = 2, `--merges` = 1, `cherry` printed 1 line |
| `git rebase` exits `1` on a conflict and leaves a detached HEAD with a `UU` index entry | `git status --porcelain=2 --branch` during the conflict |
| `git rebase --abort` exits `0` and restores the exact pre-rebase sha | `rev-parse HEAD` compared before and after |
| `npm audit` on `develop` reports 0 vulnerabilities | `npm audit` |
