---
name: sonar-quality-gate
description: Investigate SonarCloud quality gate failures for the current GitHub pull request. Use when a PR has a failing SonarCloud check, when the user asks where duplication or other Sonar failures come from, or when you need to trace a GitHub Sonar check into SonarCloud file-level and block-level details.
---

# Sonar Quality Gate

Use this skill to diagnose SonarCloud quality gate failures from the terminal.

## Goal

Turn a failing Sonar check into a compact, actionable report:
- PR number and URL
- quality gate status
- failing condition(s)
- affected file(s)
- exact duplicated block line ranges when duplication is the cause
- direct Sonar details URL

## Prerequisites

- `gh` CLI installed and authenticated
- inside a git repository with a GitHub remote
- public SonarCloud project, or a Sonar token available for private projects

## Workflow

### 1. Resolve repo and PR context

Run:

```bash
git branch --show-current
gh repo view --json nameWithOwner,defaultBranchRef
gh pr view --json number,title,headRefName,baseRefName,url,state,statusCheckRollup
gh pr status
```

Use this to identify:
- current branch
- repo owner/name
- PR number
- whether `SonarCloud Code Analysis` is failing

If there is no PR for the current branch, stop and report that clearly.

### 2. Extract the Sonar check summary from GitHub

Run:

```bash
gh api repos/<owner>/<repo>/commits/<branch-or-sha>/check-runs
```

Find the check run named `SonarCloud Code Analysis`.

Capture:
- `conclusion`
- `output.title`
- `output.summary`
- `details_url`

This is the fastest way to get the gate result and the top-level failing metric from GitHub.

### 3. Confirm the Sonar PR record

Run:

```bash
curl -s 'https://sonarcloud.io/api/project_pull_requests/list?project=<sonar-project-key>'
```

Match the GitHub PR number to the Sonar pull request key.

Capture:
- `qualityGateStatus`
- analysis date
- Sonar PR/dashboard URL

If the project is private, use a token-authenticated request instead of anonymous `curl`.

### 4. Find the file responsible for the failing metric

Run:

```bash
curl -s 'https://sonarcloud.io/api/measures/component_tree?component=<sonar-project-key>&pullRequest=<pr-number>&metricKeys=new_duplicated_lines_density,duplicated_lines_density,duplicated_lines,new_lines&qualifiers=FIL'
```

Inspect the per-file measures and identify files with non-zero or worst values for:
- `new_duplicated_lines_density`
- `duplicated_lines`

For non-duplication failures, use the metric named in the quality gate summary and query the relevant measures instead.

### 5. If duplication is the issue, fetch exact duplicated blocks

Run:

```bash
curl -s 'https://sonarcloud.io/api/duplications/show?key=<sonar-project-key>:<path>&pullRequest=<pr-number>'
```

This returns duplicated blocks as:
- `from`
- `size`

These are line-based block coordinates. Map them back to local files.

### 6. Map Sonar line coordinates to source

Run:

```bash
nl -ba <file> | sed -n '1,260p'
```

Use the `from` and `size` values to report exact duplicated ranges in local source terms.

## Output format

Report only the useful facts:
- PR `#<n>` and URL
- Sonar gate status: `OK` or `ERROR`
- failing condition(s)
- Sonar details URL
- affected file(s)
- duplicated block pairs as `<file>:<start>` through `<file>:<end>`

Example:

- PR `#13` failed Sonar quality gate.
- Failing condition: `4.1% Duplication on New Code` where required threshold is `<= 3%`.
- Offending file: `src/commands/executePrompt.ts`
- Duplicated blocks:
  - lines 15-39
  - lines 88-112

## Notes

- `gh` is the discovery layer. Use it to find the PR and the failing Sonar check.
- Sonar APIs are the diagnosis layer. Use them for file-level metrics and duplication blocks.
- GitHub usually exposes the failing gate summary, but not the exact duplicated blocks.
- Sonar line ranges are easier to explain after mapping them to local source with `nl -ba`.

## Fallbacks

- If `gh pr view` finds no PR, report that no PR exists for the current branch.
- If the Sonar check is absent, report that no SonarCloud analysis is attached to the PR.
- If Sonar APIs return no PR match, confirm the Sonar project key and PR number.
- If the project is private and anonymous `curl` fails, require a Sonar token.
