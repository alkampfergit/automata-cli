# `automata test` Command Group

Test commands for verifying automata integrations.

## `test claude`

Test Claude Code invocation with a user-supplied prompt.

```bash
automata test claude --prompt "your prompt here"
automata test claude --prompt "your prompt here" --yolo
```

### Options

| Option | Required | Description |
|--------|----------|-------------|
| `--prompt <string>` | Yes | The prompt to send to Claude Code |
| `--yolo` | No | Launch Claude Code with `--dangerously-skip-permissions` |

### Behavior

1. Resolves the `claude` binary from PATH.
2. Spawns Claude Code with the supplied prompt via `-p`.
3. Inherits stdio so output appears in the terminal in real time.
4. When `--yolo` is passed, adds `--dangerously-skip-permissions` before `-p`.

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
```
