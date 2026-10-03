# `automata conductor`

One tick of the conductor role, meant to be fired from cron like [`do-work`](do-work.md). It is part of the conductor
epic (#114). A tick does the pre-flight — configuration, identity and lock — prunes the [watch list](#watch-list) and
exits 0. The rest of the work is added by later issues.

```bash
automata conductor              # one tick
automata conductor add <id>     # watch an issue or pull request
automata conductor remove <id>  # stop watching it
automata conductor list         # show what is watched
```

The tick has no options.

## Watch list

The items the conductor follows are stored in `.automata/config.json` as `conductor.watch`, an array of issue and pull
request numbers (see [config.md](config.md)):

```json
{ "conductor": { "watch": [114, 120] } }
```

| Subcommand | Effect |
|------------|--------|
| `add <id>` | Resolves `<id>` as an issue or a pull request (`#114` is accepted too) and refuses a closed or merged one. Applies the discovery setting so [`do-work`](do-work.md) picks it up — the `issueDiscoveryValue` label for `label`, an assignment to the `issueDiscoveryValue` login for `assignee`; it exits 1 if that value is empty. Adding an issue also adds its open linked pull request(s) to the list; those get no label or assignee, because `do-work` reaches them through the issue. Adding an id already listed is not an error. |
| `remove <id>` | Takes the id off the list and changes nothing on GitHub — the label or assignee stays. Exits 1 if the id is not listed. |
| `list` | One line per watched item: kind, number, state and title. An item that cannot be read is shown as unavailable. |

`add` needs `issueDiscoveryTechnique` configured. `title-contains` cannot be applied to an existing item, so `add` fails
with it and stores nothing. The three subcommands do not need the conductor identity or the lock.

At the start of each tick, after the lock is taken, every closed issue and closed or merged pull request is dropped from
the list, and each removal is logged on stdout (`Conductor: dropped issue #114 from the watch list (closed).`). An item
that cannot be looked up (network or `gh` error) stays on the list, with a warning on stderr.

## Reply rule

The decision of whether a watched item needs a conductor reply is a pure function (`decideConductorReply`,
`src/conductor/replyDecision.ts`); the tick does not act on it yet. An issue and its linked pull request are decided
separately, and the item needs a reply when either does. A conversation needs a reply when the newest message from
`agentUser` has no later message from an allowed user (the roles of [`do-work`](do-work.md)'s rule, swapped):

| Outcome | When |
|---------|------|
| reply | `agentUser` wrote and no allowed user wrote after it. Review-thread comments count on a pull request, and an issue description written by `agentUser` counts as its message. |
| skip, `answered` | An allowed user wrote after the newest `agentUser` message. |
| skip, `no-agent-message` | `agentUser` never wrote there. |
| skip, `closed` | The issue is closed or the pull request closed or merged — the rule the tick-start prune uses. |

Other accounts are ignored. Timestamps compare strictly, so an answer in the same second as the message does not count.

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
