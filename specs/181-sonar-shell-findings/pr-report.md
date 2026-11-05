## Summary

`npm run sonar:local` now also checks the shell scripts, and the 123 shell findings that SonarCloud reported on
`develop` are fixed.

## What's New

- `scripts/sonar-shell-check.mjs`: checks S7688, S131, S1066, S1192 and S7679; it matched all 123 live findings at the same lines.
- `sonar:local` runs it. `AGENTS.md` keeps the rule to run `sonar:local` before each commit.
- `.specify/scripts/bash/*.sh`: `[[`, default `case` branches, merged `if` statements, local variables, one constant.

## Testing

Unit tests for the checker (`tests/unit/sonarShellCheck.test.ts`); `npm test`, `lint`, `typecheck`, `sonar:local` pass;
the speckit scripts were run by hand.
