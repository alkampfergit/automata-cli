---
name: automata
description: >
  Use when the user wants to work through the automata CLI feature-delivery
  loop: pick up the next GitHub issue with `automata implement-next`, monitor
  PR status and CI checks with `automata git get-pr-info`, inspect unresolved
  review threads with `automata git get-pr-comments`, address reviewer
  feedback, and finish a merged feature with `automata git finish-feature`.
  Also use when the user asks how automata works for day-to-day implementation
  flow in this repository.
---

# Automata Skill

This skill covers the normal GitHub-based implementation loop for `automata`.
Use it when the task is "take the next feature", "check PR status", "fix PR
comments", or "finish the feature after approval".

Prefer `automata ...` when the CLI is installed. Inside this repository,
`npm exec -- automata ...` is a safe fallback.

## Preconditions

Use this workflow only when all of these are true:

- `remoteType` is `gh`
- `gh` is installed and authenticated
- `.automata/config.json` has `issueDiscoveryTechnique` and `issueDiscoveryValue`

Do not use this skill for Azure DevOps review-comment or issue-pickup flows:

- `automata implement-next` is not supported in `azdo` mode
- `automata git get-pr-comments` is not supported in `azdo` mode

If you need exact command semantics, read:

- `docs/implement-next.md` for pickup and implementation
- `docs/git.md` for PR status, review comments, and feature cleanup
- `docs/azdo-gap.md` for unsupported Azure DevOps paths

## Standard Workflow

### 1. Pick up the next feature

Start by seeing what automata would claim:

```bash
automata implement-next --query-only
```

This prints the selected open issue and exits without claiming it.

When you are ready to take the work:

```bash
automata implement-next
```

Important behavior:

- automata finds the first matching open GitHub issue from the configured filter
- it posts a `working` comment to claim the issue
- it then launches the AI tool unless disabled

Useful variants:

```bash
automata implement-next --no-claude
automata implement-next --codex
automata implement-next --codex --yolo --verbose
automata implement-next --json
```

Use these flags deliberately:

- `--query-only`: inspect the issue without claiming it
- `--no-claude`: claim the issue but do implementation manually
- `--codex`: use Codex CLI instead of Claude Code
- `--yolo`: skip permission prompts
- `--verbose`: stream progress
- `--json`: emit machine-readable issue data

If you are the agent doing the work yourself, `--query-only` or `--no-claude`
is often the safest path because it avoids launching another agent inside the
agent.

### 2. Implement the feature

After pickup, do the repository work normally:

- inspect the codebase and the claimed issue
- make targeted changes
- run the relevant tests and lint checks
- commit and push the branch
- open or update the pull request

automata does not replace normal engineering judgment. It helps with issue
selection, PR inspection, and post-review cleanup.

### 3. Check PR status and CI

Use `get-pr-info` on the current branch:

```bash
automata git get-pr-info
```

Useful variants:

```bash
automata git get-pr-info --json
automata git get-pr-info --wait-finish-checks
automata git get-pr-info --wait-finish-checks --json
```

How to use it:

- use the default output for a quick human read of PR number, state, URL, and checks
- use `--json` when you need to parse the full PR object
- use `--wait-finish-checks` when you want automata to block until all checks finish

Check symbols:

- `✓` passed
- `✗` failed
- `●` pending
- `○` skipped or neutral

When a check fails, automata prints the failure details and URL when available.
Use that output to decide whether to fix code, retry CI, or inspect external
pipeline logs.

### 4. Review unresolved PR comments

After reviewers leave feedback, inspect unresolved review threads:

```bash
automata git get-pr-comments
```

Machine-readable form:

```bash
automata git get-pr-comments --json
```

Use the results as a work queue:

- each block is an unresolved review thread
- comments include author, file path, and line when available
- `No open comments.` means there are no unresolved GitHub review threads

Expected loop:

1. run `automata git get-pr-comments`
2. fix the requested changes
3. rerun relevant tests
4. push updates
5. run `automata git get-pr-info --wait-finish-checks`
6. repeat until comments are resolved and checks pass

### 5. Finish the feature after approval and merge

Once the PR is approved, merged, and the remote feature branch is gone, clean up:

```bash
automata git finish-feature
```

This command is intentionally strict. It requires:

- you are not currently on `develop`
- the working tree is clean
- a PR exists for the branch
- that PR is merged
- the remote tracking branch no longer exists

On success it:

1. fetches with prune
2. checks out `develop`
3. pulls the latest `develop`
4. deletes the local feature branch

Do not run `finish-feature` before the PR is merged.

## Agent Guidance

- Prefer `implement-next --query-only` first when you need to inspect before claiming.
- Prefer `implement-next --no-claude` or manual implementation when already acting as the coding agent.
- Use `get-pr-info --wait-finish-checks` as the default merge-readiness gate.
- Use `get-pr-comments` after review, not before, because it only shows unresolved review threads.
- Treat `finish-feature` as the final cleanup step after merge, not as part of active review.
