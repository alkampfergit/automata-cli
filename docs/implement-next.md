# `automata implement-next`

Find the next open GitHub issue matching the configured filter, claim it by posting a comment, and invoke an AI code assistant to implement it.

## Prerequisites

- `gh` CLI installed and authenticated
- `claude` CLI installed (unless `--no-claude` or `--with codex` is used)
- `codex` CLI installed (only when `--with codex` is used)
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
| `--with <executor>` | Executor to use: `claude` or `codex` (default: `claude`) |
| `--query-only` | Print the issue content and exit (no claim, no AI) |
| `--yolo` | Skip permissions: `--dangerously-skip-permissions` (Claude) or `--dangerously-bypass-approvals-and-sandbox` (Codex) |
| `--silent` | Suppress step-by-step Claude output; show only the final summary. With `--with codex`, this prints a warning and has no effect. |
| `--model <string>` | Model identifier to pass to the executor (e.g. `claude-opus-4-6`) |
| `--take-first` | When multiple issues match, pick the first without prompting |
| `--limit <n>` | Max issues to fetch and display (default: `10`) |
| `--ask-copilot-review` | After AI finishes, if a PR exists on the branch, request a Copilot code review via `gh pr edit --add-reviewer @copilot` |

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
   - Default: invokes `claude -p` (Claude Code) with verbose output (step-by-step progress).
   - With `--with codex`: invokes `codex exec` (Codex CLI) using the same prompt.
   - With `--yolo`: Claude uses `--dangerously-skip-permissions`; Codex uses `--dangerously-bypass-approvals-and-sandbox`.
  - With `--silent`: suppresses verbose Claude streaming output and shows only the final result. When combined with `--with codex`, a warning is printed and Codex behavior is unchanged.
   - With `--model`: passes the specified model identifier to the executor.
9. After the AI tool finishes (or immediately after claiming when `--no-claude`), checks if the current branch has an open pull request:
   - If a PR exists and a comment URL was captured in step 7, edits the "working" comment to include the PR number and link.
   - If a PR exists, appends `Closes #<issue>` to the PR body so merging the PR auto-closes the issue.
   - If `--ask-copilot-review` is passed and a PR exists, runs `gh pr edit --add-reviewer @copilot` to request a Copilot review.
   - All post-AI operations are best-effort: failures are warned on stderr but do not change the exit code.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Success, or no matching issues found |
| `1` | Configuration error, invalid `--limit`, invalid `--with` value, invalid selection input, `gh`/`claude` not found, or GitHub API failure |

## Examples

```bash
# Just see what issues are available
automata implement-next --query-only

# Claim and implement with full autonomy (Claude, default)
automata implement-next --yolo

# Claim and implement using Codex instead of Claude
automata implement-next --with codex

# Use a specific model
automata implement-next --model claude-sonnet-4-6

# Use Codex with a specific model and full autonomy
automata implement-next --with codex --yolo --model o3

# Claim the issue but handle implementation yourself
automata implement-next --no-claude

# Skip interactive selection and pick the first matching issue
automata implement-next --take-first --yolo

# Suppress verbose output
automata implement-next --silent

# Fetch and choose from up to 20 issues instead of the default 10
automata implement-next --limit 20

# Implement and request a Copilot review on the resulting PR
automata implement-next --yolo --ask-copilot-review
```
