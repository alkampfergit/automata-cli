# Data Model: GitHub Issue Discovery and Auto-Implementation (get-ready)

**Branch**: `003-gh-get-ready` | **Date**: 2026-03-30

## AutomataConfig (extended)

The existing `AutomataConfig` interface in `src/config/configStore.ts` is extended with three new optional fields:

| Field | Type | Description |
|-------|------|-------------|
| `remoteType` | `"gh" \| "azdo"` | Existing field: remote environment type |
| `issueDiscoveryTechnique` | `"label" \| "assignee" \| "title-contains" \| undefined` | Which filter technique to use |
| `issueDiscoveryValue` | `string \| undefined` | The value for the selected technique (e.g., label name, username, search string) |
| `claudeSystemPrompt` | `string \| undefined` | Optional system prompt prepended to the Claude Code invocation |

## IssueDiscoveryTechnique (type alias)

```
type IssueDiscoveryTechnique = "label" | "assignee" | "title-contains";
```

## GitHubIssue

Represents a GitHub issue retrieved via `gh issue list`:

| Field | Type | Description |
|-------|------|-------------|
| `number` | `number` | Issue number |
| `title` | `string` | Issue title |
| `body` | `string` | Issue body (first message content) |
| `url` | `string` | URL to the issue on GitHub |

## gh CLI Mapping

| Technique | gh CLI flags |
|-----------|-------------|
| `label` | `gh issue list --label "<value>" --state open --sort created --order asc --limit 1 --json number,title,body,url` |
| `assignee` | `gh issue list --assignee "<value>" --state open --sort created --order asc --limit 1 --json number,title,body,url` |
| `title-contains` | `gh issue list --search "<value> in:title" --state open --sort created --order asc --limit 1 --json number,title,body,url` |
