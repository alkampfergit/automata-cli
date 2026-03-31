# Spec Decisions: GitHub Issue Discovery and Auto-Implementation (get-ready)

**Branch**: `003-gh-get-ready`
**Date**: 2026-03-30
**Spec**: [specs/003-gh-get-ready/spec.md](./spec.md)
**Plan**: [specs/003-gh-get-ready/plan.md](./plan.md)
**Research**: [specs/003-gh-get-ready/research.md](./research.md)

## Planning Decisions

- **Issue discovery via `gh issue list`**: Used `gh issue list` with JSON output and filter flags for all three techniques. **Rationale**: `gh` is already a dependency; reusing it avoids new dependencies. **Alternatives considered**: Direct GitHub REST API calls or `gh api` with jq — both add complexity.

- **Title-contains uses GitHub search syntax**: The `title-contains` technique uses `--search "<value> in:title"`. **Rationale**: Restricts matches to titles only; precise and supported natively by `gh issue list`. **Alternatives considered**: Client-side filtering after fetching all issues — fragile and slow.

- **Oldest-first ordering**: Issues retrieved with `--sort created --order asc`. **Rationale**: Natural backlog priority; oldest item has highest implied urgency. **Alternatives considered**: Newest first — would deprioritize long-standing issues.

- **Limit 1 result**: `--limit 1` passed to `gh issue list`. **Rationale**: Feature requires only "the first element"; fetching more is unnecessary. **Alternatives considered**: Fetch multiple and pick first in code — unnecessary complexity.

- **Claude Code invocation via `-p` flag with combined prompt**: System prompt and issue body concatenated and passed as `-p "<combined>"`. **Rationale**: Simplest invocation; avoids relying on version-specific `--system-prompt` flag. **Alternatives considered**: Passing via stdin — more complex; separate `--system-prompt` flag — not universally available.

- **ConfigWizard extended with a second screen**: A follow-up screen shown after `remoteType` selection when `"gh"` is chosen. **Rationale**: Unified wizard flow; no new wizard commands needed. **Alternatives considered**: Separate `automata config github` command — extra surface area.

- **`config set` subcommands for scriptability**: Three new `automata config set` subcommands following existing `config set type` pattern. **Rationale**: Allows CI/scripted configuration. **Alternatives considered**: Environment variables only — not persisted.

- **`get-ready` as top-level command**: Registered directly on the program, not under `git`. **Rationale**: Distinct from git workflow operations; follows single-responsibility constitution principle. **Alternatives considered**: `automata git get-ready` — would conflate git workflow with issue automation.

- **Project structure**: Single project, extending existing `src/` layout with `src/config/githubService.ts` and `src/commands/getReady.ts`. **Rationale**: Consistent with flat module structure mandated by constitution; mirrors existing `gitService.ts` pattern.
