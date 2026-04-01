# automata config

Commands for configuring the tool.

---

## `automata config`

Launch the interactive configuration wizard. Use arrow keys to select the remote environment type and press Enter to save.

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

## Prompt file references

Prompt-type fields (`claudeSystemPrompt`, `prompts.sonar`, `prompts.fixComments`) support **file references** as an alternative to inline strings. When a field value ends with `.md`, automata reads the content from `.automata/<filename>` at run time instead of using the raw string. This keeps long prompts out of JSON and makes them easy to edit in any text editor.

**Example `config.json`:**

```json
{
  "remoteType": "gh",
  "claudeSystemPrompt": "claude-system-prompt.md",
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
