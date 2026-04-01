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

## Behaviour

1. Reads `.automata/config.json` for discovery technique and value.
2. Runs `gh issue list` with the appropriate filter (`--label`, `--assignee`, or `--search`).
3. Picks the first (oldest) open issue returned.
4. Prints issue details to stdout.
5. If `--query-only` is set, exits here.
6. Posts a `working` comment on the issue.
7. Unless `--no-claude`, launches the AI tool with the issue body (prepended by the configured system prompt, if any).
   - Default: invokes `claude -p` (Claude Code).
   - With `--codex`: invokes `codex exec` (Codex CLI) using the same prompt.
   - With `--yolo`: Claude uses `--dangerously-skip-permissions`; Codex uses `--dangerously-bypass-approvals-and-sandbox`.
   - With `--verbose`: streams progress events to stderr and prints the final result to stdout.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Success, or no matching issues found |
| `1` | Configuration error, `gh`/`claude` not found, or GitHub API failure |

## Examples

```bash
# Just see what issue would be picked up
automata implement-next --query-only

# Claim and implement with full autonomy (Claude)
automata implement-next --yolo

# Claim and implement using Codex instead of Claude
automata implement-next --codex

# Use Codex with full autonomy and verbose progress
automata implement-next --codex --yolo --verbose

# Claim the issue but handle implementation yourself
automata implement-next --no-claude
```
