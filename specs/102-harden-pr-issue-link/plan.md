# Plan: Harden the issue-to-PR link repair

Touches `src/config/githubService.ts` (`getOpenPrsByHead`, `hasClosingRef`, fix `addClosesRefToPr`) and
`src/commands/doWork.ts` (`repairIssueLink`, `linkCandidateBranches`, `pickHeadPr`, snapshot in the item run,
`adjustOutcome`). No new modules; existing structure preserved. Docs: `docs/do-work.md`; `CHANGELOG.md` Unreleased.
