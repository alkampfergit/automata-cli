# automata execute-prompt

AI-powered prompt execution commands. These commands look up context from the current branch (e.g. a SonarCloud analysis URL) and invoke an AI assistant with a pre-configured prompt.

---

## `automata execute-prompt sonar`

Check the current branch's pull request for a SonarCloud analysis and invoke the AI assistant with the configured Sonar prompt and the analysis URL as context.

```bash
automata execute-prompt sonar            # Use Claude (default)
automata execute-prompt sonar --codex    # Use Codex CLI instead
automata execute-prompt sonar --verbose  # Verbose Claude output
```

### Options

| Flag | Description |
|---|---|
| `--codex` | Use Codex CLI instead of Claude Code |
| `--verbose` | Show step-by-step Claude output (Claude only; ignored for Codex) |
| `--opus` | Use `claude-opus-4-6` model (Claude only) |
| `--sonnet` | Use `claude-sonnet-4-6` model (Claude only) |
| `--haiku` | Use `claude-haiku-4-5-20251001` model (Claude only) |

### How it works

1. Detects the current branch and looks up the associated pull request via `gh`.
2. Checks the PR status checks for a SonarCloud check (identified by `sonarcloud.io` in the check URL).
3. Builds a prompt from the configured `prompts.sonar` value (or the built-in default) and appends the SonarCloud analysis URL.
4. Invokes Claude Code or Codex with the composed prompt.

### Configuring the Sonar prompt

Run `automata config` and navigate to **Prompts → Sonar** to set a custom prompt. The prompt is stored in `.automata/config.json` under `prompts.sonar`.

If no custom prompt is configured, the built-in default is used:

> You are an expert software engineer. You have been given the URL of a SonarCloud analysis for this pull request. Please visit the SonarCloud analysis URL provided and fix all new issues reported. Focus on code smells, bugs, and vulnerabilities flagged as new in this PR. Make targeted, minimal changes that resolve each issue without altering unrelated code.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | AI invocation completed successfully |
| `1` | No current branch, no PR found, no SonarCloud check found, or AI tool error |
