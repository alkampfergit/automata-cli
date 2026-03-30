# Feature Specification: Config Wizard

**Feature Branch**: `001-config-wizard`
**Created**: 2026-03-30
**Status**: Draft
**Input**: User description: "Config wizard using ink framework for rich CLI UI. Saves configuration to .automata folder as JSON. First config: Remote environment type (GitHub or AzureDevops). Also supports automata config set type (gh|azdo) command."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Interactive Config Wizard (Priority: P1)

A user runs `automata config` without subcommands and is presented with a rich interactive terminal UI (powered by ink) that guides them through setting the remote environment type.

**Why this priority**: This is the primary onboarding experience. Without being able to configure the tool, no subsequent commands work.

**Independent Test**: Run `automata config`, navigate the wizard with arrow keys, select a remote type, confirm, and verify `.automata/config.json` is written with the correct value.

**Acceptance Scenarios**:

1. **Given** no `.automata/config.json` exists, **When** user runs `automata config`, **Then** an interactive wizard appears prompting for remote environment type.
2. **Given** the wizard is open, **When** user selects "GitHub" and confirms, **Then** `.automata/config.json` is written with `{ "remoteType": "gh" }` and the UI exits cleanly.
3. **Given** the wizard is open, **When** user selects "Azure DevOps" and confirms, **Then** `.automata/config.json` is written with `{ "remoteType": "azdo" }` and the UI exits cleanly.
4. **Given** a config already exists with `remoteType: "azdo"`, **When** user runs `automata config`, **Then** the wizard pre-selects "Azure DevOps".

---

### User Story 2 - Non-Interactive Config Set (Priority: P2)

A user runs `automata config set type gh` (or `azdo`) to set the remote environment type without the interactive wizard, suitable for scripted or CI environments.

**Why this priority**: Enables scripted/automated setup. Secondary to the wizard but important for non-interactive environments.

**Independent Test**: Run `automata config set type gh` and verify `.automata/config.json` contains `{ "remoteType": "gh" }` and a success message appears.

**Acceptance Scenarios**:

1. **Given** any initial state, **When** user runs `automata config set type gh`, **Then** config is saved with `remoteType: "gh"` and a confirmation message is printed to stdout.
2. **Given** any initial state, **When** user runs `automata config set type azdo`, **Then** config is saved with `remoteType: "azdo"` and a confirmation message is printed to stdout.
3. **Given** an invalid type is provided, **When** user runs `automata config set type invalid`, **Then** an error message is printed to stderr and the config is not modified.

---

### Edge Cases

- What happens when the `.automata` directory does not exist? The system creates it automatically before writing the config.
- What happens when the config file is corrupted or unreadable? The system treats it as if no config exists and starts fresh.
- What happens when the user presses Ctrl+C during the wizard? The wizard exits cleanly without modifying the config.
- What happens when the `type` argument is omitted from `config set`? An error is shown listing valid keys.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide an interactive config wizard accessible via `automata config`.
- **FR-002**: The wizard MUST use the ink npm package for rich terminal UI rendering.
- **FR-003**: The wizard MUST present the remote environment type choice (GitHub or Azure DevOps) as a visual selector navigable with arrow keys.
- **FR-004**: System MUST save configuration as JSON to `.automata/config.json` in the current working directory.
- **FR-005**: System MUST create the `.automata` directory if it does not exist when saving config.
- **FR-006**: System MUST support `automata config set type <gh|azdo>` as a non-interactive command.
- **FR-007**: System MUST validate that the value passed to `config set type` is one of `gh` or `azdo`.
- **FR-008**: The wizard MUST pre-select the current value of each setting when config already exists.
- **FR-009**: The wizard MUST exit cleanly without modifying config if the user cancels (Ctrl+C).

### Key Entities

- **Config**: JSON object stored in `.automata/config.json` with at least `remoteType` field (`"gh"` | `"azdo"`).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can complete the initial configuration in under 30 seconds using the interactive wizard.
- **SC-002**: The non-interactive `config set type` command completes in under 1 second and produces a clear confirmation or error message.
- **SC-003**: The `.automata/config.json` file always contains valid JSON after any config operation.
- **SC-004**: All interactive UI components render correctly in standard terminal environments (TTY).

## Assumptions

- [AUTO] Config location: chose current working directory `.automata/config.json` because project-level tools conventionally store config in a local hidden folder (similar to `.git`).
- [AUTO] Config file format: chose flat JSON because the constitution requires simplicity (YAGNI) and a single config key does not justify a more complex format.
- [AUTO] Wizard navigation: chose a simple list selector using ink because it covers the use case with minimal complexity.
- [AUTO] No encryption: `remoteType` is not sensitive, so plain JSON is appropriate.
- [AUTO] Scope: only `remoteType` is in scope for this feature; other config keys are deferred.
