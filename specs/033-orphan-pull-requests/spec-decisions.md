# Spec Decisions: Manage orphaned pull requests in `do-work`

**Branch**: `feature/033-orphan-pull-requests`
**Date**: 2026-09-10
**Spec**: [specs/033-orphan-pull-requests/spec.md](spec.md)
**Plan**: [specs/033-orphan-pull-requests/plan.md](plan.md)
**Research**: [specs/033-orphan-pull-requests/research.md](research.md)

## Planning Decisions

- **Trigger rule for an orphan pull request**: only an unanswered message from an authorized account
  — no first-touch turn, no head-SHA re-trigger. **Rationale**: decided explicitly by the maintainer
  in issue #59, and it keeps one idempotence argument and one code path for all three turn kinds; a
  Dependabot pull request's own body and commits never start a run. **Alternatives considered**: one
  free "first touch" turn per newly seen matching pull request, plus a re-trigger whenever the head
  SHA changed since the marker (the original proposal) — rejected as a special case with its own
  idempotence story, and unnecessary once a human has to comment anyway.

- **Selection filter**: the existing `issueDiscoveryTechnique` / `issueDiscoveryValue`, applied to
  the pull request (label → its labels, assignee → its assignees, title-contains → its title).
  **Rationale**: no new configuration key, and since a human comment is what starts work the label
  is only a cheap bound on how many pull-request conversations a tick fetches. **Alternatives
  considered**: a second configured label for the pull-request pass, or adding `labels:` to
  `.github/dependabot.yml` — both rejected as unnecessary once the label stopped being the trigger;
  fetching every open pull request's conversation unconditionally — rejected on API cost.

- **`WorkItem.issue` becomes `GitHubIssue | null` instead of adding a second item type and a second
  processing pipeline**. **Rationale**: `processItem` is the ordering-critical marker/boundary path
  that decides whether a human message can be answered twice or lost, and every one of its steps
  applies unchanged to an orphan pull request; duplicating it would mean two copies of that argument.
  **Alternatives considered**: a parallel `processOrphanItem` (duplication of the safety-critical
  path); a synthesised fake `GitHubIssue` for the pull request (would make assignment and link repair
  act on a real unrelated issue); a generic `subject` discriminated union (indirection the
  constitution's Simplicity principle rules out, when `issue !== null` answers what the call sites
  ask).

- **`issueAnalysis` stays non-nullable and holds the empty analysis on an orphan turn**.
  **Rationale**: "no issue messages, none new, the agent never spoke there" is the accurate analysis
  rather than a placeholder, and it avoids five optional-chaining guards in the prompt, watermark and
  directive paths. **Alternatives considered**: `SurfaceAnalysis | null` — more plumbing for no extra
  information.

- **Orphan candidates carry `labels`/`assignees` in a new `OrphanPr` wrapper rather than on
  `PullRequestRef`**. **Rationale**: the link-map query already returns them for free in the page it
  fetches, so the filter costs no extra API call, while `getPrSurface`'s consumers never read them —
  putting them on `PullRequestRef` would either fetch data to satisfy a type or produce two shapes
  for one type. **Alternatives considered**: two required fields on `PullRequestRef`; a second
  `gh pr view` per candidate.

- **`--pr N` is resolved out of the link map with no extra API call**. **Rationale**: the map is read
  exhaustively (a partial read fails the tick), so it is authoritative about whether N is open and
  whether it closes an issue of this repository — absent from the orphan list but present in the map
  means the issue pass owns it, which is an error worth naming rather than a silent reinterpretation.
  **Alternatives considered**: mirroring `discoverIssues`' `getIssueSurface` fallback — rejected,
  because that fallback exists only because the *issue* list is truncated by `--limit`.

- **"No longer an orphan" is a pre-run skip (`pr-linked`), not a reinterpretation**. **Rationale**:
  `processItem` already re-fetches the link map before each item for the symmetric issue-side reason,
  so the check is free, and a maintainer adding `Closes #N` mid-tick is an explicit statement about
  which pass owns the pull request. **Alternatives considered**: running it with the orphan prompt
  anyway.

- **No assignment, no issue-pickup note and no closing-reference repair on a `pr-orphan` turn**.
  **Rationale**: all three are issue mechanisms with no issue to act on, and under
  `issueDiscoveryTechnique: assignee` assigning the agent would change what the discovery filter
  matches on the next tick. The `working…` marker on the pull request is the claim.
  **Alternatives considered**: `gh pr edit --add-assignee` for visibility.

- **`pr` is added to every `--json` item, not only to orphan items**. **Rationale**: `issue: null`
  alone leaves an orphan entry unidentifiable, and a field always present and sometimes `null` is
  easier to consume than one that comes and goes — the same choice the existing payload already
  makes for `executor`/`model`. **Alternatives considered**: an `orphanPr` field on orphan entries
  only.

- **Project structure**: no new module and no new directory. Discovery stays in
  `src/github/ghWorkService.ts` (the only module holding the private `spawnSync` runner), the pure
  decision in `src/github/workDetection.ts`, prompt assembly in `src/github/workPrompt.ts`,
  orchestration in `src/commands/doWork.ts`. **Rationale**: each piece has an existing home whose
  stated responsibility covers it, and keeping I/O out of the decision module is what lets the rules
  be unit-tested without a `gh` binary. **Alternatives considered**: a dedicated `src/github/orphanPr.ts`
  — rejected as a module for one function.
