# Feature Specification: `automata conductor` skeleton

**Branch**: `feature/117-conductor-skeleton` | **Issue**: #117 (part of epic #114)

## User Story

As the operator, I want an `automata conductor` command that runs one cron-friendly tick as a *human* account, so the
conductor role can later be built on a command that already refuses the wrong identity and cannot collide with `do-work`.

## Requirements

- FR-1: `automata conductor` loads the same `.automata/config.json` as `do-work` (`readConfig`, same participant keys).
- FR-2: The account `gh` is authenticated as must be listed in `allowedUsers` and must not be `agentUser` (case
  insensitive). Otherwise the command prints a clear message to stderr and exits 1.
- FR-3: The command takes its own run lock, `.automata/conductor.lock`, so it can run next to `do-work` and a second
  conductor tick is turned away (exit 0, "already running"; exit 2 for a suspect lock, as `do-work`).
- FR-4: The lock file is an automata bookkeeping path (`AUTOMATA_OWN_PATHS`) so it never dirties the working tree.
- FR-5: With identity and lock in hand the tick does nothing else yet and exits 0 (skeleton; later issues of #114 add the work).
- FR-6: `docs/conductor.md`, a README command-table row and a CHANGELOG bullet under Unreleased.

## Assumptions

- [AUTO] Unverifiable identity: chose to fail (exit 1) when `gh` is unauthenticated or has no user (app token) because
  the conductor must *be* an allowed human; `do-work` tolerates it only because it acts as the agent.
- [AUTO] Azure DevOps: chose to reject an explicit `remoteType: "azdo"` like `do-work`, because the conductor needs GitHub APIs.
- [AUTO] Config: chose to require `allowedUsers` and `agentUser` only (not discovery keys), because the skeleton does no discovery.
- [AUTO] Stale window: chose `doWork.lockStaleMinutes` because no conductor-specific key was requested.
- [AUTO] Flags: none beyond `--help`, because the issue specifies none.
