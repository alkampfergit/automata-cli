# Feature Specification: Azure DevOps Remote Support

**Feature Branch**: `005-azdo-remote-support`
**Created**: 2026-03-31
**Status**: Draft
**Input**: User description: "Add Azure DevOps remote repository support with feature parity to GitHub using azdo-cli npm package, then document gaps in docs/azdo-gap.md"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - View PR Info for AzDO Repository (Priority: P1)

A developer working in an Azure DevOps repository runs `automata git get-pr-info` after setting their remote type to `azdo`. They see the current branch's pull request title, number, state, URL, and check/policy status — exactly as they would in GitHub mode.

**Why this priority**: Core command used daily to see whether a PR is ready to merge; without it, azdo mode is unusable.

**Independent Test**: With `remoteType: "azdo"` in config and a branch with an active AzDO PR, running `automata git get-pr-info` prints PR details and exits 0. Running with `--json` emits a valid JSON object.

**Acceptance Scenarios**:

1. **Given** config has `remoteType: "azdo"` and the current branch has an open AzDO PR, **When** the user runs `automata git get-pr-info`, **Then** the PR title, number, state, and URL are printed to stdout with policy/check status symbols (✓ ✗ ● ○).
2. **Given** config has `remoteType: "azdo"` and no PR exists for the branch, **When** the user runs `automata git get-pr-info`, **Then** an informative error is printed to stderr and exit code is non-zero.
3. **Given** config has `remoteType: "azdo"`, **When** the user runs `automata git get-pr-info --json`, **Then** output is valid JSON with `number`, `title`, `state`, `url`, and `checks` fields.

---

### User Story 2 - Finish Feature Branch for AzDO Repository (Priority: P2)

A developer whose AzDO PR has been merged runs `automata git finish-feature`. The tool verifies the PR is merged, checks out `develop`, pulls latest, and deletes the local branch — identical to GitHub mode behaviour.

**Why this priority**: Required for the daily clean-up workflow; builds on PR info (US1) already working.

**Independent Test**: With `remoteType: "azdo"`, a merged AzDO PR, and a clean working directory, running `automata git finish-feature` completes all steps and exits 0.

**Acceptance Scenarios**:

1. **Given** the AzDO PR for the current branch is merged, **When** the user runs `automata git finish-feature`, **Then** the tool fetches, checks out `develop`, pulls, and force-deletes the local branch.
2. **Given** the AzDO PR is still open (not merged), **When** the user runs `automata git finish-feature`, **Then** an error is printed and no branch is deleted.
3. **Given** there is no AzDO PR for the current branch, **When** the user runs `automata git finish-feature`, **Then** an error is printed and no destructive action is taken.

---

### User Story 3 - Claim a Work Item in AzDO Repository (Priority: P3)

A developer configured for AzDO runs `automata get-ready`. Because azdo-cli does not support work item listing, the tool prints a clear message referencing `docs/azdo-gap.md` and exits with a non-zero code. If the user supplies a known work item ID (future scope noted in gap doc), they can claim it by adding a comment.

**Why this priority**: Partial implementation only — limited by azdo-cli capabilities. Gap documentation is P1 (covered in US4).

**Independent Test**: With `remoteType: "azdo"`, running `automata get-ready` exits non-zero and prints a message that references `docs/azdo-gap.md`.

**Acceptance Scenarios**:

1. **Given** config has `remoteType: "azdo"`, **When** the user runs `automata get-ready`, **Then** a clear unsupported message is printed to stderr referencing `docs/azdo-gap.md` and exit code is non-zero.

---

### User Story 4 - AzDO Gap Documentation (Priority: P1)

A developer or operator can consult `docs/azdo-gap.md` to understand which automata-cli features are unavailable in AzDO mode and why, so they can make informed decisions about adopting the tool.

**Why this priority**: Required by the feature request; ships alongside code changes.

**Independent Test**: After implementation, `docs/azdo-gap.md` exists and lists each missing capability with its reason.

**Acceptance Scenarios**:

1. **Given** the implementation is complete, **When** a user opens `docs/azdo-gap.md`, **Then** it lists every GitHub capability that cannot be replicated in AzDO mode with a clear reason for each gap.
2. **Given** a capability is fully supported in AzDO mode, **When** the user checks the gap document, **Then** that capability is NOT listed as a gap.

---

### Edge Cases

- What happens when `remoteType` is `azdo` but `azdo` CLI is not installed or not authenticated? → Print a clear error directing the user to install/authenticate azdo-cli and exit non-zero.
- What happens when the AzDO PR status call returns unexpected JSON shape? → Emit a parse error to stderr and exit non-zero; do not crash the process.
- What happens when `get-ready` is called in azdo mode? → Exit non-zero with a message referencing `docs/azdo-gap.md`.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: When `remoteType` is `azdo`, `automata git get-pr-info` MUST retrieve PR information using the `azdo pr status --json` command instead of `gh pr view`.
- **FR-002**: The PR information returned in azdo mode MUST include at minimum: PR number, title, state, and URL, formatted identically to GitHub mode output.
- **FR-003**: When `remoteType` is `azdo`, `automata git finish-feature` MUST verify the PR is merged using `azdo pr status --json` before performing any destructive actions.
- **FR-004**: When `remoteType` is `azdo`, `automata get-ready` MUST exit with a non-zero code and a human-readable message referencing `docs/azdo-gap.md`.
- **FR-005**: The file `docs/azdo-gap.md` MUST be created and MUST list each GitHub CLI feature used by automata-cli that is not replicated in azdo-cli, with the reason for the gap and the azdo-cli version tested.
- **FR-006**: All existing GitHub mode behaviour MUST remain unchanged; azdo mode is additive only.
- **FR-007**: Both `get-pr-info --json` and `finish-feature` MUST work correctly in azdo mode with the same exit code conventions as GitHub mode.
- **FR-008**: If `azdo` is not installed or unauthenticated, commands in azdo mode MUST emit a clear diagnostic error to stderr and exit non-zero.
- **FR-009**: The provider dispatch (gh vs azdo) MUST be encapsulated in a service layer so commands do not contain conditional logic on `remoteType`.

### Key Entities

- **RemoteService**: Abstraction that dispatches GitHub CLI vs azdo CLI calls based on `remoteType` config value.
- **AzdoPrInfo**: Shape of an AzDO pull request as returned by `azdo pr status --json` (id, title, status, url, policies).
- **PrInfo** (existing, extended): Already contains `number`, `title`, `state`, `url`, `checks`; the azdo adapter must populate the same shape from AzdoPrInfo.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `automata git get-pr-info` and `automata git finish-feature` produce identical CLI output format in both `gh` and `azdo` modes.
- **SC-002**: All existing unit tests continue to pass without modification after the azdo changes land.
- **SC-003**: New unit tests cover the azdo service layer (PR status parsing, unsupported get-ready path) with at least as many test cases as the equivalent GitHub service tests.
- **SC-004**: `docs/azdo-gap.md` documents every unsupported capability; zero undocumented gaps remain after implementation review.
- **SC-005**: A user who has never used azdo mode can follow `docs/azdo-gap.md` to understand current limitations without reading source code.

## Assumptions

- [AUTO] azdo-cli version: tested against `azdo-cli@0.5.0` (latest stable at spec date). Gap doc will reference this version explicitly.
- [AUTO] PR check/policy status: `azdo pr status --json` response shape is assumed to include policy results; if not present, the `checks` array will be empty and this is gap-documented.
- [AUTO] Work item discovery: No `azdo list-items` or equivalent exists in `azdo-cli@0.5.0`; `get-ready` in azdo mode will error with a gap reference rather than silently proceeding.
- [AUTO] Provider abstraction: A thin `RemoteService` interface in `src/config/` following the existing flat module structure (constitution Principle V — simplicity); no plugin system or dynamic loading.
- [AUTO] Comment claiming: `azdo comments add <id> <text>` mirrors `gh issue comment`; this is available and implemented, but the discovery step to find the work item ID is the gap.
