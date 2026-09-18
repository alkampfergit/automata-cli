# automata git

Git workflow commands. Most commands in this group require the [`gh` CLI](https://cli.github.com/) to be installed and authenticated. `publish-release` only requires `git`.

---

## `automata git get-pr-info`

Show the pull request associated with the current branch.

```bash
automata git get-pr-info           # human-readable output
automata git get-pr-info --json    # JSON output
automata git get-pr-info --wait-finish-checks  # wait for checks, then print the normal output
```

### Options

| Flag | Description |
|---|---|
| `--json` | Print the full PR object as JSON (includes `checks` array) |
| `--wait-finish-checks` | Poll until all checks are finished, then print the same output as a normal `get-pr-info` run |

### Human-readable output

```
PR:               #42
Title:            Fix authentication bug
State:            OPEN
URL:              https://github.com/org/repo/pull/42
Sonar:            https://sonarcloud.io/summary/new_code?id=my_project&pullRequest=42
Sonar New Issues: 3
Checks Running:   false
Check Errors:     test: 3 tests failed in src/foo.test.ts; lint: no details available
Checks:
  ✓ build
  ✗ lint
  ✗ test
  ● deploy (pending)
FailedChecks:
  ✗ lint
    Details: (no details available)
  ✗ test
    Details: 3 tests failed in src/foo.test.ts
Sonar Failures:
  Quality Gate: ERROR
  Gate Violations:
    - new_security_hotspots_reviewed | actual 0 | LT 100
  Issues:
    - Refactor this conditional structure to avoid duplicated code.
      Location: src/commands/git.ts:42
      Classification: MAJOR / CODE_SMELL
      Rule: typescript:S1871
      Explanation: Duplicated branches make code harder to maintain.
  Security Hotspots:
    - Make sure the regex used here cannot lead to denial of service.
      Location: src/git/gitService.ts:235
      Status: TO_REVIEW
      Classification: MEDIUM / dos
      Rule: typescript:S5852 (Using slow regular expressions is security-sensitive)
      Risk: Backtracking regexes can degrade into denial of service.
      Review: Check whether the input is user-controlled and unbounded.
      Fix: Use a linear-time pattern or avoid regex for this parsing path.
```

The `Sonar:` and `Sonar New Issues:` lines only appear when a SonarCloud check is detected on the PR (identified by `sonarcloud.io` in the check URL). The `Sonar:` line is normalized to the current PR's SonarCloud page when automata can determine the Sonar project key, even if GitHub only exposes a generic SonarCloud URL in the check metadata. A PR with no Sonar issues prints `Sonar New Issues: 0`. `Sonar New Issues` shows `unavailable` only when automata could not determine the count; in that case a `Sonar Note:` line explains whether the project is private, the public API is unavailable, or the Sonar URL did not contain a usable project key.

When the Sonar check is failing and the SonarCloud project is public, an additional `Sonar Failures:` section is printed with structured quality-gate details, issue details, and security-hotspot details when Sonar exposes them. If the SonarCloud public API returns `401`, the section explains that the project is private and advises opening the Sonar URL in an authenticated browser.

### Machine-readable summary fields

These fields appear on every invocation and are easy to grep or parse:

| Field | Values | Meaning |
|---|---|---|
| `Checks Running:` | `true` / `false` | `true` if any check is still `QUEUED` or `IN_PROGRESS` |
| `Check Errors:` | `none` or a semicolon-separated list | One entry per failed check in the format `<name>: <detail>`. Detail is `no details available` when GitHub provides no description. |

### Check status symbols

| Symbol | Meaning | GitHub conclusion values |
|---|---|---|
| `✓` | Passed | `SUCCESS` |
| `✗` | Failed | `FAILURE`, `TIMED_OUT`, `ACTION_REQUIRED`, `CANCELLED` |
| `●` | Pending / running | `QUEUED`, `IN_PROGRESS` (conclusion not yet set) |
| `○` | Skipped / neutral | `SKIPPED`, `NEUTRAL` |

When one or more checks fail, a trailing `FailedChecks:` section is printed after the checks list. That section contains the detailed failure text for each failed check. Sonar failures also include the Sonar URL there.

### JSON output shape

```json
{
  "number": 42,
  "title": "Fix authentication bug",
  "state": "OPEN",
  "url": "https://github.com/org/repo/pull/42",
  "checks": [
    {
      "name": "build",
      "status": "COMPLETED",
      "conclusion": "SUCCESS",
      "description": "",
      "detailsUrl": "https://github.com/..."
    },
    {
      "name": "test",
      "status": "COMPLETED",
      "conclusion": "FAILURE",
      "description": "3 tests failed in src/foo.test.ts",
      "detailsUrl": "https://github.com/..."
    }
  ],
  "sonarcloudUrl": "https://sonarcloud.io/summary/new_code?id=my_project&pullRequest=42",
  "sonarNewIssues": 3,
  "sonarFailures": {
    "status": "available",
    "qualityGateStatus": "ERROR",
    "gateViolations": [
      {
        "metricKey": "new_security_hotspots_reviewed",
        "status": "ERROR",
        "comparator": "LT",
        "actualValue": "0",
        "errorThreshold": "100"
      }
    ],
    "issues": [
      {
        "key": "issue-1",
        "rule": "typescript:S1871",
        "severity": "MAJOR",
        "type": "CODE_SMELL",
        "message": "Refactor this conditional structure to avoid duplicated code.",
        "path": "src/commands/git.ts",
        "line": 42,
        "explanation": "Duplicated branches make code harder to maintain."
      }
    ],
    "securityHotspots": [
      {
        "key": "hotspot-1",
        "rule": "typescript:S5852",
        "ruleName": "Using slow regular expressions is security-sensitive",
        "status": "TO_REVIEW",
        "message": "Make sure the regex used here cannot lead to denial of service.",
        "path": "src/git/gitService.ts",
        "line": 235,
        "securityCategory": "dos",
        "vulnerabilityProbability": "MEDIUM",
        "riskDescription": "Backtracking regexes can degrade into denial of service.",
        "vulnerabilityDescription": "Check whether the input is user-controlled and unbounded.",
        "fixRecommendations": "Use a linear-time pattern or avoid regex for this parsing path."
      }
    ]
  }
}
```

`checks` is always present; it is an empty array when no checks are configured on the PR. `sonarcloudUrl`, `sonarNewIssues`, and `sonarNewIssuesNote` are only present when a SonarCloud check is detected. `sonarNewIssues` is `0` when Sonar reports no new issues and `null` only when automata could not determine the count; `sonarNewIssuesNote` explains that unavailable case. `sonarFailures` is only present when a SonarCloud check is failing and the command was able to determine either structured failure details or a private-project note. `securityHotspots` is additive and may be empty even when other Sonar failure details are present. In the private-project case, `sonarFailures.status` is `private` and `privateMessage` explains that authenticated browser access is required.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Success (including when no PR exists — a message is printed) |
| `1` | Error (gh failure, not a git repo, etc.) |

---

## `automata git get-pr-comments`

List open (unresolved) review thread comments on the pull request for the current branch. **GitHub only** — not supported in Azure DevOps mode (see [azdo-gap.md](azdo-gap.md)).

```bash
automata git get-pr-comments           # human-readable output
automata git get-pr-comments --json    # JSON array output
```

### Options

| Flag | Description |
|---|---|
| `--json` | Print unresolved threads as a JSON array |

### Human-readable output

One block per unresolved review thread (separated by blank lines):

```
[alice] on src/commands/git.ts:42
This variable name is unclear — please rename to something descriptive.

[bob] on src/config/configStore.ts:(file)
Missing licence header at the top of this file.
```

When there are no unresolved comments:

```
No open comments.
```

### JSON output shape (`--json`)

```json
[
  {
    "author": "alice",
    "body": "This variable name is unclear — please rename to something descriptive.",
    "path": "src/commands/git.ts",
    "line": 42,
    "createdAt": "2026-03-30T10:00:00Z"
  },
  {
    "author": "bob",
    "body": "Missing licence header at the top of this file.",
    "path": "src/config/configStore.ts",
    "line": null,
    "createdAt": "2026-03-30T11:30:00Z"
  }
]
```

`line` is `null` for file-level comments (not anchored to a specific line). Returns `[]` when there are no unresolved threads.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Success (including when there are no open comments) |
| `1` | Error: no PR found, `gh` not installed/authenticated, or Azure DevOps remote type |

---

## `automata git finish-feature`

Clean up a merged feature branch in one step: checkout `develop`, pull the latest, and delete the local branch.

```bash
automata git finish-feature
```

### Preconditions (all must pass before any changes are made)

| Check | Failure message |
|---|---|
| Not on `develop` | `finish-feature cannot be run from the develop branch` |
| Clean working tree | `You have uncommitted changes...` |
| PR exists for the branch | `No pull request found for branch: <branch>` |
| PR state is `MERGED` | Open → `still open`; Closed without merge → `closed without merging` |
| Remote tracking branch is gone | `Remote tracking branch 'origin/<branch>' still exists` |

If any precondition fails the command prints a descriptive error to stderr and exits with code `1`. No git operations are performed.

### What it does

1. `git fetch --prune` — syncs remote refs
2. `git checkout develop && git pull --ff-only` — moves to develop and updates it. The strategy is named on the command line so the result does not depend on the machine's `pull.rebase` / `pull.ff` configuration; where neither is set, a bare `git pull` on a diverged branch fails with `Need to specify how to reconcile divergent branches`. A `develop` that has diverged fails here rather than being merged or rebased — reconcile it yourself and re-run.
3. `git branch -d <branch>` — removes the local feature branch

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Branch cleaned up successfully |
| `1` | Precondition failed or git error |

---

## `automata git publish-release`

Execute the full GitFlow release sequence and push the results to `origin`. Does **not** require the `gh` CLI — only `git` is needed.

```bash
automata git publish-release            # auto-detect version from the trunk tag
automata git publish-release 2.0.0      # explicit version
automata git publish-release --dry-run  # preview commands without executing
```

### The trunk branch is detected, not assumed

The branch a release is published to is resolved from `origin` on every run, in this order:

| Order | Source | Notes |
|---|---|---|
| 1 | `git.trunkBranch` in `.automata/config.json` | Skips detection entirely. Unset by default — see [docs/config.md](config.md#git). |
| 2 | `git symbolic-ref refs/remotes/origin/HEAD` | Free and local, but a clone made with `--single-branch` never writes it. |
| 3 | `git ls-remote --symref origin HEAD` | What the remote itself advertises. Works in every clone shape. |
| 4 | `origin/main`, then `origin/master` | Probed with `git ls-remote --heads`, for a remote that advertises no HEAD. |

The resolved name is printed before anything else happens, with the source it came from:

```
Trunk branch: main (from origin/HEAD)
```

If none of the four answers, the command exits `1` listing every candidate it tried, before touching the repository.

### It fetches first, including in --dry-run

Before the version is inferred, the command runs:

```
git fetch --tags origin +refs/heads/<trunk>:refs/remotes/origin/<trunk>
```

The refspec is explicit so that a `--single-branch` clone — one that has only `develop` locally — gets
`refs/remotes/origin/<trunk>` as well as the tags. The version is then read from `origin/<trunk>`, so **no local trunk
branch is needed** and none is created until a real publish reaches the checkout step.

The fetch runs in `--dry-run` too: it writes nothing but refs under `refs/remotes/` and `refs/tags/`, and it is what
makes the version a dry run prints the same one a real run would use. A fetch that fails stops the command.

### Before you run it

The command does not touch `CHANGELOG.md`. Roll the `Unreleased` section into the new version heading and commit that
on `develop` first — `publish-release` requires a clean working tree, so it has to happen before, not after. The exact
three steps are in [docs/maintenance.md](maintenance.md#what-a-release-does-to-it).

### Arguments

| Argument | Description |
|---|---|
| `[version]` | Optional. Release version in `X.Y.Z` semver format. When omitted, the latest semver tag on `origin/<trunk>` is detected and the minor segment is incremented (e.g. `1.2.0 → 1.3.0`). |

### Options

| Flag | Description |
|---|---|
| `--dry-run` | Print each git command that would be executed without running them |

### Release sequence

The command executes these git operations in order:

1. `git checkout -b release/<version>` — create release branch from `develop`
2. `git checkout <trunk>` — switch to the trunk. When the branch does not exist locally this is
   `git checkout -b <trunk> origin/<trunk>` instead, which creates it. `--track` is deliberately not used: git refuses
   to set an upstream from a ref a `--single-branch` clone's refspec does not cover, and the push below names its refs
   explicitly anyway.
3. `git merge --no-ff release/<version>` — merge release into the trunk
4. `git tag <version>` — tag the release on the trunk
5. `git checkout develop` — switch back to develop
6. `git merge --no-ff release/<version>` — merge release back into develop
7. `git branch -d release/<version>` — delete the local release branch
8. `git push origin develop <trunk> <version>` — push all refs

### Preconditions (all must pass before any changes are made)

| Check | Failure message |
|---|---|
| Current branch is `develop` | `publish-release must be run from the 'develop' branch` |
| Clean working tree | `You have uncommitted changes...` |
| Trunk branch resolves | `Could not determine the trunk branch of 'origin'` |
| `git fetch` from `origin` succeeds | `Failed to fetch <trunk> and tags from origin` |
| Version matches `X.Y.Z` (if provided) | `Version '...' is not valid semver. Use X.Y.Z format` |
| Semver tag found on the trunk (if auto-detecting) | `No semver tag found on origin/<trunk>` |
| Tag does not already exist | `Tag '...' already exists` |
| A local trunk branch is not behind the remote | `Local branch '<trunk>' is N commit(s) behind origin/<trunk>` |

Every precondition is read-only and runs in `--dry-run` as well. A local trunk that is behind is **refused, never
fast-forwarded** — it may carry work this command knows nothing about; update it with
`git merge --ff-only origin/<trunk>` or delete it and re-run.

If any precondition fails the command prints a descriptive error to stderr and exits with code `1`. No branch is
created, merged, tagged or pushed.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Release published successfully (or dry-run completed) |
| `1` | Precondition failed or git error during release sequence |
