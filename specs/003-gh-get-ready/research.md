# Research: GitHub Issue Discovery and Auto-Implementation (get-ready)

**Branch**: `003-gh-get-ready` | **Date**: 2026-03-30

## Decisions

### Decision: gh CLI for issue discovery

- **Decision**: Use `gh issue list` with JSON output for all three filter modes (label, assignee, title-contains).
- **Rationale**: `gh` is already a dependency for `getPrInfo` and `finishFeature`. Reusing it for issue discovery keeps the tool consistent and avoids introducing new dependencies. `gh issue list` supports `--label`, `--assignee`, and `--search` flags natively.
- **Alternatives considered**: GitHub REST API via `fetch` — adds complexity (authentication token management, URL construction, pagination handling). `gh api` with jq — adds shell scripting complexity.

### Decision: Title-contains filter uses gh search

- **Decision**: For `title-contains` technique, use `gh issue list --search "<value> in:title"` which uses GitHub's search syntax.
- **Rationale**: GitHub's search syntax `in:title` restricts matches to issue titles only, making it precise. The `gh issue list --search` flag supports this.
- **Alternatives considered**: Client-side filtering after fetching all issues — fragile and slow for large repos.

### Decision: Oldest-first ordering

- **Decision**: Pass `--order asc` and `--sort created` to `gh issue list` to get the oldest matching issue first.
- **Rationale**: Treats the issue list as a backlog where the oldest item has highest implied priority. No additional sorting needed after retrieval.
- **Alternatives considered**: Newest first — would prioritize freshly filed issues over long-standing work, less natural for backlog management.

### Decision: Limit to 1 result

- **Decision**: Pass `--limit 1` to `gh issue list` to retrieve only the first matching issue.
- **Rationale**: The feature requirement is to work on "the first element that satisfies the condition". Fetching only 1 avoids processing overhead and keeps intent clear.
- **Alternatives considered**: Fetch multiple and pick first in code — unnecessary complexity.

### Decision: Claude Code invocation via spawnSync with -p flag

- **Decision**: Invoke Claude Code as `claude -p "<systemPrompt>\n\n<issueBody>"` using `spawnSync`. If `claudeSystemPrompt` is empty, use `claude -p "<issueBody>"` only.
- **Rationale**: Claude Code CLI supports `-p` (or `--print`) for non-interactive prompt input. Combining system prompt and issue body into a single `-p` argument is the simplest approach that avoids relying on `--system-prompt` flag (which may not exist in all Claude Code versions). Using `spawnSync` is consistent with `gitService.ts`.
- **Alternatives considered**: Passing system prompt separately via `--system-prompt` flag — depends on Claude Code version-specific flag availability. Using stdin — more complex and less visible in process lists.

### Decision: ConfigWizard extended with a second screen

- **Decision**: After the user selects `remoteType`, if `"gh"` is chosen, show a second screen for `issueDiscoveryTechnique`, `issueDiscoveryValue`, and `claudeSystemPrompt`.
- **Rationale**: Keeps all configuration in one wizard flow consistent with existing UX. Avoids creating a separate wizard command.
- **Alternatives considered**: Always show GitHub-specific fields — confusing for Azure DevOps users. Separate `automata config github` command — extra command surface area.

### Decision: `config set` subcommands for scriptability

- **Decision**: Add `automata config set issue-discovery-technique`, `automata config set issue-discovery-value`, and `automata config set claude-system-prompt` subcommands following the existing `automata config set type` pattern.
- **Rationale**: Allows scripted or CI-driven configuration without interactive wizard. Consistent with existing `configSetType` subcommand pattern.
- **Alternatives considered**: Environment variables only — would not be persisted. Flags on `get-ready` — would not be persistent.

## Autonomous Decisions

- [AUTO] `gh issue list` pagination: Use `--limit 1` to avoid pagination complexity entirely
- [AUTO] Claude Code binary name: Use `claude` as the binary name; if not found, surface the error from spawnSync
- [AUTO] Error when `gh` not found: Surface `spawnSync` error (`status: null` or `ENOENT`) as "Error: `gh` CLI is not installed or not on PATH."
