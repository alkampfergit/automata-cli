# Quickstart: diagnosing a `do-work` that does nothing

## The tick did nothing and you want to know why

Just run it. A blocked tick now prints its own report on stderr:

```sh
automata do-work
# blocked: run lock held by pid 851554 on cisharpai
# Run lock / Recent ticks / Last work / Repository / Selection / Environment
```

Turn it off for a noisy cron log:

```sh
automata config set do-work-dump-on-block false
```

## The report contradicts itself

`Recent ticks` now always says where it looked:

```
  log directory: /workspaces (the parent of /workspaces/automata-cli), writable
```

and `Run lock` says where the holder runs from:

```
  a tick is running: pid 851554 on cisharpai, `do-work`, since 2026-09-21T20:47:02Z (4m so far)
    working directory: /srv/checkouts/automata-cli
    logs to /srv/checkouts (this check reads /workspaces)
```

## What is the live tick doing right now?

```sh
automata do-work --check
# Run lock
#   a tick is running: …
#     phase: item 3 of 8 — #82 (updated 12s ago)
#     executor: claude, running for 2m
```

## Show the work behind the report

```sh
automata do-work --check --verbose
# … the six sections, plus:
# Commands (14)
#   git rev-parse --short HEAD — 8ms exit 0
#   gh issue list --label automata --limit 10 … — 412ms exit 0
```
