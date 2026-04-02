# `automata implement-next`

Find the next open GitHub issue matching the configured filter, claim it by posting a comment, and invoke Claude Code to implement it.

## Prerequisites

- `gh` CLI installed and authenticated
- `claude` CLI installed (unless `--no-claude` or `--codex` is used)
- `codex` CLI installed (only when `--codex` is used)
- Remote type set to `gh` via `automata config`
- Issue discovery technique and value configured

## Usage

```bash
automata implement-next [options]
```

## Options

| Option | Description |
|---|---|
| `--json` | Output issue details as JSON |
| `--no-claude` | Claim the issue without launching any AI tool |
| `--codex` | Use Codex CLI instead of Claude Code |
| `--query-only` | Print the issue content and exit (no claim, no AI) |
| `--yolo` | Skip permissions: `--dangerously-skip-permissions` (Claude) or `--dangerously-bypass-approvals-and-sandbox` (Codex) |
| `--verbose` | Show step-by-step progress summary and final result |
| `--opus` | Use `claude-opus-4-6` (Claude only) |
| `--sonnet` | Use `claude-sonnet-4-6` (Claude only) |
| `--haiku` | Use `claude-haiku-4-5-20251001` (Claude only) |
| `--take-first` | When multiple issues match, pick the first without prompting |
| `--limit <n>` | Max issues to fetch and display (default: `10`) |

## Behaviour

1. Reads `.automata/config.json` for discovery technique and value.
2. Runs `gh issue list` with the appropriate filter (`--label`, `--assignee`, or `--search`), fetching up to `--limit` issues (default 10).
3. **If no issues found**: prints "No issues found" and exits.
4. **If one issue found**: prints its ID and title, then proceeds.
5. **If multiple issues found**:
   - Without `--take-first`: displays a numbered list and prompts you to choose. If the number of issues equals the limit, a note is shown that there may be more (use `--limit` to fetch more).
   - With `--take-first`: prints which issue was selected (ID + title) and proceeds immediately without prompting.
6. If `--query-only` is set, prints the issue(s) and exits (no claim, no AI). With multiple issues, the numbered list is printed and no selection prompt appears.
7. Posts a `working` comment on the selected issue.
8. Unless `--no-claude`, launches the AI tool with a prompt that includes the issue number, the configured system prompt, and the issue body.
   - Default: invokes `claude -p` (Claude Code).
   - With `--codex`: invokes `codex exec` (Codex CLI) using the same prompt.
   - With `--yolo`: Claude uses `--dangerously-skip-permissions`; Codex uses `--dangerously-bypass-approvals-and-sandbox`.
   - With `--verbose`: streams progress events to stderr and prints the final result to stdout.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Success, or no matching issues found |
| `1` | Configuration error, invalid `--limit`, invalid selection input, `gh`/`claude` not found, or GitHub API failure |

## Examples

```bash
# Just see what issues are available
automata implement-next --query-only

# Claim and implement with full autonomy (Claude)
automata implement-next --yolo

# Claim and implement using Codex instead of Claude
automata implement-next --codex

# Use Codex with full autonomy and verbose progress
automata implement-next --codex --yolo --verbose

# Claim the issue but handle implementation yourself
automata implement-next --no-claude

# Skip interactive selection and pick the first matching issue
automata implement-next --take-first --yolo

# Fetch and choose from up to 20 issues instead of the default 10
automata implement-next --limit 20
```
