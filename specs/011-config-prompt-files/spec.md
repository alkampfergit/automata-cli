# Feature Specification: Config Prompt Files

**Feature Branch**: `011-config-prompt-files`  
**Created**: 2026-04-01  
**Status**: Draft  
**Input**: User description: "Store prompt configurations as markdown file references in .automata/ instead of embedding long strings in JSON config"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Configure a Prompt via Markdown File (Priority: P1)

A developer sets up a prompt-based configuration field (e.g., `claudeSystemPrompt`) by placing the prompt content in a `.automata/*.md` file and referencing only the filename in `config.json`.

**Why this priority**: This is the core behaviour change. All other stories depend on it.

**Independent Test**: Can be tested by placing a markdown file in `.automata/`, setting the JSON field to its filename, and verifying the tool reads the file contents instead of the raw string.

**Acceptance Scenarios**:

1. **Given** `config.json` has `"claudeSystemPrompt": "my-prompt.md"`, **When** the tool reads the config, **Then** it returns the contents of `.automata/my-prompt.md` as the prompt value.
2. **Given** the referenced `.automata/my-prompt.md` does not exist, **When** the tool reads the config, **Then** it reports a clear error identifying the missing file.

---

### User Story 2 - Inline String Values Still Work (Priority: P2)

A developer who has not migrated yet retains an inline string value in `config.json` and the tool continues to use it unchanged.

**Why this priority**: Backwards compatibility prevents breaking existing setups.

**Independent Test**: Can be tested by keeping an inline (non-`.md`) string value in a prompt field and verifying the tool returns it as-is.

**Acceptance Scenarios**:

1. **Given** `config.json` has `"claudeSystemPrompt": "Do the task"`, **When** the tool reads the config, **Then** it returns `"Do the task"` verbatim.

---

### User Story 3 - Config Wizard Writes File References (Priority: P3)

When using the interactive config wizard to set a prompt field, the wizard saves the prompt content to a `.automata/*.md` file and writes the filename (not the content) into `config.json`.

**Why this priority**: Ensures new configurations created via the wizard follow the new convention automatically.

**Independent Test**: Can be tested by running the wizard, supplying prompt text, and verifying that `config.json` contains a filename and a corresponding `.md` file exists with the content.

**Acceptance Scenarios**:

1. **Given** the user supplies prompt text in the config wizard, **When** the wizard saves, **Then** a `.automata/<field-name>.md` file is created with the content and `config.json` stores the filename.

---

### Edge Cases

- What happens when the `.md` filename in config contains a path traversal (e.g., `"../secret.md"`)? The tool MUST reject values outside `.automata/`.
- What happens when the `.automata/` directory does not exist at read time? The tool should report the missing directory.
- What happens when a field value ends with `.md` but is intentionally a literal string? By convention, any value ending in `.md` is treated as a file reference; this is documented behaviour.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The tool MUST treat any prompt/long-string config field value ending with `.md` as a filename reference to a file inside `.automata/`.
- **FR-002**: The tool MUST read and return the contents of the referenced `.md` file when resolving prompt config values.
- **FR-003**: The tool MUST reject `.md` references that resolve outside the `.automata/` directory (path traversal prevention).
- **FR-004**: The tool MUST return a clear, actionable error when the referenced `.md` file does not exist.
- **FR-005**: Inline string values (not ending with `.md`) MUST continue to be used as-is without modification.
- **FR-006**: The config wizard MUST save prompt field content to a `.automata/<field-name>.md` file and store only the filename in `config.json`.
- **FR-007**: The `.automata/` directory MUST be the exclusive location for prompt markdown files referenced from `config.json`.

### Key Entities

- **ConfigField**: A key-value pair in `.automata/config.json`; for prompt-type fields, the value is either an inline string or a `.md` filename.
- **PromptFile**: A markdown file in `.automata/` whose name is stored in a config field; contains the full prompt text.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Developers can change a prompt without editing JSON — only the `.md` file content needs updating.
- **SC-002**: 100% of existing inline string configs continue to work after the change (no regressions).
- **SC-003**: A path-traversal `.md` value is rejected 100% of the time before any file is read.
- **SC-004**: The config wizard produces a valid file-reference config in a single interactive session.

## Assumptions

- [AUTO] Prompt fields: `claudeSystemPrompt` is the primary prompt-type field; the resolution logic applies to any config field whose value ends with `.md`. Chose this broad rule because future prompt fields should not require code changes.
- [AUTO] File location: All prompt markdown files must reside directly in `.automata/` (no subdirectories). Chose flat layout for simplicity and to make path traversal prevention straightforward.
- [AUTO] Backwards compatibility: Non-`.md` string values pass through unchanged. Chosen to avoid a breaking migration requirement.
- [AUTO] Config wizard scope: Only prompt-type fields (long text) trigger the file-save behaviour in the wizard; short enumerated values (e.g., `remoteType`) remain inline. Consistent with user intent of "prompt configurations or long strings".
