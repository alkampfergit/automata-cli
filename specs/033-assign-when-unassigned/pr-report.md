# PR Report: Claim an unassigned issue and pull request for the agent

**Branch**: `feature/033-assign-when-unassigned`
**Date**: 2026-09-10
**Spec**: [specs/033-assign-when-unassigned/spec.md](../../specs/033-assign-when-unassigned/spec.md)

## Summary

The assignee column now answers one question consistently: is anyone on this? When
`do-work` picks up an issue or works on its pull request, the agent account is added
only if that surface has no assignee at all — and an issue or pull request somebody
already owns is left completely untouched. This replaces the previous rule, which
added the agent even to an issue a human had taken, and extends the claim to the pull
request, which nothing assigned before.

## What's New

- **[Area / Component]**: [What was added or changed and why]

## Testing

- **[Unit / Integration / E2E / Manual]**: [What scenario or component was covered]

## Notes *(optional — remove section if none)*

- [Note, known limitation, or follow-up item]
