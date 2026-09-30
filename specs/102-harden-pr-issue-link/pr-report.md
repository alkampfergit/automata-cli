# PR Report: Harden the issue-to-PR link repair

**Branch**: `feature/102-harden-pr-issue-link`
**Date**: 2026-09-30
**Spec**: specs/102-harden-pr-issue-link/spec.md

## Summary

`do-work` repairs the `Closes #N` link between a pull request and its issue after a turn; that link is what moves an issue out of discussion. The repair now finds the pull request by head branch instead of the current checkout and runs after every turn that has an issue, so an unlinked pull request no longer leaves an issue looking stuck.

## What's New

- **Link repair lookup** (`githubService.ts`): `getOpenPrsByHead` (`gh pr list --head`) replaces the checkout-based lookup; `hasClosingRef` is the single reference check (accepts `Fixes`/`Resolves`, whole-number match) and now also guards `addClosesRefToPr`.
- **Repair scope** (`doWork.ts`): runs after `pr-work` as well as `issue-discuss`, and after a discuss turn also checks branches created during the turn; never the base branch.
- **Docs**: `docs/do-work.md` link-repair section and a `CHANGELOG.md` Unreleased bullet.

## Testing

- **Unit**: `githubService.test.ts` (reference matching, head query, failure) and `doWork.cmd.test.ts` (new-branch discovery, pre-existing branches ignored, base-preferred selection, ambiguity, pr-work restore, base-branch safety).
- `npm test && npm run lint` pass.

## Notes

- `pr-orphan` turns have no issue and are unchanged. A model that opens a PR from a branch that pre-existed the turn is not discovered.
