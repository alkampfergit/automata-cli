# Plan
Add an optional `name` argument to `isMissingLabelError` in `src/github/ghWorkService.ts`. `addLabel` passes it.
Unit tests in `tests/unit/ghWorkService.test.ts`. One `Fixed` entry in `CHANGELOG.md`. 
Scope added at the request of @alkampfergit (PR comment of 2026-10-12T10:57Z): `conductor --verbose`. It traces each `git` and `gh` call, shows the model steps, and lists the tool calls that `dontAsk` mode denied. It writes to stderr only, so stdout is unchanged. Code: `src/conductor/permissionDenials.ts` and `src/commands/conductor.ts`. Tests: `tests/unit/conductorPermissionDenials.test.ts` and `tests/unit/conductor.cmd.test.ts`. The `--verbose` section of `docs/conductor.md` and one `Added` entry in `CHANGELOG.md` document it.
