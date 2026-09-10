# automata execute-prompt

AI-powered prompt execution commands. These commands look up context from the remote — the current branch's pull request (a SonarCloud analysis URL, open review comments) or a named issue's conversation — and invoke an AI assistant with a pre-configured prompt.

All three subcommands share the same executor options: `--with`, `--model`, `--effort`, `--silent` and `--push`.

`--effort <level>` is forwarded to the executor unchanged, but the two express it differently: `claude` receives `--effort <level>`, while `codex` — which has no effort flag — receives `-c model_reasoning_effort="<level>"`. automata does not validate the level, because the valid set is executor- and model-specific and moves between executor releases; only an empty value is refused. Note that neither executor errors on an unknown level — `claude` warns and falls back to its default, and `codex` forwards it to the API — so a typo is quiet rather than fatal. Unlike `do-work`, these subcommands have no configured default, for either the model or the effort.

---

## `automata execute-prompt sonar`

Check the current branch's pull request for a SonarCloud analysis and invoke the AI assistant with the configured Sonar prompt, the analysis URL, and the structured `get-pr-info` Sonar context.

```bash
automata execute-prompt sonar --with claude
automata execute-prompt sonar --with codex --model o3
automata execute-prompt sonar --with claude --effort high
automata execute-prompt sonar --with claude --silent
automata execute-prompt sonar --with claude --push
```

### Options

| Flag | Description |
|---|---|
| `--with <executor>` | Required executor selector: `claude` or `codex` |
| `--model <string>` | Model identifier forwarded to the selected executor CLI |
| `--effort <level>` | Reasoning effort forwarded to the selected executor CLI |
| `--silent` | Suppress step-by-step Claude output; Codex ignores this flag |
| `--push` | Append instruction to commit and push changes after the AI finishes |

### How it works

1. Detects the current branch and looks up the associated pull request via `gh`.
2. Checks the PR status checks for a SonarCloud check (identified by `sonarcloud.io` hostname in the check URL).
3. Builds a prompt from the configured `prompts.sonar` value (or the built-in default), appends the SonarCloud analysis URL, and appends the current PR's structured `automata git get-pr-info --json` payload.
4. Invokes Claude Code or Codex with the composed prompt.

Claude follows the same output behavior as `automata execute`: verbose progress is on by default, and `--silent` suppresses step-by-step output.

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
automata execute-prompt fix-comments --with claude
automata execute-prompt fix-comments --with codex --model o3
automata execute-prompt fix-comments --with claude --silent
automata execute-prompt fix-comments --with claude --push
```

### Options

| Flag | Description |
|---|---|
| `--with <executor>` | Required executor selector: `claude` or `codex` |
| `--model <string>` | Model identifier forwarded to the selected executor CLI |
| `--effort <level>` | Reasoning effort forwarded to the selected executor CLI |
| `--silent` | Suppress step-by-step Claude output; Codex ignores this flag |
| `--push` | Append instruction to commit and push changes after the AI finishes |

### How it works

1. Detects the current branch and looks up the associated pull request via `gh`.
2. Fetches all unresolved review thread comments on the PR via the GitHub GraphQL API.
3. Builds a prompt from the configured `prompts.fixComments` value (or the built-in default) and appends the formatted comment list.
4. Invokes Claude Code or Codex with the composed prompt.

Claude follows the same output behavior as `automata execute`: verbose progress is on by default, and `--silent` suppresses step-by-step output.

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

---

## `automata execute-prompt check-issue <issue-number>`

Read a GitHub issue, decide whether one of the configured allowed users has posted a message since the agent's last run, and — if so — invoke the AI assistant with the configured Check-Issue prompt and the issue conversation.

```bash
automata execute-prompt check-issue 34 --with claude
automata execute-prompt check-issue 34 --with codex --model o3
automata execute-prompt check-issue 34 --with claude --force
automata execute-prompt check-issue 34 --with claude --push
```

### Options

| Flag | Description |
|---|---|
| `--with <executor>` | Required executor selector: `claude` or `codex` |
| `--model <string>` | Model identifier forwarded to the selected executor CLI |
| `--effort <level>` | Reasoning effort forwarded to the selected executor CLI |
| `--silent` | Suppress step-by-step Claude output; Codex ignores this flag |
| `--push` | Append instruction to commit and push changes after the AI finishes |
| `--force` | Skip the new-message check and invoke the AI directly |

### Required configuration

| Key | Description |
|---|---|
| `allowedUsers` | Logins allowed to instruct the agent on an issue. Their messages both trigger runs and appear in the prompt. |
| `agentUser` | The login the agent posts as. Used as the last-execution boundary and included in the conversation. |

Set them with `automata config set allowed-users alice,bob` and `automata config set agent-user agent-bot`, or through **Issue Watch** in `automata config`. See [docs/config.md](config.md).

### How it works

1. Reads the issue and all of its comments via `gh issue view`.
2. Takes the **newest comment authored by `agentUser`** as the last-execution boundary.
3. Reports a new message when at least one comment from a user in `allowedUsers` is strictly newer than that boundary. When `agentUser` has never commented, the issue counts as new if it was opened by an allowed user or any allowed user has commented.
4. If there is no new message and `--force` was not passed, prints an explanation and exits `0` without posting anything or invoking the AI.
5. Otherwise builds the prompt from `prompts.checkIssue` (or the built-in default), the issue number, title and URL, and the filtered conversation.
6. Posts a short marker comment on the issue as the agent account — this is what moves the boundary — and aborts without invoking the AI if that comment cannot be posted.
7. Invokes Claude Code or Codex with the composed prompt.

Claude follows the same output behavior as `automata execute`: verbose progress is on by default, and `--silent` suppresses step-by-step output.

### Detection rules

- The boundary is stored on the issue itself, not on disk, so the command behaves identically from any machine, container, or CI runner.
- Comments authored by `agentUser` never count as new messages, even if that login is also listed in `allowedUsers`. This is what stops the command from retriggering on its own marker comment.
- Messages from anyone who is neither allowed nor the agent are ignored: they never trigger a run and never appear in the prompt.
- The same filter applies to the issue description, so an issue opened by a non-allowed user contributes its number, title and URL to the prompt but not its body.
- Login matching is case-insensitive.
- A comment whose timestamp exactly equals the boundary counts as *not* new; use `--force` to run anyway.

### Conversation format

Messages are rendered oldest-first, one block each:

```text
[alice] issue description · 2026-09-09T05:00:00Z
Please add the check-issue command.

[agent-bot] comment · 2026-09-09T06:00:00Z
working

[bob] comment · 2026-09-09T07:00:00Z · NEW since last agent run
also handle the --force flag
```

### Configuring the Check-Issue prompt

Run `automata config` and navigate to **Prompts → Check-Issue** to set a custom prompt. The prompt is stored in `.automata/config.json` under `prompts.checkIssue`.

If no custom prompt is configured, the built-in default is used:

> You are an expert software engineer working on a GitHub issue. Below is the conversation on that issue, restricted to the people allowed to instruct you and your own previous replies. Messages marked as new arrived after your last run: treat them as the current instruction and read the earlier messages only as context. Do what the new messages ask, following the project's existing conventions and style, and make minimal, targeted changes. Run tests and linting before finishing, then reply on the issue with a short summary of what you did.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | AI invocation completed successfully, **or** no new message was found and nothing needed to be done |
| `1` | Invalid issue number, missing `allowedUsers` / `agentUser`, Azure DevOps remote, issue could not be read, marker comment could not be posted, or AI tool error |

> **Note**: `check-issue` requires GitHub; it is rejected when `remoteType` is `azdo`. See [docs/azdo-gap.md](azdo-gap.md).
