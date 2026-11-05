# Feature Specification: Conductor Copilot review rounds

**Branch**: `feature/172-conductor-copilot-review` | **Issue**: #172

## User Story

As the operator of a conductor, I want to set, for one item or for all items, how many Copilot review rounds a pull
request gets, so the conductor asks Copilot for a review, waits for it, makes the agent fix the comments, and asks
again, before the pull request counts as ready.

## Requirements

- FR-1: `automata conductor config [<id>|#<id>] set|get|unset|list`. Keys come from one registry:
  `copilot-review-rounds` (integer >= 0, default 0, 0 = off) and `copilot-review-type` (`balanced` | `lite`, no default).
- FR-2: Settings live in the gitignored conductor state file (`.automata/conductor-watch.json`), in a `settings`
  section: `global` and `items["<id>"]`. An item value overrides the global value. `get`, `list` and an `unset` of an
  absent key never create the file.
- FR-3: `list` shows every key with KEY, ALLOWED, DEFAULT, VALUE and SOURCE (`item`, `global`, `default`). With an id it
  shows the effective values of that item; without, the global values. An unknown key in `set`, `get` or `unset` fails and
  names the supported keys.
- FR-4: `copilot-review-type` is stored but not sent to GitHub. `list`, `set --help`, `docs/conductor.md` and a warning
  printed by `set` say "not supported yet".
- FR-5: A pure decision (`decideCopilotRound`) takes the rounds setting, the stored round record, the PR head SHA,
  whether a Copilot review is pending and the open Copilot threads. It returns `off`, `wait`, `fix`, `request` or `done`.
- FR-6: Per-PR round record `{ requested, headSha, stopped? }` in the same state file (`copilotRounds`).
- FR-7: In a tick, for each open, non-draft PR of the item: `request` runs `addCopilotReviewer`, then records the round.
  `wait` skips the reply turn of the item. `fix` runs the normal turn (the existing Copilot block). A failed request is
  logged, recorded as `stopped`, and the conductor continues without Copilot for that PR.
- FR-8: The `conductor-ready` label needs the round decision to be `off` or `done`.
- FR-9: The setting of an issue applies to the PRs linked to it; the PR's own setting wins.
- FR-10: `automata git request-copilot-review [<pr>]` requests a Copilot review with `addCopilotReviewer`; the default PR
  is the PR of the current branch.
- FR-11: Docs (`docs/conductor.md`, `docs/git.md`), `CHANGELOG.md`, unit tests for the settings and the decision.

## Assumptions

- [AUTO] Next round: a new round starts only when the head SHA differs from the SHA of the last request. Same head means
  Copilot already saw this code, so the decision is `done`.
- [AUTO] First round: requested at the first tick that sees an open, non-draft PR with rounds > 0 (covers "PR just opened"
  and "agent just posted").
- [AUTO] A failed request is not retried: `stopped` makes the decision `done`, so a missing licence does not cause an API call every tick.
- [AUTO] `--dry-run` reports a `request` and writes nothing; `--check` is not changed.
- [AUTO] `#12` is a comment start in an interactive shell, so the docs show `12` and `'#12'`.
- [AUTO] Round records of closed PRs are left in the file (a PR number is never reused).
- [AUTO] Spec number 172 equals the issue number; 165 is taken by an unmerged branch.
