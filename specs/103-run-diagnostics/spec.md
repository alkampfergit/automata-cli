# Feature Specification: Run diagnostics when the agent posts no answer

**Branch**: `feature/103-run-diagnostics` | **Issue**: #103

## User Story

As the operator, when a `do-work` agent run ends without posting an answer, I want the fallback comment to say why the
run was silent, so I do not have to guess or dig through the machine first.

## Requirements

- FR-1: The fallback comment includes the turn kind and subject, the agent's exit code or signal, the run duration, and
  whether a branch, pull request or commit appeared during the run.
- FR-2: It includes the last 20 lines (max 4 KB) of the agent's readable output in a collapsed `<details>` block.
- FR-3: The excerpt is redacted for token-shaped strings before posting.
- FR-4: The complete output of each run is saved under `.automata/runs/`; the comment names only the file name.
- FR-5: `doWork.postRunLog` (default `true`) disables FR-1..FR-4.
- FR-6: Saving a transcript never makes the working tree dirty.

## Assumptions

- [AUTO] Config surface: chose config-file key only (no `config set` / wizard screen) because the issue asked for
  diagnostics, not new config UX; scope kept minimal.
- [AUTO] Transcript retention: chose no pruning because none was requested.
- [AUTO] Branch/PR detection: chose a before/after checkout snapshot plus `gh pr view` of the new branch, because it
  needs no agent cooperation.
- Stated by the issue author: exit code and errors are acceptable to post; full transcript stays local, file name only.
