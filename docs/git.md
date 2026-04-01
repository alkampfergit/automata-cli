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
    - new_duplicated_lines_density | actual 4.1 | GT 3
  Issues:
    - Refactor this conditional structure to avoid duplicated code.
      Location: src/commands/git.ts:42
      Classification: MAJOR / CODE_SMELL
      Rule: typescript:S1871
      Explanation: Duplicated branches make code harder to maintain.
```

The `Sonar:` and `Sonar New Issues:` lines only appear when a SonarCloud check is detected on the PR (identified by `sonarcloud.io` in the check URL). `Sonar New Issues` shows `unavailable` if the SonarCloud public API cannot be reached or the project is not public.

When the Sonar check is failing and the SonarCloud project is public, an additional `Sonar Failures:` section is printed with structured quality-gate and issue details. If the SonarCloud public API returns `401`, the section explains that the project is private and advises opening the Sonar URL in an authenticated browser.

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
        "metricKey": "new_duplicated_lines_density",
        "status": "ERROR",
        "comparator": "GT",
        "actualValue": "4.1",
        "errorThreshold": "3"
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
    ]
  }
}
```

`checks` is always present; it is an empty array when no checks are configured on the PR. `sonarcloudUrl` and `sonarNewIssues` are only present when a SonarCloud check is detected. `sonarNewIssues` is `null` when the API call fails. `sonarFailures` is only present when a SonarCloud check is failing and the command was able to determine either structured failure details or a private-project note. In the private-project case, `sonarFailures.status` is `private` and `privateMessage` explains that authenticated browser access is required.

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
2. `git checkout develop && git pull` — moves to develop and updates it
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
automata git publish-release            # auto-detect version from master tag
automata git publish-release 2.0.0      # explicit version
automata git publish-release --dry-run  # preview commands without executing
```

### Arguments

| Argument | Description |
|---|---|
| `[version]` | Optional. Release version in `X.Y.Z` semver format. When omitted, the latest semver tag on `master` is detected and the minor segment is incremented (e.g. `1.2.0 → 1.3.0`). |

### Options

| Flag | Description |
|---|---|
| `--dry-run` | Print each git command that would be executed without running them |

### Release sequence

The command executes these git operations in order:

1. `git checkout -b release/<version>` — create release branch from `develop`
2. `git checkout master` — switch to master
3. `git merge --no-ff release/<version>` — merge release into master
4. `git tag <version>` — tag the release on master
5. `git checkout develop` — switch back to develop
6. `git merge --no-ff release/<version>` — merge release back into develop
7. `git branch -d release/<version>` — delete the local release branch
8. `git push origin develop master <version>` — push all refs

### Preconditions (all must pass before any changes are made)

| Check | Failure message |
|---|---|
| Current branch is `develop` | `publish-release must be run from the 'develop' branch` |
| Clean working tree | `You have uncommitted changes...` |
| Version matches `X.Y.Z` (if provided) | `Version '...' is not valid semver. Use X.Y.Z format` |
| Tag does not already exist | `Tag '...' already exists` |
| Semver tag found on master (if auto-detecting) | `No semver tag found on master` |

If any precondition fails the command prints a descriptive error to stderr and exits with code `1`. No git operations are performed.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Release published successfully (or dry-run completed) |
| `1` | Precondition failed or git error during release sequence |
