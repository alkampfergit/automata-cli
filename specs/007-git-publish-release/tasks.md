# Tasks: Git Publish Release

**Branch**: `007-git-publish-release` | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

## Task List

- [ ] T1: Add `getLatestTagOnMaster` to `src/git/gitService.ts` — runs `git describe --tags --abbrev=0 master`, returns bare semver string or `null` if not found/not valid semver
- [ ] T2: Add `bumpMinorVersion` to `src/git/gitService.ts` — parses `X.Y.Z`, increments `Y`, resets `Z` to 0, returns new string
- [ ] T3: Add `tagExists` to `src/git/gitService.ts` — runs `git tag -l <version>`, returns `true` if output is non-empty
- [ ] T4: Add `publishRelease(version, dryRun)` to `src/git/gitService.ts` — executes or dry-runs the 8-step GitFlow sequence
- [ ] T5: Add `publishReleaseCmd` to `src/commands/git.ts` — validates preconditions, resolves version, calls `publishRelease`, outputs result
- [ ] T6: Wire `publishReleaseCmd` into the `gitCommand` group in `src/commands/git.ts`
- [ ] T7: Write unit tests in `tests/unit/publishRelease.test.ts` covering service functions (auto-version detection, minor bump logic, dry-run output) and CLI precondition tests in `tests/unit/git.commands.test.ts` (dirty tree rejection, wrong branch rejection, existing tag rejection, invalid semver rejection, no tag found rejection)
- [ ] T8: Update `docs/git.md` with `publish-release` command documentation
- [ ] T9: Run `npm test && npm run lint` and fix any issues
