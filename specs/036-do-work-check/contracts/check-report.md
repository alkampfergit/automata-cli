# Contract: the `do-work --check` report

## Invocation

```
automata do-work --check [--no-fetch] [--json] [--issue <n>] [--pr <n>] [--limit <n>]
```

- `--check` with `--dry-run`: refused, exit `1`, message on stderr.
- `--check` implies nothing is written. See the "never does" list below.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | The report was produced and found no problem. |
| `1` | The report was produced and found at least one problem, **or** the invocation itself was refused (`--check --dry-run`). |

The final line always states the verdict, so the two `1`s are never ambiguous in practice.

## Text output (stdout)

```
automata do-work --check — <owner>/<repo> — <ISO timestamp>

Run lock
  <one line per finding>

Recent ticks
  ...

Last work
  ...

Repository
  ...

Selection
  ...

Environment
  ...

Problems (<n>)
  · <section>: <summary>
  ...

RESULT: healthy
```

- Section headings are fixed and always printed, in the order above, even when a section
  found nothing to say — an absent section would be ambiguous between "nothing to report"
  and "the check crashed".
- The last line is `RESULT: healthy` (exit 0) or `RESULT: <n> problem(s) found` (exit 1).
  The `Problems` block is omitted when there are none.
- Nothing is written to stderr on the success path.

## JSON output (`--json`, stdout, single document)

```jsonc
{
  "generatedAt": "2026-09-18T14:41:26.000Z",
  "repo": "alkampfergit/automata-cli",
  "offline": false,
  "exitCode": 0,
  "problems": [{ "section": "git", "summary": "…" }],
  "sections": {
    "lock": { "title": "Run lock", "lines": ["…"], "problems": [], "data": { … } },
    "ticks": { … },
    "work": { … },
    "git": { … },
    "selection": { … },
    "environment": { … }
  }
}
```

`sections` is an object keyed by section id (not an array) so a consumer can reach one
section without searching. Every section carries the same four fields; `data` holds the
structured form of that section's facts:

| Section | `data` |
|---|---|
| `lock` | `{ status: "free" \| "held" \| "suspect" \| "stale" \| "unreadable", owner, heldForMs, staleMinutes }` |
| `ticks` | `{ newest: ExecutionTick \| null, history: ExecutionTick[], lockHeldCount, medianIntervalMs, sinceNewestMs, silent, skipped, otherRepos, logPath, logPresent }` |
| `work` | `{ records: WorkRecord[], skipped, otherRepos, logPath, logPresent }` |
| `git` | the `RepoStatus` fields |
| `selection` | `{ ran: boolean, detail: string \| null, plan: PlanEntry[] }` where `PlanEntry` is the existing `toPlanJson` shape |
| `environment` | `{ version, repo, remoteType, configValid, configError, ghAvailable, ghLogin, identityProblem, discovery: { technique, value }, baseBranch, maxRuns, executor, executorCommand, executorOnPath }` |

`selection.plan` reuses `toPlanJson` verbatim, so a consumer that already parses
`do-work --dry-run --json` parses this without change.

## What `--check` never does

Asserted by tests, not only by intent:

- never calls `acquireRunLock`, and never creates `.automata/automata.lock`;
- never calls `recordTick` — the logs it reports on are not altered by reporting on them;
- never calls `postMarker`, `updateMarker`, `deleteMarker`, `assignIssueToAgent`,
  `assignPrToAgent`, `addClosesRefToPr` or any other GitHub write;
- never calls `runRepoHygiene`, `prepareBaseBranch`, `preparePrBranch`, or any mutating
  `gitService` function (`checkoutBranch`, `pullFastForwardOnly`, `commitStaged`,
  `pushSetUpstream`, `resetHardTo`, `deleteLocalBranch`, `fetchPrune`, …);
- never calls `runClaude` or `runCodex`;
- with `--no-fetch`, makes no network call at all.

The only permitted network effects are the `gh` read queries the selection section makes
and one `git fetch origin +refs/heads/<base>:refs/remotes/origin/<base>`.
