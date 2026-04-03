# `automata execute` Command

Delegate work to an AI executor (Claude or Codex) by providing a prompt inline, from a file, or via stdin. Execution is always unattended and verbose by default.

## Usage

```bash
automata execute --with <executor> [prompt source] [options]
```

## Options

| Option | Required | Description |
|--------|----------|-------------|
| `--with <executor>` | **Yes** | Executor to use: `claude` or `codex` |
| `--prompt <string>` | No† | Prompt text passed directly on the command line |
| `--file-prompt <path>` | No† | Path to a file whose content is used as the prompt |
| `--silent` | No | Suppress step-by-step output; show only the final summary |
| `--model <string>` | No | Model identifier forwarded to the executor CLI |

† Exactly one prompt source must be provided: `--prompt`, `--file-prompt`, or piped stdin.

## Prompt Sources

The three prompt sources are mutually exclusive. `--prompt` cannot be combined with `--file-prompt` or piped stdin.

### Inline prompt

```bash
automata execute --with claude --prompt "refactor the auth module"
automata execute --with codex  --prompt "fix all lint errors"
```

### Prompt from file

```bash
automata execute --with claude --file-prompt prompts/sonar-fix.md
automata execute --with codex  --file-prompt prompts/refactor.md
```

### Prompt from stdin

```bash
echo "add docstrings to all exported functions" | automata execute --with claude
cat prompt.md | automata execute --with codex
```

## Behavior

1. Resolves the `claude` or `codex` binary from PATH.
2. Reads the prompt from the selected source.
3. Invokes the executor in **unattended mode** (permissions bypass enabled automatically).
4. By default, streams step-by-step progress to stderr and the final result to stdout.
5. With `--silent`, step-by-step output is suppressed; only the final result is written to stdout.
6. When `--model` is provided, the model string is forwarded to the executor CLI via its `--model` flag.

## Output (default verbose mode — Claude)

```
  [step 1] reading src/auth.ts
  [step 2] editing src/auth.ts
  [step 3] running: npm test

--- Result ---
  [info] 3 turns | 5.2s | $0.0150
Refactored auth module: extracted token validation into a separate function.
```

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Executor completed successfully |
| `1` | Missing or invalid options, file not found, no prompt provided, or executor not on PATH |
| `N` | Executor exited with code N |

## Examples

```bash
# Delegate a task to Claude with verbose output (default)
automata execute --with claude --prompt "review src/ for security issues"

# Use Codex with a specific model
automata execute --with codex --model o3 --prompt "fix TypeScript errors"

# Run silently and capture the result
result=$(automata execute --with claude --silent --prompt "summarise changes in git diff HEAD~1")

# Chain with other tools
automata git get-pr-info | automata execute --with claude --silent
```
