# Feature Specification: Explicit reply-posting instruction in the issue-discuss prompt

**Branch**: `feature/125-prompt-post-reply-gh` | **Issue**: #125

## User Story

As the operator, I want the issue-discuss prompt to say how to post the reply, so an answer written only to stdout
does not go missing.

## Requirements

- FR-1: The built-in issue-discuss prompt names `gh issue comment <issue-number> --body-file <file>` and
  `gh pr comment <pr-number> --body-file <file>`.
- FR-2: Both the built-in and `.automata/do-work-issue-discuss.md` state that stdout alone is not a posted reply.
- FR-3: A unit test covers the built-in wording; the repository file is kept consistent with it.

## Assumptions

- [AUTO] Scope: chose the issue-discuss prompt only (as the issue says) because the pr-work prompts were not requested.
- [AUTO] Transcript recovery (#115) stays separate, as the issue requires.
