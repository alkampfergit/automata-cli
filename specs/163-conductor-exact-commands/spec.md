# Feature Specification: Conductor runs gh and git commands exactly as written

**Branch**: `feature/163-conductor-exact-commands` | **Issue**: #163

## User Story

As the operator, I want the conductor prompt to forbid command prefixes, so a project rule such as "prefix with
`rtk`" does not make the run refuse every `gh` command.

## Requirements

- FR-1: The live and the dry-run instruction tell the model to run `gh` and `git` commands exactly as written, with no
  wrapper or prefix, and to ignore a project rule that asks for one.
- FR-2: A unit test covers both instructions. `docs/conductor.md` and `CHANGELOG.md` describe the change.

## Assumptions

- [AUTO] Scope: prompt wording only, as the issue comment asks. The allow-list and the denial message stay separate.
