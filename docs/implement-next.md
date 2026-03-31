# `automata implement-next`

Find the next open GitHub issue matching the configured filter, claim it by posting a comment, and invoke Claude Code to implement it.

## Prerequisites

- `gh` CLI installed and authenticated
- `claude` CLI installed (unless `--no-claude` is used)
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
| `--no-claude` | Claim the issue without launching Claude Code |
| `--query-only` | Print the issue content and exit (no claim, no Claude) |
| `--yolo` | Launch Claude Code with `--dangerously-skip-permissions` |

## Behaviour

1. Reads `.automata/config.json` for discovery technique and value.
2. Runs `gh issue list` with the appropriate filter (`--label`, `--assignee`, or `--search`).
3. Picks the first (oldest) open issue returned.
4. Prints issue details to stdout.
5. If `--query-only` is set, exits here.
6. Posts a `working` comment on the issue.
7. Unless `--no-claude`, launches `claude -p` with the issue body (prepended by the configured system prompt, if any).
   - With `--yolo`, Claude is launched with `--dangerously-skip-permissions`.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Success, or no matching issues found |
| `1` | Configuration error, `gh`/`claude` not found, or GitHub API failure |

## Examples

```bash
# Just see what issue would be picked up
automata implement-next --query-only

# Claim and implement with full autonomy
automata implement-next --yolo

# Claim the issue but handle implementation yourself
automata implement-next --no-claude
```
