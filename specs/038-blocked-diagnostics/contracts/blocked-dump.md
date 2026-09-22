# Contract: the blocked dump

## Invariants

1. **The dump is additive.** For every blocked reason, the process exit code with the dump enabled equals
   the exit code with `doWork.dumpOnBlock: false`. `lock-held` stays 0 (2 when suspect), `config-invalid`
   stays 1, `preflight-failed` and `all-skipped` stay 2, `no-candidates` stays 0.
2. **The dump makes no GitHub call and no fetch.** While rendering it, the process must not call
   `listCandidateIssues`, `getOpenPrLinkMap`, `getIssueSurface`, `getPrSurface`, `getAuthenticatedIdentity`
   or `git fetch`. `Selection` is filled from the discovery the tick already made — its decisions, and under
   `--verbose` the query as sent and the candidate lists too — or reported as not run.
3. **The dump cannot fail the tick.** Every call into it is wrapped; a throw produces one warning line on
   stderr and nothing else.
4. **The dump renders the same six sections, in the same order, with the same titles** as `--check`:
   `Run lock`, `Recent ticks`, `Last work`, `Repository`, `Selection`, `Environment`.
5. **Stream discipline.** Text mode writes the dump to stderr. `--json` mode writes nothing extra to stderr
   and adds a `blocked` key to the single JSON object on stdout.

## Shapes

Text mode, on stderr:

```
blocked: run lock held by pid 851554 on cisharpai
automata do-work --check — alkampfergit/automata-cli — 2026-09-21T20:51:20.000Z

Run lock
  a tick is running: pid 851554 on cisharpai, `do-work`, since 2026-09-21T20:47:02Z (4m so far)
  …
```

JSON mode, inside the object already written to stdout:

```json
{
  "blocked": {
    "reason": "lock-held",
    "trigger": "run lock held by pid 851554 on cisharpai",
    "report": { "generatedAt": "…", "sections": { … }, "problems": [ … ] }
  }
}
```

`report` is byte-identical in shape to `--check --json`'s payload.

## Read-only guarantee (inherited)

The dump reuses the collectors `specs/036-do-work-check/contracts/check-report.md` already constrains, minus
the two that reach the network. It must additionally never call `acquireRunLock` or `recordTick`: it runs
inside a tick that already holds — or was refused — the lock, and the operation-log write is the caller's.
