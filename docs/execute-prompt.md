# automata execute-prompt

AI-powered prompt execution commands. These commands look up context from the current branch (e.g. a SonarCloud analysis URL or open review comments) and invoke an AI assistant with a pre-configured prompt.

---

## `automata execute-prompt sonar`

Check the current branch's pull request for a SonarCloud analysis and invoke the AI assistant with the configured Sonar prompt, the analysis URL, and the structured `get-pr-info` Sonar context.

```bash
automata execute-prompt sonar            # Use Claude (default)
automata execute-prompt sonar --codex    # Use Codex CLI instead
automata execute-prompt sonar --verbose  # Verbose Claude output
automata execute-prompt sonar --push     # Commit and push after AI finishes
```

### Options

| Flag | Description |
|---|---|
| `--codex` | Use Codex CLI instead of Claude Code |
| `--verbose` | Show step-by-step Claude output (Claude only; ignored for Codex) |
| `--push` | Append instruction to commit and push changes after the AI finishes |
| `--opus` | Use `claude-opus-4-6` model (Claude only) |
| `--sonnet` | Use `claude-sonnet-4-6` model (Claude only) |
| `--haiku` | Use `claude-haiku-4-5-20251001` model (Claude only) |

### How it works

1. Detects the current branch and looks up the associated pull request via `gh`.
2. Checks the PR status checks for a SonarCloud check (identified by `sonarcloud.io` hostname in the check URL).
3. Builds a prompt from the configured `prompts.sonar` value (or the built-in default), appends the SonarCloud analysis URL, and appends the current PR's structured `automata git get-pr-info --json` payload.
4. Invokes Claude Code or Codex with the composed prompt.

This means the AI receives any already-resolved Sonar details from `get-pr-info`, including fields such as `sonarNewIssues` and `sonarFailures`, so it can start from terminal context instead of always re-querying SonarCloud first.

### Configuring the Sonar prompt

Run `automata config` and navigate to **Prompts → Sonar** to set a custom prompt. The prompt is stored in `.automata/config.json` under `prompts.sonar`.

If no custom prompt is configured, the built-in default is used:

> You are an expert software engineer. You have been given the URL of a SonarCloud analysis for this pull request. If the `sonar-quality-gate` skill is available in this repository, use it. The project is public, so use the SonarCloud REST API directly (no authentication required) rather than scraping the URL. Inspect both the quality gate and the list of issues for this pull request. If the quality gate fails because of duplication or another metric-based condition, use the relevant Sonar APIs to identify the affected files and details instead of relying only on the issues endpoint. Fix all new issues and quality-gate failures reported. Focus on code smells, bugs, vulnerabilities, and blocking quality-gate conditions flagged in this PR. Make targeted, minimal changes that resolve each issue without altering unrelated code.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | AI invocation completed successfully |
| `1` | No current branch, no PR found, no SonarCloud check found, or AI tool error |

---

## `automata execute-prompt fix-comments`

Fetch open review comments on the current branch's pull request and invoke the AI assistant with the configured Fix-Comments prompt and the comment list as context.

```bash
automata execute-prompt fix-comments            # Use Claude (default)
automata execute-prompt fix-comments --codex    # Use Codex CLI instead
automata execute-prompt fix-comments --verbose  # Verbose Claude output
automata execute-prompt fix-comments --push     # Commit and push after AI finishes
```

### Options

| Flag | Description |
|---|---|
| `--codex` | Use Codex CLI instead of Claude Code |
| `--verbose` | Show step-by-step Claude output (Claude only; ignored for Codex) |
| `--push` | Append instruction to commit and push changes after the AI finishes |
| `--opus` | Use `claude-opus-4-6` model (Claude only) |
| `--sonnet` | Use `claude-sonnet-4-6` model (Claude only) |
| `--haiku` | Use `claude-haiku-4-5-20251001` model (Claude only) |

### How it works

1. Detects the current branch and looks up the associated pull request via `gh`.
2. Fetches all unresolved review thread comments on the PR via the GitHub GraphQL API.
3. Builds a prompt from the configured `prompts.fixComments` value (or the built-in default) and appends the formatted comment list.
4. Invokes Claude Code or Codex with the composed prompt.

### Configuring the Fix-Comments prompt

Run `automata config` and navigate to **Prompts → Fix-Comments** to set a custom prompt. The prompt is stored in `.automata/config.json` under `prompts.fixComments`.

If no custom prompt is configured, the built-in default is used:

> You are an expert software engineer reviewing a pull request. Below are the open review comments left by reviewers on this PR. Please address each comment by making the appropriate code changes. Focus on the reviewer's concerns and make minimal, targeted changes that resolve each comment without altering unrelated code.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | AI invocation completed successfully |
| `1` | No current branch, no PR found, no open comments found, unsupported remote, or AI tool error |

> **Note**: `fix-comments` is not supported for Azure DevOps remotes.
