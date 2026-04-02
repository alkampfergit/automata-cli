# Research: implement-next Multi-Issue Selection

**Branch**: `013-implement-next-selection` | **Date**: 2026-04-02

## Current State

### `src/config/githubService.ts`

- `listIssues(technique, value)` returns `GitHubIssue | null`.
- Hardcodes `--limit 1` in the `gh issue list` call.
- Single result extraction: `return issues[0]` after checking length.

### `src/commands/getReady.ts`

- Calls `listIssues` and receives one issue or null.
- Prints issue details to stdout (full body).
- Posts `"working"` comment then invokes AI.
- Prompt assembled as: `${systemPrompt}\n\n${issue.body}` — no issue number.

### `tests/unit/getReady.cmd.test.ts`

- Mocks `spawnSync` for `gh issue list`, `gh issue comment`, and `claude`/`codex`.
- First `mockSpawnSync.mockReturnValueOnce` always returns a single-element array.
- 239 lines, thorough coverage of flags and prompt composition.

## Key Findings

1. **`--limit` in `gh issue list`**: The current hardcoded `"1"` needs to be replaced with the user-supplied limit (default `"10"`). We also need to fetch `limit + 1` items to detect whether more exist (for the "showing first N of M" message) — or fetch exactly `limit` items and rely on the count returned. Since `gh issue list` returns exactly what it's asked for, we fetch `limit` items and infer "there may be more" if `issues.length === limit`.

2. **readline async pattern**: `readline.createInterface` with a `question()` call returns via callback. We'll promisify it:
   ```ts
   const answer = await new Promise<string>(resolve =>
     rl.question("Select issue (1-N): ", resolve)
   );
   rl.close();
   ```
   This integrates cleanly with the existing `async` action handler.

3. **`--take-first` + `--no-claude` combination**: These are orthogonal. `--take-first` affects selection; `--no-claude` affects AI invocation. Both can be used together.

4. **`--query-only` with multiple issues**: Show the list without prompting, then exit. The `--query-only` path already calls `process.exit(0)` early — we just need to print the list before that exit.

5. **`--json` flag with multiple issues**: Currently `--json` outputs a single issue object. With multiple issues, if `--json` is set and `--take-first` is not, we should print the list and still prompt — `--json` only affects the final selected issue's output format (same as current: number/title/body/url). This is consistent with existing behaviour.

## Autonomous Decisions

- **Decision**: Fetch `limit` items from `gh issue list` (not `limit + 1`). If `issues.length === limit`, note "showing first N — there may be more". This avoids over-fetching.
  - **Rationale**: Simpler, no wasted network call. The "may be more" message is honest and consistent with the user's spec ("if there are more than 10 elements simply state that these are the first 10 ready elements").

- **Decision**: The `listIssues` function signature becomes `listIssues(technique, value, limit = 10): GitHubIssue[]`.
  - **Rationale**: Minimal change. Default preserves existing callers (if any) while the new `getReady.ts` passes the user's `--limit` value.
