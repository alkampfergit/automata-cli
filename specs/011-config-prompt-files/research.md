# Research: Config Prompt Files

**Branch**: `011-config-prompt-files` | **Date**: 2026-04-01

## Findings

### Existing Config Read Path

- `readConfig()` in `src/config/configStore.ts:50-57` reads `.automata/config.json` and returns `AutomataConfig`.
- Prompt fields consumed at: `src/commands/getReady.ts:73` (`claudeSystemPrompt`), `src/commands/executePrompt.ts:68,121` (`prompts.sonar`, `prompts.fixComments`).
- No existing indirection for prompt resolution — raw string is used directly.

### Prompt Fields Identified

| Field | Config key | JSON path |
|-------|-----------|-----------|
| System prompt | `claudeSystemPrompt` | top-level |
| Sonar prompt | `prompts.sonar` | nested |
| Fix-comments prompt | `prompts.fixComments` | nested |

### Config Wizard Save Paths

- `claudeSystemPrompt` saved at `ConfigWizard.tsx:124-130` (system-prompt screen)
- `prompts.sonar` saved at `ConfigWizard.tsx:158-174`
- `prompts.fixComments` saved at `ConfigWizard.tsx:175-191`

## Decisions

### Decision 1: Where to resolve `.md` references

- **Decision**: Add `resolvePromptRef(value: string, automataDir: string): string` helper in `configStore.ts`. Call it inside `readConfig()` for each prompt field before returning.
- **Rationale**: Centralising resolution in `readConfig()` means all callers (getReady, executePrompt, tests) automatically get resolved values without changes. Alternative of resolving at each call site would require modifying three files and risk missing future call sites.
- **Alternatives considered**: Resolve at each call site (rejected: fragile, requires touching more files); separate `readConfigResolved()` function (rejected: callers would still need updating).

### Decision 2: Detection heuristic for file references

- **Decision**: A config field value is a file reference if and only if it is a non-empty string ending with `.md`.
- **Rationale**: Simple, unambiguous convention. Prompts do not legitimately end with `.md` in normal prose.
- **Alternatives considered**: Separate `*_file` field names (rejected: breaks existing config schema); JSON `{"type":"file","name":"..."}` object (rejected: over-engineered for the use case).

### Decision 3: Path traversal prevention

- **Decision**: Use `path.resolve(automataDir, value)` and verify the result starts with `path.resolve(automataDir) + path.sep`. If not, throw an error before reading.
- **Rationale**: Prevents `../` escapes while keeping code simple.
- **Alternatives considered**: Regex blocklist (rejected: fragile); `basename(value)` only (rejected: silently drops path component instead of erroring).

### Decision 4: Config wizard — prompt field save

- **Decision**: When the wizard saves a prompt-type field, write the content to `.automata/<field-name>.md` and store the filename (not the content) in `config.json`.
- Field-name mapping: `claudeSystemPrompt` → `claude-system-prompt.md`, `prompts.sonar` → `sonar-prompt.md`, `prompts.fixComments` → `fix-comments-prompt.md`.
- **Rationale**: Deterministic filenames make the location predictable and avoid collisions. Consistent with the existing `claude-system-prompt.md` file already present in `.automata/`.
- **Alternatives considered**: UUID-named files (rejected: unpredictable); prompt hash as filename (rejected: unintuitive for manual editing).

### Decision 5: `automata config set claude-system-prompt` CLI command

- **Decision**: No change to this command. Users who pass a filename directly (e.g., `automata config set claude-system-prompt my-prompt.md`) get file-reference behaviour automatically at read time. Users who pass inline text get inline behaviour.
- **Rationale**: Keeps the CLI simple; the read-time resolution is transparent. Documenting the convention in docs is sufficient.
- **Alternatives considered**: Auto-create `.md` file when value does not end with `.md` (rejected: surprising side-effect; out of scope for this feature).

## Autonomous Decisions

- [AUTO] Resolution location: chose `readConfig()` because centralised resolution avoids touching callers.
- [AUTO] Detection: chose `.md` suffix convention because it matches the existing `claude-system-prompt.md` file and is simple.
- [AUTO] Wizard filenames: chose `<field-name>.md` deterministic names for predictability.
