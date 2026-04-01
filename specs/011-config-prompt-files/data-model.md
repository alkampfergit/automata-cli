# Data Model: Config Prompt Files

**Branch**: `011-config-prompt-files` | **Date**: 2026-04-01

## Entities

### AutomataConfig (existing, unchanged schema)

Fields in `.automata/config.json`:

| Field | Type | Description |
|-------|------|-------------|
| `remoteType` | `"gh" \| "azdo"` | Remote VCS type — short value, inline only |
| `issueDiscoveryTechnique` | `"label" \| "assignee" \| "title-contains"` | Short value, inline only |
| `issueDiscoveryValue` | `string` | Label/username/search string — short, inline only |
| `claudeSystemPrompt` | `string` | **Prompt field** — may be an inline string or a `.md` filename |
| `prompts.sonar` | `string` | **Prompt field** — may be an inline string or a `.md` filename |
| `prompts.fixComments` | `string` | **Prompt field** — may be an inline string or a `.md` filename |

*The JSON schema does not change. The `.md` filename convention is a read-time resolution rule.*

### PromptRef (conceptual, not a stored type)

A `PromptRef` is any `string` value of a prompt field that ends with `.md`. It is resolved by `resolvePromptRef()` to the file contents at read time.

| Property | Value |
|----------|-------|
| Format | `"<filename>.md"` (no directory separators) |
| Location | `.automata/<filename>.md` |
| Content | Raw markdown text (the prompt) |

## Resolution Rules

```
promptFieldValue → resolvePromptRef(value, automataDir)
  if value ends with ".md":
    resolved = path.resolve(automataDir, value)
    assert resolved starts with automataDir + path.sep  → error if not
    return readFileSync(resolved, "utf8")
  else:
    return value unchanged
```

## Wizard Filename Mapping

| Config field | Written filename |
|--------------|-----------------|
| `claudeSystemPrompt` | `claude-system-prompt.md` |
| `prompts.sonar` | `sonar-prompt.md` |
| `prompts.fixComments` | `fix-comments-prompt.md` |
