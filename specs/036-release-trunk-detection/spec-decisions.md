# Spec Decisions: Release Trunk Detection

**Branch**: `feature/036-release-trunk-detection`
**Date**: 2026-09-18
**Spec**: [specs/036-release-trunk-detection/spec.md](spec.md)
**Plan**: [specs/036-release-trunk-detection/plan.md](plan.md)
**Research**: [specs/036-release-trunk-detection/research.md](research.md)

## Planning Decisions

Every git behaviour these decisions rest on was probed against two throwaway repositories — a full
clone and a `git clone --single-branch --branch develop` clone, the shape reported in issue #76 —
rather than assumed. The probe table is in [research.md](research.md).

- **Trunk resolution order** (D-001): config override → `git symbolic-ref refs/remotes/origin/HEAD` →
  `git ls-remote --symref origin HEAD` → probe `main`/`master` on the remote. **Rationale**: all four
  rungs are needed — `origin/HEAD` is free and local but is *absent exactly in the reported
  scenario*, so it cannot stand alone; `ls-remote --symref` answers in both clone shapes but costs a
  network round-trip, so it sits below the local check; the probe covers a remote advertising no HEAD
  symref. **Alternatives considered**: `ls-remote` only (a network call even when a local ref has the
  answer); probing `main`/`master` only (cannot serve any other trunk name, which is the class of bug
  being fixed); reading `git config remote.origin.HEAD` (not written by `clone` in either shape
  tested).
- **Fetch refspec** (D-002): `git fetch --tags origin +refs/heads/<trunk>:refs/remotes/origin/<trunk>`
  rather than `git fetch --tags origin <trunk>`. **Rationale**: a single-branch clone's configured
  refspec covers only `develop`, so the bare form updates `FETCH_HEAD` but never creates
  `refs/remotes/origin/<trunk>` — and the whole design reads from that ref. **Alternatives
  considered**: describing `FETCH_HEAD` (leaves nothing for the checkout step or the behind-check);
  `git remote set-branches --add` (permanently mutates repository config, and would run under
  `--dry-run`, which must write nothing).
- **Creating the local trunk** (D-003): `git checkout -b <trunk> origin/<trunk>`, deliberately without
  `--track`. **Rationale**: `--track` *fails* in a single-branch clone (`cannot set up tracking
  information; starting point 'origin/master' is not a branch`), so the obvious-looking form would
  have reintroduced the bug it was meant to fix; the sequence pushes by explicit branch name, so no
  upstream is needed. **Alternatives considered**: `--track` (rejected by the probe); `git branch` +
  `git checkout` (two commands and one more dry-run line to keep in step).
- **Version inference source** (D-004): `getLatestTagOnTrunk(ref)` describes `origin/<trunk>`, taking
  the full ref as its parameter. **Rationale**: removes the local-branch requirement entirely — the
  defect — and passing the ref rather than a name keeps the function honest and its argv assertable.
  **Alternatives considered**: materialising the local trunk before describing it (makes a read-only
  path mutate the repository).
- **Local trunk behind the remote** (D-005): abort with the branch name and the commit count; never
  fast-forward. **Rationale**: locked on issue #76 — the branch may carry the maintainer's work, and
  this command publishes releases rather than reconciling branches. **Alternatives considered**:
  automatic fast-forward (rejected on the issue); ignoring it (the release commit would then miss
  remote history and the push would be rejected).
- **Fetch failure is fatal** (D-006). **Rationale**: the command's last step is `git push origin …`,
  so a run that cannot reach the remote cannot succeed; continuing would infer a version from stale
  tags and fail after mutating the repository. **Alternatives considered**: warn and continue (makes
  the auto-detected version a guess, which is what the issue asks to stop doing).
- **Dry-run boundary** (D-007): every precondition — resolution, fetch, inference, tag check,
  behind-check — runs under `--dry-run`; no checkout, branch creation, merge, tag or push does.
  **Rationale**: locked on issue #76; a dry run whose version could differ from the real run defeats
  the flag, and the fetch writes only `refs/remotes/` and `refs/tags/`. **Alternatives considered**:
  skipping the fetch in dry-run.
- **Module structure** (D-008, also the plan's Structure Decision): pure parsing and message building
  in a new `src/git/trunkDetection.ts`; every `spawnSync` call stays in `src/git/gitService.ts`.
  **Rationale**: `gitService` owns the private `run()` helper, so moving I/O out would duplicate it
  (constitution III), while the interesting cases — a tab-separated `ls-remote` line, an absent
  `origin/HEAD` — become testable without a `git` process. Mirrors `src/github/issueConversation.ts`
  beside its service. **Alternatives considered**: inlining the parsing in the already 1200-line
  `gitService` (every case would then need a `spawnSync` mock).
- **Config placement** (D-009): a new top-level `git.trunkBranch`, reachable from
  `automata config set git-trunk-branch` and a `Git` wizard screen appended last to the main menu.
  **Rationale**: `publish-release` is not a `do-work` turn and `doWork.*` is documented as the
  unattended loop's settings; appending the menu entry last is this repository's rule because
  `ConfigWizard.test.tsx` navigates by counting arrow presses. **Alternatives considered**:
  `doWork.trunkBranch` (wrong scope); a `--trunk` flag only (an override retyped every release is not
  the "set it once" escape hatch the spec asks for — a flag can still be added later).
