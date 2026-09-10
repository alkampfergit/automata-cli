# automata config

Commands for configuring the tool.

---

## `automata config`

Launch the interactive configuration wizard. Use arrow keys to move between menu entries and press Enter to select.

| Menu entry | Settings |
|---|---|
| Remote / Mode | `remoteType` |
| Implement-Next | `issueDiscoveryTechnique`, `issueDiscoveryValue`, `claudeSystemPrompt` |
| Prompts | `prompts.sonar`, `prompts.fixComments`, `prompts.checkIssue` |
| Issue Watch | `allowedUsers`, `agentUser` |

```bash
automata config
```

Configuration is saved to `.automata/config.json` in the current directory.

---

## `automata config set type <value>`

Set a configuration value non-interactively (useful in scripts or CI).

```bash
automata config set type gh      # GitHub
automata config set type azdo    # Azure DevOps
```

### Supported values

| Value | Description |
|---|---|
| `gh` | GitHub (requires [`gh` CLI](https://cli.github.com/)) |
| `azdo` | Azure DevOps |

### Config file location

`.automata/config.json` in the current working directory.

---

## `automata config set allowed-users <value>`

Set the comma-separated list of GitHub logins allowed to instruct the agent on an issue. Used by [`automata execute-prompt check-issue`](execute-prompt.md#automata-execute-prompt-check-issue-issue-number): only these users can trigger a run, and only their messages (plus the agent's own) are passed to the AI.

```bash
automata config set allowed-users alice,bob
```

Entries are trimmed and empty entries are dropped. The command exits 1 if no login remains. Stored under `allowedUsers`.

---

## `automata config set agent-user <value>`

Set the GitHub login the agent itself posts as. `check-issue` uses the agent's newest comment on an issue as the boundary for "what have I already handled", and includes the agent's messages in the conversation it passes to the AI.

```bash
automata config set agent-user agent-bot
```

Stored under `agentUser`. This should be the account `gh` is authenticated as, since that is who the agent's comments are posted by.

---

## Prompt file references

Prompt-type fields (`claudeSystemPrompt`, `prompts.sonar`, `prompts.fixComments`, `prompts.checkIssue`) support **file references** as an alternative to inline strings. When a field value ends with `.md`, automata reads the content from `.automata/<filename>` at run time instead of using the raw string. This keeps long prompts out of JSON and makes them easy to edit in any text editor.

**Example `config.json`:**

```json
{
  "remoteType": "gh",
  "claudeSystemPrompt": "claude-system-prompt.md",
  "allowedUsers": ["alice", "bob"],
  "agentUser": "agent-bot",
  "prompts": {
    "sonar": "sonar-prompt.md"
  }
}
```

**Corresponding files:**

```
.automata/
├── config.json
├── claude-system-prompt.md   ← prompt content goes here
└── sonar-prompt.md           ← prompt content goes here
```

### Rules

- The referenced file **must** be located directly inside `.automata/` (no subdirectories, no path traversal).
- If the file does not exist, automata exits with an error.
- Any value that does **not** end with `.md` is used as an inline string unchanged (backward compatible).
- The interactive wizard (`automata config`) automatically writes prompt content to the appropriate `.md` file and stores only the filename in `config.json`.

### Wizard filename mapping

| Config field | File written by wizard |
|---|---|
| `claudeSystemPrompt` | `.automata/claude-system-prompt.md` |
| `prompts.sonar` | `.automata/sonar-prompt.md` |
| `prompts.fixComments` | `.automata/fix-comments-prompt.md` |
| `prompts.checkIssue` | `.automata/check-issue-prompt.md` |

---

## `doWork`

Settings for [`automata do-work`](do-work.md). Every field is optional and has a working default, so the minimum configuration for `do-work` is none at all — but the shared keys it depends on (`remoteType`, `issueDiscoveryTechnique`, `issueDiscoveryValue`, `allowedUsers`, `agentUser`) are all required.

```json
{
  "remoteType": "gh",
  "issueDiscoveryTechnique": "label",
  "issueDiscoveryValue": "automated",
  "allowedUsers": ["alice", "bob"],
  "agentUser": "automata-bot",
  "doWork": {
    "baseBranch": "develop",
    "executor": "claude",
    "models": {
      "claude": "claude-opus-4-6",
      "codex": "o3"
    },
    "maxRunsPerTick": 0,
    "lockStaleMinutes": 120,
    "prompts": {
      "issueDiscuss": "do-work-issue-discuss.md",
      "prWork": "do-work-pr-work.md"
    }
  }
}
```

| Key | Default | Meaning |
|---|---|---|
| `baseBranch` | `develop` | The branch a discussion turn returns to, and the branch new work is expected to branch off. |
| `protectedBranches` | `["main", "master"]` | Extra branches a build turn must never check out and push to. The base branch and the repository default are always refused; this covers the rest. In GitFlow the default branch is often `develop`, so without it a back-merge pull request `main → develop` carrying `Closes #N` would be worked on `main`. |
| `executor` | `claude` | Which AI executor to invoke: `claude` or `codex`. Overridden for one turn by a `tool:` directive in the message that triggers it — see [do-work.md](do-work.md#steering-one-turn-from-a-message). |
| `models.claude` | *(none)* | Default model when the executor is Claude; blank means the executor's own default. Overridden for one turn by a `model:` directive in the triggering message. |
| `models.codex` | *(none)* | Default model when the executor is Codex. |
| `maxRunsPerTick` | `0` | Maximum model runs per tick; `0` means unlimited. Items beyond the cap are reported as `deferred`. |
| `lockStaleMinutes` | `120` | How long a run lock **from another host** may be held before it is treated as stale. On this host, liveness decides and age is not consulted. |
| `prompts.issueDiscuss` | built-in | Instructions for a discussion turn. |
| `prompts.prWork` | built-in | Instructions for a pull-request turn. |

### Setting these non-interactively

```bash
automata config set do-work-base-branch main
automata config set do-work-protected-branches main,master
automata config set do-work-executor codex
automata config set do-work-model claude claude-opus-4-6
automata config set do-work-model codex o3
automata config set do-work-max-runs 2
automata config set do-work-lock-stale-minutes 45
automata config set do-work-prompt issue-discuss do-work-issue-discuss.md
automata config set do-work-prompt pr-work "Use the `my-pr-skill` skill."
```

`do-work-prompt` takes the turn kind (`issue-discuss` or `pr-work`) followed by prompt text or a `.md` filename. `do-work-model` takes the executor (`claude` or `codex`) followed by the model identifier — the defaults are kept per executor because a model identifier is only valid for the executor it belongs to, so one shared field would send nonsense the moment you switched executor. `--model` on the command line overrides whichever default applies.

### The turn prompts

The `doWork.prompts.*` values follow the same rules as every other prompt field — inline text, or a plain `.md` filename resolved inside `.automata/` (see [Prompt file references](#prompt-file-references)) — with one important difference:

> **An unresolvable prompt reference is always an error.** `readConfig()` resolves every configured `.md` reference through the same throwing helper, so a missing file or one outside `.automata/` fails for any prompt field — there is no silent fallback anywhere. What `do-work` adds is a *clean* failure: it catches the error and exits 1 with an actionable message rather than surfacing a stack trace, because on an unattended loop the operator only sees the log.

These prompts are where a **skill** gets named — automata itself has no concept of a skill. The built-in defaults name none, so `do-work` works with nothing installed. See [wiki/Prompts.md](wiki/Prompts.md) for the contract and a worked example.

### Wizard filename mapping

| Wizard screen | File written |
|---|---|
| Prompts → Do Work — Discuss | `.automata/do-work-issue-discuss.md` |
| Prompts → Do Work — PR | `.automata/do-work-pr-work.md` |

The `Do Work` entry on the main menu sets `baseBranch`, `protectedBranches`, `executor`, both models, `maxRunsPerTick` and `lockStaleMinutes`, so every `doWork` setting is reachable interactively as well as through `config set`.
