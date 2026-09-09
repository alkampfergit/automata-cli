# Setup

From an empty container to a cron-driven loop. Roughly fifteen minutes, most of it deciding on the agent account.

## 1. The environment

`do-work` invokes the executor with permission prompts bypassed — an unattended run cannot answer a prompt — so it must run somewhere disposable: a VM, a devcontainer, a codespace, a CI runner. Not your laptop.

It needs:

- **Node.js LTS (18+)**, the baseline stated in `AGENTS.md`, and automata installed (`npm install -g automata-cli`).
- **`git`**, with the repository cloned and an `origin` remote pointing at GitHub.
- **The [`gh` CLI](https://cli.github.com/)**, authenticated.
- **An executor**: `claude` or `codex` on `PATH`.

## 2. The agent account

This is the decision worth spending thought on. The agent needs its own GitHub identity, distinct from the humans who instruct it, because that identity is what the answer boundary is measured against. If the agent posted as you, your messages and its messages would be indistinguishable and the loop would never know what it had answered.

Options, in the order most people should consider them:

1. **A machine user** — a normal GitHub account created for the purpose, added as a collaborator with **write** access. Simplest and works everywhere.
2. **A GitHub App / bot** — cleaner permissioning, and its comments appear as `app-name[bot]`. Use that exact login as `agentUser`.

Whichever you pick, authenticate `gh` as that account **in the harness environment**:

```bash
gh auth login              # as the agent account, not as yourself
gh api user --jq .login    # confirm — this value is your agentUser
```

> **This is the one setup mistake that breaks the loop badly.** Everything the
> agent posts is attributed to whoever `gh` is authenticated as. If that account
> is one of your `allowedUsers` — your own account, say — then the agent's own
> `working…` marker reads as a new instruction, and every tick answers the marker
> the previous tick left behind, forever.
>
> `do-work` refuses to start in that situation:
>
> ```
> Error: `gh` is authenticated as "alice", which is listed in allowedUsers.
> … each tick would answer the previous tick forever.
> ```
>
> This is also why you cannot usefully run a real tick from your own workstation
> while logged in as yourself. Dry runs are unaffected — they post nothing, so
> the guard does not apply to them and `--dry-run` always works.

**Write access matters for one thing:** assignment. `do-work` assigns each issue to the agent so the claim is visible in the issue list. Without write access the assignment fails, and the loop still works — it warns and carries on — but you lose that signal.

## 3. The discovery filter

Decide how the agent finds work. A dedicated label is the usual answer:

```bash
gh label create automated --description "Implemented by the automata agent" --color b60205
```

## 4. Configure automata

Interactively:

```bash
automata config
```

…or non-interactively, which is what you want in a container image:

```bash
automata config set type gh
automata config set issue-discovery-technique label
automata config set issue-discovery-value automated
automata config set allowed-users alice,bob          # who may command the agent
automata config set agent-user automata-bot          # the agent's own login
automata config set do-work-base-branch develop
automata config set do-work-executor claude          # claude is the default; codex is the alternative
automata config set do-work-model claude claude-opus-4-6   # optional, per executor
automata config set do-work-model codex o3                 # optional, per executor
automata config set do-work-max-runs 3               # a safety valve while you build trust
```

This writes `.automata/config.json`. Commit it — it is repository policy, not a secret. (`.automata/automata.lock` is git-ignored; it is transient.)

The `allowedUsers` list is a trust boundary: everyone on it can make the agent write code and push branches. Keep it short.

## 5. Check the plan before spending anything

```bash
automata do-work --dry-run
```

This prints exactly what a real tick would do — which issues need an answer, which turn each would get, which would be assigned — and changes nothing: nothing assigned, nothing posted, no branch touched, no model invoked.

Read it carefully. If an issue you expected is missing, [Detection-Rules](Detection-Rules.md) explains why; if a turn kind surprises you, the reason string says which rule fired.

## 6. One real tick, watched

```bash
automata do-work --issue 42
```

`--issue` restricts the tick to a single issue, which is the right way to see the whole cycle once with your own eyes: assignment appears, a `working…` comment appears, the model runs, the comment is replaced by a real answer.

## 7. Cron

```cron
*/15 * * * * cd /workspace/my-repo && /usr/local/bin/automata do-work --silent >> /var/log/automata.log 2>&1
```

Two notes:

- **The interval does not need to exceed a tick's duration.** A tick can easily outlive a 15-minute window, and that is fine: the run lock means a second instance exits immediately without doing anything. Pick the interval from how long you are willing to wait for a reply.
- **`--silent`** keeps the log readable by dropping the model's step-by-step output. Drop it while you are still building confidence.

## 8. Optional — your own prompts

The built-in prompts work out of the box and name no skill. To change how the agent behaves — including telling it to use a skill you have installed — see [Prompts](Prompts.md).

---

## Configuration checklist

| Key | Required | Set with |
|---|---|---|
| `remoteType` | yes, must be `gh` | `config set type gh` |
| `issueDiscoveryTechnique` | yes | `config set issue-discovery-technique` |
| `issueDiscoveryValue` | yes | `config set issue-discovery-value` |
| `allowedUsers` | yes | `config set allowed-users` |
| `agentUser` | yes | `config set agent-user` |
| `doWork.baseBranch` | no (`develop`) | `config set do-work-base-branch` |
| `doWork.executor` | no (`claude`) | `config set do-work-executor` |
| `doWork.models.claude` | no | `config set do-work-model claude <id>` |
| `doWork.models.codex` | no | `config set do-work-model codex <id>` |
| `doWork.maxRunsPerTick` | no (`0` = unlimited) | `config set do-work-max-runs` |
| `doWork.lockStaleMinutes` | no (`120`) | `config set do-work-lock-stale-minutes` |
| `doWork.prompts.*` | no (built-in) | `config set do-work-prompt <turn-kind> <value>` |

A missing required key fails the tick with exit 1 and a message naming the command that sets it. Nothing is half-run.
