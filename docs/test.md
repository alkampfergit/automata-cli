# `automata test` Command Group

Test commands for verifying automata integrations.

## `test claude`

Test Claude Code invocation with a user-supplied prompt.

```bash
automata test claude --prompt "your prompt here"
automata test claude --prompt "your prompt here" --yolo
automata test claude --prompt "your prompt here" --verbose
```

### Options

| Option | Required | Description |
|--------|----------|-------------|
| `--prompt <string>` | Yes | The prompt to send to Claude Code |
| `--yolo` | No | Launch Claude Code with `--dangerously-skip-permissions` |
| `--verbose` | No | Show step-by-step progress summary and final result |
| `--opus`   | No | Use `claude-opus-4-6` (mutually exclusive with --sonnet/--haiku) |
| `--sonnet` | No | Use `claude-sonnet-4-6` (mutually exclusive with --opus/--haiku) |
| `--haiku`  | No | Use `claude-haiku-4-5-20251001` (mutually exclusive with --opus/--sonnet) |

### Behavior

1. Resolves the `claude` binary from PATH.
2. Spawns Claude Code with the supplied prompt via `-p`.
3. Inherits stdio so output appears in the terminal in real time.
4. When `--yolo` is passed, adds `--dangerously-skip-permissions` before `-p`.
5. When `--verbose` is passed, streams Claude's activity and prints a human-readable summary of each step (tool calls, text snippets) to stderr, then prints the final result to stdout with cost/duration info.

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Claude Code completed successfully |
| `1` | `claude` binary not found on PATH |
| `N` | Claude Code exited with code N |

### Examples

```bash
# Simple test
automata test claude --prompt "say hello"

# Test with permissions skip
automata test claude --prompt "list files in current directory" --yolo

# Test with verbose progress (see each step Claude takes)
automata test claude --prompt "say hello" --verbose
# Output:
#   [step 1] Let me help you with that...
#   [step 2] reading src/index.ts
#   [step 3] running: npm test
#
#   --- Result ---
#   [info] 3 turns | 5.2s | $0.0150
#   Hello! Everything looks good.
```

## `test codex`

Test Codex CLI invocation with a user-supplied prompt.

```bash
automata test codex --prompt "your prompt here"
automata test codex --prompt "your prompt here" --yolo
automata test codex --prompt "your prompt here" --verbose
```

### Options

| Option | Required | Description |
|--------|----------|-------------|
| `--prompt <string>` | Yes | The prompt to send to the Codex CLI |
| `--yolo` | No | Launch Codex with `--dangerously-bypass-approvals-and-sandbox` |
| `--verbose` | No | Show step-by-step progress and final result |

### Behavior

1. Resolves the `codex` binary from PATH.
2. Spawns `codex exec <prompt>`.
3. Inherits stdio so output appears in the terminal in real time.
4. When `--yolo` is passed, adds `--dangerously-bypass-approvals-and-sandbox`.
5. When `--verbose` is passed, streams Codex's JSONL activity and prints a human-readable summary of each step to stderr, then prints the final result to stdout.

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Codex completed successfully |
| `1` | `codex` binary not found on PATH |
| `N` | Codex exited with code N |

### Examples

```bash
# Simple test
automata test codex --prompt "say hello"

# Test with sandbox bypass
automata test codex --prompt "list files" --yolo

# Test with verbose progress
automata test codex --prompt "say hello" --verbose
```
