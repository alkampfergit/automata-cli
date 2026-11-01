# Plan: Conductor Copilot review rounds

## Structure

- `src/conductor/settings.ts` (pure): registry, parse, resolve, `list` rendering.
- `src/conductor/copilotRounds.ts` (pure): `decideCopilotRound`, round record type.
- `src/conductor/watchStore.ts`: state file also keeps `settings` and `copilotRounds`; every write keeps all sections.
- `src/github/ghWorkService.ts`: `getCopilotReviewPending(pr)` from `reviewRequests`.
- `src/commands/conductorConfig.ts`: the `config` subcommand runners.
- `src/commands/conductorCopilot.ts`: tick integration (request, wait, gate).
- `src/commands/git.ts`: `request-copilot-review`.

## Decisions

- Decision: reuse the watch state file for settings and round records. Rationale: it is already gitignored machine
  state with an atomic writer; tracked `config.json` stays clean. Alternatives considered: `config.json`, a second file.
- Decision: one registry drives validation, `list`, errors and docs. Rationale: a new key appears everywhere at once.
- Decision: the decision function is pure and takes facts, not `gh` calls. Rationale: unit tests need no mocks.
- Decision: pending is read from `reviewRequests`. Rationale: GitHub keeps Copilot there until its review is submitted.
- Decision: a failed request ends the rounds of that PR. Rationale: no retry storm without a licence.
