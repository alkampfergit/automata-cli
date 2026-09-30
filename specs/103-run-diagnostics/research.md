# Research

## Autonomous Decisions

- **Decision**: Save transcripts in `.automata/runs/` with a self-ignoring `.gitignore`. **Rationale**: matches what the
  issue thread agreed; works in repos that never ignored the directory, without touching `AUTOMATA_OWN_PATHS`.
  **Alternatives considered**: the operation-log directory (outside the repo, but not what was proposed); adding the
  path to `AUTOMATA_OWN_PATHS` (an `endsWith` match does not fit a directory of files).
- **Decision**: Excerpt built from readable lines (assistant text, tool names, result), not raw `stream-json`.
  **Rationale**: raw JSON lines are large and useless in a comment. **Alternatives considered**: raw tail.
- **Decision**: Pipe stderr and forward it. **Rationale**: the transcript needs it; the terminal output is unchanged.
  **Alternatives considered**: leave stderr inherited and lose it.
