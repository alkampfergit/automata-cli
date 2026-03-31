# Data Model: Get PR Open Comments

**Feature**: 006-get-pr-comments | **Date**: 2026-03-31

## Entities

### PrComment

Represents one unresolved review thread entry (top-level comment of the thread).

| Field       | Type             | Description                                        |
|-------------|------------------|----------------------------------------------------|
| `author`    | `string`         | GitHub login of the comment author                 |
| `body`      | `string`         | Full text of the comment                           |
| `path`      | `string`         | File path the comment is anchored to               |
| `line`      | `number \| null` | Line number; `null` for file-level comments        |
| `createdAt` | `string`         | ISO 8601 timestamp (from GitHub)                   |

### Raw GitHub shapes (intermediate, not exported)

**RawReviewThreadComment** — one comment inside a `reviewThreads` entry from `gh pr view`:

| Field       | Type             | Notes                          |
|-------------|------------------|--------------------------------|
| `author`    | `{ login: string }` | Nested object from GitHub   |
| `body`      | `string`         |                                |
| `path`      | `string`         |                                |
| `line`      | `number \| null` |                                |
| `createdAt` | `string`         |                                |

**RawReviewThread** — one thread from `gh pr view --json reviewThreads`:

| Field        | Type                          | Notes                              |
|--------------|-------------------------------|------------------------------------|
| `isResolved` | `boolean`                     | `true` = resolved, `false` = open  |
| `isOutdated` | `boolean`                     | Outdated-but-unresolved = included |
| `comments`   | `RawReviewThreadComment[]`    | First element is the root comment  |

## State Transitions

Not applicable — this is a read-only query.

## Validation Rules

- Threads with `isResolved === true` are excluded.
- Threads with an empty `comments` array are skipped.
- If `line` is absent or `null` in the raw data, `PrComment.line` is set to `null`.
