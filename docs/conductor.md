# `automata conductor`

One tick of the conductor role, meant to be fired from cron like [`do-work`](do-work.md). It is part of the conductor
epic (#114); for now it does the pre-flight only — configuration, identity and lock — and then exits 0. The work itself
is added by later issues.

```bash
automata conductor
```

The command has no options.

## Configuration

It reads the same `.automata/config.json` as `do-work`, but needs only `allowedUsers` and `agentUser` (see
[config.md](config.md)). An explicit `remoteType: "azdo"` is rejected, as for `do-work`.

## Identity

The conductor is a human instructing the agent, so the account `gh` is authenticated as must be

- listed in `allowedUsers` (case-insensitive), and
- different from `agentUser`.

Otherwise the command prints the reason on stderr and exits 1. An unverifiable identity (`gh` unauthenticated, or an
app installation token with no user) also exits 1: unlike `do-work`, which acts *as* the agent, the conductor has to
prove it is an allowed account.

## Run lock

The conductor takes its own lock, `.automata/conductor.lock`, so it runs next to `do-work` (which uses
`.automata/automata.lock`); only a second conductor is turned away. The lock is stale after `doWork.lockStaleMinutes`.

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Tick completed, or another conductor holds the lock (nothing done) |
| 1 | Configuration unusable, or the identity check failed |
| 2 | The conductor lock looks alive but outlived the stale window — probably a reused pid; the message names the file to remove |
