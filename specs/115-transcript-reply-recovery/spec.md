# Feature Specification: Transcript-based reply recovery

**Branch**: `feature/115-transcript-reply-recovery` | **Issue**: #115

## User Story

As the operator, when a `do-work` run prints a good answer but never posts it, I want automata to recover and post that
answer, so the humans are not left with a "finished without posting an answer" notice (issue #114).

## Requirements

- FR-1: The recovery pass runs only after the post-run check found no answer, and re-reads the thread before posting.
- FR-2: It uses the executor, model and effort of the run, and receives the transcript and the original prompt (thread).
- FR-3: Its instruction asks for the complete, GitHub-ready answer itself.
- FR-4: A non-empty answer is redacted, posted to the issue or PR the run answered, and verified by re-reading it.
- FR-5: Empty output, executor failure, post failure or failed verification keep the existing notice, which names why.
- FR-6: Recovery progress lines are prefixed `recovery:` on stderr.

## Assumptions

- [AUTO] Failed runs: chose not to recover when the run itself failed because its output is not a trustworthy answer.
- [AUTO] Opt-out: chose to follow `doWork.postRunLog` (no transcript, no recovery) because it adds no new config key.
- [AUTO] Transcript size: chose the last 120 KB because the answer is at the end and prompts must stay bounded.
- [AUTO] Posting: chose a plain comment through the existing REST helper because it returns a verifiable timestamp.
