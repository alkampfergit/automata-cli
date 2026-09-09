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
