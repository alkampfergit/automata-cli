# Feature Specification: conductor thread assembly and prompts

**Branch**: `feature/120-conductor-thread-prompts` | **Issue**: #120 (part of epic #114)

## User Story

As the operator, I want the conductor to build the full thread of a watched item and to read its instructions from
configuration, so I can change what the model is told without changing code.

## Requirements

- FR-1: `composeConductorPrompt` builds the thread: the issue, the linked pull requests, the review comments and the CI status.
- FR-2: The configured prompt (the frame) comes first and verbatim. The thread follows it.
- FR-3: Two new config keys, `conductor.prompts.issue` and `conductor.prompts.pr`. Each holds text or a `.md` filename in `.automata/`. `readConfig()` resolves them as it resolves `doWork.prompts`.
- FR-4: Built-in defaults exist for both keys.
- FR-5: The keys can be set with `automata config set conductor-prompt <issue|pr> <value>` and in the wizard.
- FR-6: `docs/conductor.md` and `docs/config.md` document the keys and the thread.

## Assumptions

- [AUTO] Prompt choice: chose the kind of the watched item (issue or pull request), because the issue names one key for each.
- [AUTO] Filtering: chose to withhold accounts that are not allowed and not the agent, and resolved review threads, as `do-work` does.
- [AUTO] "New" marker: chose not to mark messages as new, because the conductor reads the whole thread.
- [AUTO] CI status: chose `gh pr view --json statusCheckRollup`, one line per check.
- [AUTO] Scope: chose no call from the tick and no model invocation; later conductor issues use the module. The CHANGELOG bullet says so.
- [AUTO] Default text: chose "write the next message to the agent" and no file changes, because the conductor stands in for the allowed users.
