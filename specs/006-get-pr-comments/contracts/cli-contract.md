# CLI Contract: get-pr-comments

**Feature**: 006-get-pr-comments | **Date**: 2026-03-31

## Command Signature

```
automata git get-pr-comments [--json]
```

## Options

| Option   | Type    | Default | Description                        |
|----------|---------|---------|------------------------------------|
| `--json` | boolean | false   | Output as a JSON array to stdout   |

## Behaviour

1. Reads the current git branch.
2. If `remoteType` is `azdo`: writes error to stderr, exits 1.
3. Calls `gh pr view <branch> --json reviewThreads`.
4. Filters threads where `isResolved === false` and `comments.length > 0`.
5. Maps each thread to a `PrComment` (first comment of the thread).
6. Outputs result (see Output Formats below).

## Output Formats

### Human-readable (default)

When unresolved threads exist:

```
[alice] on src/foo.ts:42
This variable name is unclear — please rename to something descriptive.

[bob] on src/bar.ts:(file)
Missing licence header at the top of this file.
```

When no unresolved threads:

```
No open comments.
```

### JSON (`--json`)

When unresolved threads exist — array of `PrComment` objects:

```json
[
  {
    "author": "alice",
    "body": "This variable name is unclear — please rename to something descriptive.",
    "path": "src/foo.ts",
    "line": 42,
    "createdAt": "2026-03-30T10:00:00Z"
  },
  {
    "author": "bob",
    "body": "Missing licence header at the top of this file.",
    "path": "src/bar.ts",
    "line": null,
    "createdAt": "2026-03-30T11:30:00Z"
  }
]
```

When no unresolved threads:

```json
[]
```

## Exit Codes

| Code | Meaning                                              |
|------|------------------------------------------------------|
| `0`  | Success (including "no open comments")               |
| `1`  | Error: no PR found, `gh` not installed/authenticated, or `azdo` remote type |

## Error Messages (stderr)

| Condition                        | Message                                                                                        |
|----------------------------------|-----------------------------------------------------------------------------------------------|
| `azdo` remote type               | `Error: get-pr-comments is not supported for Azure DevOps. See docs/azdo-gap.md for details.` |
| No PR for current branch         | `Error: No pull request found for branch: <branch>`                                           |
| `gh` failure                     | `Error: <gh stderr message>`                                                                  |
| Not in a git repo                | `Error: Failed to determine current branch. Are you inside a git repository?`                 |
