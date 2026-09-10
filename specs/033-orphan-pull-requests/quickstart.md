# Quickstart: orphan pull requests in `do-work`

**Branch**: `feature/033-orphan-pull-requests` | **Date**: 2026-09-10

The walkthrough an operator (or a reviewer) follows to see the feature work. Nothing here needs a
Dependabot pull request specifically — any open pull request that closes no issue will do.

## 1. Configuration

No new configuration is required. The feature reuses what `do-work` already needs:

```bash
automata config set type gh
automata config set issue-discovery-technique label
automata config set issue-discovery-value automated
automata config set allowed-users alice,bob
automata config set agent-user automata-bot
```

Optionally override the orphan turn instructions:

```bash
automata config set do-work-prompt pr-orphan do-work-pr-orphan.md   # file in .automata/
automata config set do-work-prompt pr-orphan "Check CI, rebase, then report back."
```

or through `automata config` → **Prompts** → **Do Work — Orphan PR**.

## 2. Make a pull request visible to the orphan pass

```bash
gh pr edit 61 --add-label automated       # whatever issueDiscoveryValue is
gh pr comment 61 --body "CI is red — rebase onto develop and tell me if this is safe to merge."
```

The comment must come from an account in `allowedUsers`. The label alone does nothing: without an
unanswered authorized message there is no work, so a freshly opened Dependabot pull request never
starts a run on its own.

## 3. Inspect the plan without running anything

```bash
automata do-work --dry-run
```

Expected: the issue items first, then

```text
  PR #61 pr-orphan on dependabot/npm_and_yarn/lodash-4.17.21 — 1 new pull request message on pull request #61
```

and a per-item block whose `Turn` is `pr-orphan`, whose `Marker` line says it would post on
pull request #61, and whose command carries the orphan prompt frame.

```bash
automata do-work --pr 61 --dry-run     # just this one, no issue pass
automata do-work --dry-run --json      # the same as data, including the full prompt
```

## 4. Run it

```bash
automata do-work --pr 61
```

Expected sequence: the head branch is checked out and fast-forwarded, a `working…` marker is posted
on pull request #61, the executor runs, and the marker is deleted once the agent's own reply is
confirmed on the pull request. Nothing is assigned, no note is posted on any issue, and no closing
reference is added anywhere.

## 5. Check idempotence

```bash
automata do-work --pr 61     # again, immediately
```

Expected: `PR #61 nothing to do — nothing new on pull request #61`, exit 0, no model run.

## 6. Check the refusals

| Setup | Expected |
|---|---|
| `automata do-work --pr <a PR from a fork>` | skipped, `unsafe-pr-branch`: its head branch is not in this repository |
| `automata do-work --pr <a develop → main release PR>` | skipped, `unsafe-pr-branch`: protected head |
| `automata do-work --pr <a PR whose body says `Closes #42`>` | exit 1, "closes issue #42 of this repository … use `--issue 42`" |
| `automata do-work --pr 999999` | exit 1, "not an open pull request of this repository" |
| `automata do-work --pr 61` where 61 lacks the label | a note on stderr, then processed anyway |

## 7. Check the shared budget

With two actionable issues and one actionable orphan pull request:

```bash
automata do-work --max-runs 2
```

Expected: both issues run, and the tick summary ends with

```text
  PR #61 pr-orphan deferred — run cap of 2 reached
```

exit 2 (degraded, because an item was not answered), which is the existing behaviour for a deferred
item.
