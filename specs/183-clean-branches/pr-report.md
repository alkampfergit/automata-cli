# PR Report: clean-branches command

**Branch**: `feature/183-clean-branches`
**Date**: 2026-11-07
**Spec**: specs/183-clean-branches/spec.md

## Summary

`automata git clean-branches` removes the local branches that have no `origin` branch, and the `origin` branches
whose pull requests are all closed or merged. It prints the plan and asks before it deletes anything.

## What's New

- **`automata git clean-branches`** (`src/commands/cleanBranches.ts`): options `--dry-run`, `--yes`, `--local-only`, `--remote-only`; one confirmation after the full plan; exit 1 on a failed deletion or lookup.
- **Pure planner** (`src/git/branchCleanup.ts`): the protected set, the local and remote plans, line format and the deletion loop, with no I/O.
- **Wrappers**: `fetchPruneOrigin`, `countUnpushedCommits`, `deleteRemoteBranch` in `gitService.ts`; `listSameRepoPullRequests` (drops fork pull requests) in `ghWorkService.ts`.
- **Docs**: `docs/git.md` section and a `CHANGELOG.md` bullet. The README needed no change.

## Testing

- **Unit**: planner rules (protected, unpushed warning, open/closed/never/lookup-failed), argv of every new wrapper, fork filtering.
- **Command**: mocked git and gh; dry run, `--yes`, phase flags, no terminal, failed deletion, failed lookup, Azure DevOps.
- **Manual**: `clean-branches --dry-run` on this repository.
- `npm test`, `lint` and `typecheck` pass. `sonar:local` reports 3 errors (`git.ts:307` no-control-regex, `gitService.ts` two no-await-in-loop); they are the same on untouched `develop` and none is in this change.

## Notes

- A remote deletion leaves its local branch; the next run removes it.
- Closes #183
