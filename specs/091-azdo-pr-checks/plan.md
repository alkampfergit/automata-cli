# Plan: Azure DevOps PR checks
- `src/config/azdoService.ts`: `mapCheckState`, `getPrInfo(branch?)` (status vs list+get-runs), build-run mapping.
- `src/git/gitService.ts`: pass the branch when it differs from the current one; extract the Sonar step shared with `getPrInfoGh`.
- Tests: extend `tests/unit/azdoService.test.ts` with fixtures; Sonar wiring test in a gitService test.
- Docs: `docs/git.md` mapping table; `CHANGELOG.md`.
