# Quickstart: Operation log for `do-work`

**Feature**: `feature/033-operation-log` | **Date**: 2026-09-10

## What you get

Nothing to configure. From this version on, every `automata do-work` invocation
maintains two files in the directory *above* your checkout:

```text
~/workspaces/
├── automata-execution.log   ← one line per do-work run (newest 1000 kept)
├── automata-work.log        ← one record per run that ran the executor (30 days kept)
└── automata-cli/            ← the checkout you run do-work from
```

Several checkouts under the same parent share the two files; the repository slug
on every line and every record header tells them apart.

## Watch the loop

```sh
tail -f ../automata-execution.log
```

```text
2026-09-10T06:51:36.412Z do-work repo=alkampfergit/automata-cli items=2 answered=1 answered-no-reply=0 skipped=0 failed=0 deferred=1 runs=1 exit=2 dur=42.1s
2026-09-10T06:56:03.008Z do-work repo=alkampfergit/automata-cli items=0 answered=0 answered-no-reply=0 skipped=0 failed=0 deferred=0 runs=0 exit=0 dur=1.8s
```

Useful one-liners:

```sh
grep -c 'runs=0' ../automata-execution.log        # how many ticks did nothing
grep 'exit=2' ../automata-execution.log | tail    # the last degraded ticks
grep 'note=lock-held' ../automata-execution.log   # ticks blocked by the run lock
awk '{print $1}' ../automata-execution.log | tail -1   # when the loop last fired
```

If the newest timestamp is older than your cron interval, the loop is not
firing — that is the question this file exists to answer.

## Review what the agent did

```sh
less ../automata-work.log
```

```text
=== 2026-09-10T06:51:36.412Z alkampfergit/automata-cli ===
#53 issue-discuss answered [claude model=opus-5] — posted a reply
#51 pr-work answered [codex effort=high] — pushed 2 commits
```

Only ticks that actually invoked the executor appear here, and only the items
that reached it. A tick where everything was deferred by `--max-runs`, skipped
for a dirty tree, or simply not actionable writes nothing.

## Verify it locally

```sh
npm run build

# a real tick, from a checkout whose parent is writable
automata do-work --limit 1
tail -1 ../automata-execution.log

# a dry run writes nothing
cp ../automata-execution.log /tmp/before.log
automata do-work --dry-run
diff /tmp/before.log ../automata-execution.log && echo "unchanged, as expected"
```

## Confirm the no-permission path

```sh
chmod a-w ..
automata do-work --limit 1 ; echo "exit=$?"
chmod u+w ..
```

The tick runs and exits exactly as it would otherwise; no log file is created
and no warning is printed. That is deliberate — the logs are diagnostics, and a
warning on every tick of a five-minute cron would be noise.

## Known limits

- An interrupted tick (Ctrl-C, `SIGTERM`) writes no line: the process exits from
  the signal handler before the tick returns.
- When two checkouts under the same parent both log and one of them crosses the
  1000-line boundary at that moment, the rewrite can lose a line the other just
  appended. Accepted for a diagnostic log.
- Neither the location nor the retention limits are configurable in this
  iteration.
