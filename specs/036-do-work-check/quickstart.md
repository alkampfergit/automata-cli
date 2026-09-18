# Quickstart: `do-work --check`

## The one command

From inside the checkout the scheduler runs `do-work` in:

```bash
automata do-work --check
```

It prints six sections and a verdict, and exits `0` when it found no problem or `1` when
it did.

## When the loop has gone quiet

```bash
automata do-work --check
```

Read the sections top-down; each answers a different "why":

| Section | Answers |
|---|---|
| `Run lock` | Is a tick running right now? Is a dead one blocking every future tick? |
| `Recent ticks` | Is the scheduler still firing, and how did the recent ticks end? |
| `Last work` | What did the loop last actually do, and to which issue? |
| `Repository` | Is the checkout in a state that lets a tick work at all? |
| `Selection` | For each candidate issue and orphan pull request: picked up, or skipped and why? |
| `Environment` | Is the configuration, `gh` and the executor sound? |

## Asking about one issue

```bash
automata do-work --check --issue 75
```

Narrows the `Selection` section to issue #75, which is the direct way to ask "why is *this*
one not being picked up".

## Offline

```bash
automata do-work --check --no-fetch
```

Makes no network call: no `git fetch`, no `gh`. The `Repository` section labels its
ahead/behind figures as not refreshed and the `Selection` section reports that it did not
run. Useful when the machine has lost connectivity and that is what you are diagnosing.

## For a script or a monitor

```bash
automata do-work --check --json | jq '.exitCode, [.problems[].summary]'
```

One JSON document on stdout, keyed by section id. `.exitCode` matches the process exit
code.

## Verifying it changed nothing

The check is read-only. To prove it on your own checkout:

```bash
git status --porcelain > /tmp/before
cp ../automata-execution.log /tmp/exec-before 2>/dev/null || true
ls .automata/automata.lock 2>/dev/null

automata do-work --check

git status --porcelain > /tmp/after
diff /tmp/before /tmp/after                      # identical
diff /tmp/exec-before ../automata-execution.log  # identical — the check logs nothing
ls .automata/automata.lock 2>/dev/null           # still absent if it was absent
```

The only thing the check may change is git's remote-tracking ref for the base branch, and
only when `--no-fetch` is not given.
