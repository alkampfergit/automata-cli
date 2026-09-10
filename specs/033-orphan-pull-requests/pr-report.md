# PR Report: Manage orphaned pull requests in `do-work`

**Branch**: `feature/033-orphan-pull-requests`
**Date**: 2026-09-10
**Spec**: [specs/033-orphan-pull-requests/spec.md](spec.md)

## Summary

`do-work` could only ever see issues: a pull request that closes no issue — a Dependabot bump, say —
was invisible to a tick, so nobody could ask the agent to rebase it, fix its CI, or say whether it
was safe to merge. This adds a second discovery pass over exactly those pull requests, selected with
the same discovery filter the issue pass uses and triggered by the same rule — an authorized account
has left a message the agent has not answered. The new `pr-orphan` turn runs on the pull request's
head branch with its own configurable prompt, shares the issue pass's run budget, and reuses the
existing fork and protected-branch refusals.

## What's New

- **Orphan discovery, at no API cost** (`src/github/ghWorkService.ts`): `LINK_MAP_QUERY` now also
  selects `labels` and `assignees`, and `getOpenPrLinkMap` returns `orphans: OrphanPr[]` — every open
  pull request whose closing references contain no issue of this repository. The tick already paged
  through that query exhaustively, so the second pass adds no request when nothing matches.
- **A `pr-orphan` turn** (`src/github/workDetection.ts`): `decideOrphanPrWork` applies the ordinary
  trigger rule with the pull request as the only surface — an unanswered message from an authorized
  account, whether a conversation comment, a review body or an unresolved review-thread comment. No
  first-touch turn and no head-SHA re-trigger, so a bot's own pull request body and commits never
  start a run. The pull-request conversation analysis is now one shared helper, so `pr-work` and
  `pr-orphan` cannot drift apart on what counts as answered.
- **`WorkItem.issue` is nullable, and `processItem` is unchanged**: the marker, its reconciliation,
  the mid-run overtaken-message report, the oversized-prompt refusal, the invalid-`tool:` refusal and
  the run-cap accounting are shared by all three turn kinds rather than duplicated. Assignment, the
  issue pickup note and the closing-reference repair are guarded off, since all three are issue
  mechanisms.
- **Two new skip reasons**: `pr-linked` (someone added `Closes #N` between the plan and the run, so
  the issue pass owns it) and `pr-closed` (merged or closed in the meantime). Both come out of the
  link map the pre-run refresh already re-fetches.
- **`doWork.prompts.prOrphan`** with a built-in default that never asks the model to merge or close —
  reachable through `automata config set do-work-prompt pr-orphan <value>`, through
  `automata config` → Prompts → *Do Work — Orphan PR*, and as a `.md` file in `.automata/`.
- **`--pr <number>`** beside `--issue <number>`. Resolved out of the pull-request map, so it needs no
  extra call and can be precise about failure: a pull request that closes an issue of this repository
  exits 1 naming that issue and pointing at `--issue`, and a number that is not an open pull request
  here exits 1. Either option alone suppresses the other pass; both together restrict both passes.
- **One shared run budget, issues first**: `--max-runs` / `maxRunsPerTick` covers both passes, and the
  issue items are offered it first, so a batch of dependency bumps cannot starve the issues.
- **Reporting**: the plan, the progress lines, the dry-run header and the tick summary name an orphan
  item `PR #61` rather than a bare `#61`, and the plan header now counts "candidates" rather than
  "issues".
- **Docs**: a new "The orphan pull-request pass" section in `docs/do-work.md`, `prompts.prOrphan` in
  `docs/config.md`, a new Rule 6 and a second decision table in `docs/wiki/Detection-Rules.md`, plus
  the turn tables and examples in `docs/wiki/Concepts.md`, `Prompts.md` and `Operations.md`.

## Breaking Changes

- **`--json` item and plan shape**: every entry in `items`, `plan` and (on a dry run) `runs` now
  carries both `issue` and `pr`, either of which may be `null` — `issue` is `null` on a `pr-orphan`
  entry, `pr` is `null` on an `issue-discuss` entry with no pull request. Previously `issue` was
  always a number and only `plan` carried `pr`. Anything consuming the payload with an exact-shape
  comparison needs the extra field; anything reading `issue` as a number needs the null case.
- **The plan's first line** changed from `Work plan (N of M issues need an answer):` to
  `Work plan (N of M candidates need an answer):`, since it now counts issues *and* orphan pull
  requests. Anything scraping that line needs updating.

Both are nominal rather than behavioural: no existing issue produces a different turn, refusal or
exit code than it did before.

## Testing

- **Unit — `tests/unit/ghWorkService.test.ts`** (6 new): a pull request closing nothing is an orphan;
  one closing an issue of this repository is not; one closing only another repository's issue is;
  labels and assignees normalise to string arrays and tolerate a missing connection; orphans are
  collected across pages; the query asks for `labels` and `assignees`.
- **Unit — `tests/unit/workDetection.test.ts`** (12 new): the whole orphan decision table — comment,
  review body and unresolved thread each trigger; an unauthorized author does not; an agent answer
  anywhere on the pull request settles it; fork, base branch, repository default and configured
  protected branches are all `unsafe-pr-branch`; merged and closed are `pr-closed` and are checked
  before anything else.
- **Unit — `tests/unit/workPrompt.test.ts`** (5 new): a `pr-orphan` prompt names the turn, the pull
  request and the branch, contains no issue line or issue-conversation heading, still carries the new
  pull-request messages and the unresolved threads, and still withholds unauthorized text.
- **Unit — `tests/unit/doWork.cmd.test.ts`** (28 new): one turn on the head branch with the marker on
  the pull request; the orphan frame with no issue context; no assignment, no `addClosesRefToPr` and
  no issue read at all; nothing at all when only a bot has posted; the discovery filter across all
  three techniques, case-insensitively; the three unsafe-branch refusals; the `pr-linked` and
  `pr-closed` pre-run skips; marker reconciliation; the shared cap deferring the orphan item after
  the issues, and running both when the cap allows; a `tool:` directive from the triggering
  pull-request message; a configured `prOrphan` prompt; the `prompts` key validation; and all six
  `--pr` behaviours.
- **Unit — config surfaces**: `configStore.test.ts` (2 new) for `prOrphan` file resolution and the
  path-escape refusal; `config.cmd.test.ts` (1 new plus 2 updated) for
  `config set do-work-prompt pr-orphan` and the merge behaviour; `ConfigWizard.test.tsx` (2 new) for
  the new Prompts screen writing `.automata/do-work-pr-orphan.md`.
- **Mutation-checked**: forcing `prMatchesFilter` to accept everything turns the two filter tests
  red, and disabling the orphan refresh branch turns ten tests red — so the new tests are not passing
  vacuously.
- **Manual**: `node dist/index.js do-work --help` shows `--pr`, and
  `config set do-work-prompt pr-orphan` / an unknown turn kind behave correctly against the built
  bundle in a scratch directory.
- **Gates**: `npm test` (854 passing, 28 files) and `npm run lint` both green. The changed test files
  were typechecked explicitly with `tsc --noEmit --strict` and produce the same error set as on
  `develop` — `tsconfig.json` covers only `src`, so vitest alone would not have caught a malformed
  fixture.

## Notes

- **Operator action to use this**: none in configuration. Add the repository's discovery label (or
  assignee, or title fragment) to the pull request and comment on it as an authorized account. No
  change to `.github/dependabot.yml` is needed, and no second configured label exists — since a human
  has to comment anyway, the label only bounds how many pull-request conversations a tick fetches.
- **Deliberately not implemented**: no first-touch turn on a newly seen pull request, and no
  re-trigger when the head SHA changes after a force-push. Both were in the original proposal on
  issue #59 and were dropped at the maintainer's request; if a force-push makes an earlier verdict
  stale, the maintainer's next comment is the trigger.
- **A `pr-orphan` turn assigns nothing.** Beyond there being no issue to assign, with
  `issueDiscoveryTechnique: assignee` assigning the agent to the pull request would change what the
  discovery filter matches on the next tick. The `working…` marker on the pull request is the claim.
- **The default `prOrphan` prompt asks for a recommendation, not an action**, on merging or closing,
  because `docs/do-work.md` documents that `do-work` never merges a pull request or closes anything. A
  repository that wants a superseded bump closed automatically can say so in its own `prOrphan`
  prompt.
