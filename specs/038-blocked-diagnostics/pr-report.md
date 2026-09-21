# PR Report: Blocked-exit diagnostics for `do-work`

**Branch**: `feature/038-blocked-diagnostics`
**Date**: 2026-09-21
**Spec**: [specs/038-blocked-diagnostics/spec.md](../../specs/038-blocked-diagnostics/spec.md)

## Summary

A `do-work` tick that does nothing now says why. The five ways a tick can be blocked — a held run lock, an
unusable configuration, a pre-flight that did not prepare the checkout, no candidate picked up, and every
selected item skipped — each render the same six-section health report `--check` builds, headed by what
blocked them. The report itself gains the facts that would have closed issue #82 on its own: where the
operation log directory is and how that path was derived, whether it is writable, which working directory the
lock's holder runs from, and what the live tick is doing right now.

## What's New

- **Blocked-exit dump** (`src/commands/doWork.ts`): five recognised blocked reasons, each rendering the
  six-section report headed by its trigger. Text goes to stderr, leaving stdout's contract intact; `--json`
  carries it under `blocked: { reason, trigger, report }` on the object already written to stdout. It makes no
  GitHub call and no fetch — `Selection` is filled from the decisions the tick already took — and it never
  changes an exit code. `runCheck` was split into `buildCheckReport(input)` plus a printer so that the dump and
  `--check` render the same report by construction rather than by convention.
- **`doWork.dumpOnBlock`** (default `true`): reachable through `automata config set do-work-dump-on-block
  <true|false>` and a new wizard screen, *Do Work → Report on a Blocked Tick*, which is now the last screen of
  the Do Work chain and the one that writes the section.
- **Lock heartbeat** (`src/run/heartbeat.ts`): a tick publishes its phase (`pre-flight` / `discovery` / `item`
  / `summary`), the item ordinal, total and subject, and the executor with the time its run started.
  `Run lock` renders it with the age of the last update, which is what tells a slow tick from a wedged one. It
  is a sidecar at `.automata/automata-heartbeat.json` bound to the lock's token, so it cannot participate in the
  lock protocol and a file left by a dead holder reads as absent.
- **Lock working directory** (`src/run/runLock.ts`): `LockOwner.cwd` is recorded and printed. When it differs
  from the checking process's, the report names both derived operation-log directories and raises it as a
  problem — that mismatch is the unexplained half of the paste in issue #82.
- **Log-directory disclosure** (`src/run/operationLog.ts`, `src/run/checkReport.ts`): `Recent ticks` now always
  states the resolved directory, that it is the parent of the current working directory, and whether it is
  writable. An unwritable directory is a problem, because every tick there records nothing.
- **Live-lock relief** (`src/run/checkReport.ts`): with the lock held or suspect, an absent or empty execution
  log is stated as a line rather than raised as a problem — the log is written when a tick *ends*. An
  execution log that could not be *read* stays a problem.
- **`--verbose`** (`src/run/commandTrace.ts` plus the four `spawnSync` wrappers): a `Commands` block after the
  six sections listing every `git` and `gh` invocation with its duration and exit code, and a `Selection`
  section that additionally shows the discovery query as sent and every candidate before the filter narrowed it.
  A top-level `trace` array in `--json`; `null`, not `[]`, when tracing was off. With `--verbose` absent the
  cost is one null check per spawn.
- **Investigative commands** (`src/run/checkReport.ts`): `Problem` gained `command: string | null`, printed as
  `try: <command>` under the problem and emitted in `--json`. A problem no single command investigates carries
  `null` rather than an invented suggestion.
- **`AUTOMATA_OWN_PATHS`** (`src/run/runLock.ts`): one list of the files automata writes inside the checkout,
  replacing four separate uses of `RUN_LOCK_RELATIVE_PATH`. Found during implementation — the heartbeat has to
  be excluded from the working-tree cleanliness check everywhere the lock is, or a repository that has not
  gitignored it skips every item as `dirty-tree`. That was issue #69 for the lock alone.

## New Libraries / Dependencies

None.

## Breaking Changes

- **`do-work --json` gains a `blocked` key.** It is `null` for a tick that was not blocked and when
  `doWork.dumpOnBlock` is false, but a consumer comparing the payload's keys exactly will see it. One test in
  `doWork.cmd.test.ts` asserted exactly that and was updated rather than loosened.
- **`do-work --check --json` gains `trace` and `blocked` at the top level, and each problem gains `command`.**
  `trace` and `blocked` are `null` for an ordinary `--check`.
- **The wizard's Do Work chain is one screen longer.** Lock staleness no longer saves and exits; the new
  *Report on a Blocked Tick* screen does. Abandoning the wizard before it still writes nothing, as before.

## Testing

- **Unit (pure)** — `commandTrace.test.ts` (8) and `heartbeat.test.ts` (11) are new: the sink's on/off
  semantics and argument copying, and the heartbeat's round-trip, token mismatch, truncated-file and
  never-throws behaviour. `checkReport.test.ts` gained 18 cases for the heartbeat rendering, the cwd mismatch,
  the always-present log-directory line, the live-lock relief (and that a free lock and an unreadable log still
  raise), the `try:` line, the `Commands` block and the blocked header. `operationLog.test.ts` covers
  `inspectLogDirectory` including a chmod-ed directory.
- **Unit (lock)** — `runLock.test.ts` covers the recorded cwd, a lock written without one, attaching only the
  matching heartbeat, and the release clearing the sidecar and stopping publication.
- **Command** — `doWork.cmd.test.ts` drives all five blocked exits through `parseAsync`, asserting the six
  section titles, the unchanged exit code, `dumpOnBlock: false`, the answered-tick case, that no GitHub query is
  made while dumping a lock-held tick, both JSON shapes, and the heartbeat phases and ordering.
  `doWorkCheck.cmd.test.ts` covers `--verbose` in both output modes, the selection extras, and reproduces the
  issue's exact scenario (live pid, no log) now reporting healthy. The read-only assertions still hold with
  `--verbose`.
- **Mutation** — every new behaviour was proved non-vacuous: disabling the live-lock relief, inverting the cwd
  comparison, breaking `recordCommand`, removing each of the three dump call sites, removing the heartbeat call
  sites, and narrowing the own-paths filter each turned exactly the expected tests red, and only those.
- **Manual** — `do-work --check --verbose` run against this repository (14 traced commands, the real
  `/workspaces` unwritable-log problem correctly reported), and the lock-held dump driven end to end in a
  temporary checkout against a live holder pid, showing the cwd mismatch and a rendered heartbeat.
- Gate: `npm test` (1418 passing, 47 files) and `npm run lint` clean; `tsc --noEmit` clean.

## Notes

- `/workspaces` is not writable in this dev container, so the new unwritable-log-directory problem fires on a
  real `--check` here. That is the feature working, not a defect — but it is why `doWorkCheck.cmd.test.ts` now
  stubs `inspectLogDirectory`, which probes `dirname(process.cwd())` and would otherwise make every check test
  depend on the machine.
- Installations should add `.automata/automata-heartbeat.json` to their ignore rules, as for the lock. automata
  excludes it from its own cleanliness check either way; the ignore rule is for `git status` and for operators.
- The operation logs stay at `dirname(cwd)` and stay unconfigurable. The issue asked to be *told* where they
  are, not to move them; making the path a setting would mean the installation most in need of the diagnostic
  is the one that never set it.
