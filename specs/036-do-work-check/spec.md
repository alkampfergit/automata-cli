# Feature Specification: `do-work --check` — a read-only health report for the autonomous loop

**Feature Branch**: `feature/036-do-work-check`

**Created**: 2026-09-18

**Status**: Draft

**Input**: User description: "Implement `automata do-work --check`: a read-only diagnostic subcommand. Decisions locked in on issue #75: git fetch by default with `--no-fetch` escape hatch; real `gh` calls running the actual selection path stopping before the first mutation; no cron inspection; no `--repair`. Sections: running-now (lock file), last tick + tick history, last run's work records, git preflight (diagnose-only), per-issue selection from live `gh`, environment. Flags: `--check [--no-fetch] [--json]`. Exit 0 healthy / 1 problems found."

## Problem

`do-work` is normally fired by a scheduler and discards its own stdout. When the loop
quietly stops picking work up there is no single place to look: the operator has to
reason about the run lock, the operation logs, the state of the checkout, the GitHub
selection filter and the local environment separately — and most of those are invisible
without reading files by hand.

The result today is hand-written host-specific shell scripts (one is quoted in issue #75)
that guess at automata's internal state from the outside — `pgrep` in place of the lock
file, hardcoded cron paths, `git rev-list` in place of the pre-flight's own judgement.
Those scripts are wrong on any host but the one they were written for, and they cannot
see the reasons automata itself recorded.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - "Is it running right now, and when did it last run?" (Priority: P1)

An operator notices no activity from the loop. They run `automata do-work --check` in the
checkout and get, in one screen: whether a tick holds the run lock at this moment (and
which process, since when), when the last tick was recorded, how old that is, and whether
the recent ticks did anything or came back empty.

**Why this priority**: This is the reported symptom in issue #75 — "do-work does not
work" — and it is answerable entirely from state automata already keeps, with no network
and no GitHub access. It is a usable diagnostic on its own.

**Independent Test**: In a checkout with an `.automata/automata.lock` written by a live
process and an `automata-execution.log` with recorded ticks, `--check` names the holder
and reports the last tick's timestamp, age and outcome counts. With no lock file it
reports that no tick is running.

**Acceptance Scenarios**:

1. **Given** a lock file whose pid is alive on this host and was taken within
   `doWork.lockStaleMinutes`, **When** `--check` runs, **Then** it reports a tick is
   running, names the pid, host, command and start time, and this alone does not make the
   command exit non-zero.
2. **Given** a lock file whose pid is not alive on this host, **When** `--check` runs,
   **Then** it reports the lock as stale/orphaned, explains that the next tick will
   reclaim it, and counts it as a problem.
3. **Given** a lock file held by a live same-host process for longer than
   `doWork.lockStaleMinutes` whose identity cannot be verified, **When** `--check` runs,
   **Then** it reports the lock as suspect and counts it as a problem.
4. **Given** no lock file, **When** `--check` runs, **Then** it reports that no tick is
   currently running.
5. **Given** an execution log with recorded ticks for this repository, **When** `--check`
   runs, **Then** it reports the newest tick's timestamp, its age in human terms, its
   `answered/answered-no-reply/skipped/failed/deferred/runs` counts, its exit code and
   any `note=` marker.
6. **Given** an execution log whose newest tick for this repository is far older than the
   cadence the log itself shows, **When** `--check` runs, **Then** it reports that the
   scheduler appears to have stopped firing and counts it as a problem.
7. **Given** no execution log at all, **When** `--check` runs, **Then** it reports that no
   tick has ever been recorded and counts it as a problem.

---

### User Story 2 - "What did the last runs actually do?" (Priority: P2)

The same operator wants the detail behind the counts: which item, which turn kind, which
executor and model, and what the outcome's detail line said.

**Why this priority**: The counts say a tick was degraded; only the work records say
which issue failed and why. It needs User Story 1's log reading but adds the second file.

**Independent Test**: With an `automata-work.log` containing records, `--check` prints the
newest records' items, turn kinds, outcomes, executor/model/effort and detail.

**Acceptance Scenarios**:

1. **Given** a work log with records for this repository, **When** `--check` runs,
   **Then** it prints the newest records, newest first, each naming the subject, turn,
   outcome, executor/model/effort where recorded, and the detail.
2. **Given** an execution log showing ticks but a work log with no records for this
   repository, **When** `--check` runs, **Then** it reports that no tick has invoked the
   executor in the retained window, and does not count that alone as a problem.

---

### User Story 3 - "Why is nothing being picked up?" (Priority: P1)

The loop is running on schedule, the ticks come back empty, and the operator wants the
reason per candidate. `--check` runs the real selection path against live GitHub data and
prints, for every candidate issue and orphan pull request, either the work it would do or
the exact reason it is being skipped — then stops, without posting, assigning, branching
or invoking any executor.

**Why this priority**: This is the second half of the request in issue #75 and the part no
external script can reproduce, because the answer lives in automata's own detection rules.

**Independent Test**: Against a repository with candidate issues, `--check` prints one
line per candidate with its skip reason or its planned turn, and the repository is
provably unchanged afterwards (no comment, no assignment, no branch, no push).

**Acceptance Scenarios**:

1. **Given** a configured repository with candidate issues, **When** `--check` runs,
   **Then** it lists every candidate with either its planned turn kind and branch, or the
   skip reason and detail the detection rules produced.
2. **Given** the same, **When** `--check` runs, **Then** no marker comment is posted, no
   issue or pull request is assigned, no branch is created or checked out, no push
   happens and no executor is launched.
3. **Given** a `gh` call that fails (rate limit, no network, no auth), **When** `--check`
   runs, **Then** the selection section reports the failure with the underlying message,
   counts it as a problem, and the remaining sections are still printed.
4. **Given** the discovery filter matches nothing, **When** `--check` runs, **Then** it
   says so plainly and does not count it as a problem.

---

### User Story 4 - "Is the checkout in a state that lets work happen?" (Priority: P2)

`--check` reports the state of the working copy the way the pre-flight would judge it, but
changes nothing: current branch, detached HEAD, uncommitted changes, whether the base
branch exists locally and on the remote, and how far the local base branch is ahead of or
behind its upstream.

**Why this priority**: A dirty tree or a diverged base branch is the most common reason
every item skips, and it explains a loop that runs but achieves nothing.

**Independent Test**: In a checkout with an uncommitted change, `--check` reports the
dirty tree, names the changed paths and counts it as a problem, while `git status` after
the run is byte-identical to before.

**Acceptance Scenarios**:

1. **Given** a clean checkout on the base branch whose upstream is level, **When**
   `--check` runs, **Then** the git section reports the branch, "clean" and "level with
   origin/<base>" and contributes no problem.
2. **Given** uncommitted changes, **When** `--check` runs, **Then** it reports the dirty
   tree with the changed paths, explains that the pre-flight would try to rescue them, and
   counts it as a problem.
3. **Given** a detached HEAD, **When** `--check` runs, **Then** it reports it and counts
   it as a problem.
4. **Given** a base branch that has diverged from its upstream, **When** `--check` runs,
   **Then** it reports ahead/behind counts, explains that the pre-flight's fast-forward
   pull will fail, and counts it as a problem.
5. **Given** `--no-fetch`, **When** `--check` runs, **Then** no network call is made for
   git and the ahead/behind figures are labelled as not refreshed.
6. **Given** a fetch that fails, **When** `--check` runs, **Then** it reports the failure,
   still prints ahead/behind from the stale remote-tracking ref labelled as not refreshed,
   and counts the failure as a problem.

---

### User Story 5 - "Is the environment itself sound?" (Priority: P3)

`--check` reports the automata version, whether `.automata/config.json` parses and
validates, whether `gh` is present and authenticated, which account it is authenticated
as (and whether that account is a misconfiguration), and whether the configured executor's
binary is on `PATH`.

**Why this priority**: These are preconditions that make `do-work` exit before it does
anything. Today a bad config key makes `do-work` die on the spot with one message and no
context; `--check` must report it as a finding and keep going.

**Independent Test**: With a `doWork` section containing an invalid key type, `--check`
prints the validation message under the environment section, counts it as a problem, and
still prints the lock, log and git sections.

**Acceptance Scenarios**:

1. **Given** a valid configuration, **When** `--check` runs, **Then** it reports the
   automata version, the resolved repository slug, the discovery filter in force, the
   base branch, the run cap and the effective executor.
2. **Given** an invalid configuration, **When** `--check` runs, **Then** it reports the
   exact validation message as a problem and still prints every section that does not
   depend on the configuration.
3. **Given** `gh` is absent or not authenticated, **When** `--check` runs, **Then** it
   reports that as a problem, and the selection section reports that it could not run.
4. **Given** `gh` is authenticated as an account listed in `allowedUsers`, or as an
   account that is neither the configured `agentUser` nor unverifiable, **When** `--check`
   runs, **Then** it reports the self-triggering-loop misconfiguration as a problem.
5. **Given** the configured executor's command is not on `PATH`, **When** `--check` runs,
   **Then** it reports that as a problem.

---

### Edge Cases

- **A tick is running while `--check` runs.** `--check` never takes the run lock and never
  waits for it, so it always produces a report. The lock section names the running tick;
  the selection section may legitimately disagree with what that tick is doing, and says
  so rather than pretending to be authoritative.
- **The operation logs contain records from several checkouts.** The logs live in the
  parent of the working directory and are shared; every reported record is filtered to
  this repository's slug, and the report says how many lines belonged to other
  repositories.
- **The repository slug cannot be resolved** (no `origin`, or `gh` cannot read it). Log
  filtering falls back to reporting the newest records regardless of slug, labelled as
  unfiltered.
- **A log line is malformed** (hand-edited, truncated by a crash). It is skipped and
  counted, never aborts the report.
- **`--check` combined with `--dry-run`.** Refused with a message: the two are different
  read-only reports and silently preferring one would mislead.
- **`--check` combined with `--issue` / `--pr`.** Honoured — the selection section narrows
  to that subject, which is the natural way to ask "why is *this* one not picked up".
- **`--check` with no execution log directory writable/readable.** Reported as an
  unreadable log, counted as a problem; the rest of the report still prints.

## Clarifications

Answered autonomously during the `speckit-full` run; each records the reasoning so a
reviewer can overturn it deliberately.

- Q: Does the report go to stdout or stderr? → A: **stdout**, in both text and `--json`
  form; nothing else is written to stdout in `--json` mode. [AUTO: the constitution puts
  output on stdout and errors on stderr, and the report *is* the command's output — unlike
  a tick, where stdout carries the summary and per-item progress goes to stderr.]
- Q: Does `--no-fetch` suppress only the git fetch, or every network call? → A: **every
  network call** — the git fetch *and* the GitHub queries. The git section then labels
  ahead/behind as not refreshed, and the selection section reports that it did not run.
  [AUTO: the flag was introduced in the issue discussion as "an escape hatch for a fully
  offline run"; a flag that leaves a dozen `gh` calls in place would not deliver that. The
  option's help text names both.]
- Q: What happens on an Azure DevOps remote? → A: the environment section reports that
  `do-work` and therefore `--check` are GitHub-only, counts it as a problem, and the
  sections that do not depend on GitHub still print. [AUTO: matches FR-014 — a section
  failure is a finding, not a crash — while `do-work` itself keeps exiting on the spot.]
- Q: Does `--check` need the authenticated-identity guard that `do-work` applies before a
  tick? → A: it **reports** the same condition instead of exiting on it, as part of the
  environment section. [AUTO: `--dry-run` already skips the guard because it posts
  nothing; `--check` posts nothing either, and its whole purpose is to name the
  misconfiguration rather than die of it.]
- Q: Is a tick that answered nothing a problem? → A: **no** — an idle loop with no
  matching work is healthy, and only the *absence of ticks* (scheduler silence) or a
  non-zero exit on the newest tick is a finding. [AUTO: a healthy idle loop stays quiet at
  exit 0 is already the documented contract for `do-work`; `--check` must not contradict
  it or it will be ignored as noisy.]

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `do-work` MUST accept a `--check` flag that produces a diagnostic report and
  exits, without running a tick.
- **FR-002**: `--check` MUST NOT acquire the run lock, MUST NOT create the lock file, and
  MUST NOT be blocked by a lock another process holds.
- **FR-003**: `--check` MUST NOT write to GitHub in any way — no comment, no marker, no
  assignment, no label, no pull request, no push — and MUST NOT invoke any executor.
- **FR-004**: `--check` MUST NOT modify the working copy: no checkout, no branch creation
  or deletion, no stage, no commit, no reset, no pull. `git fetch` is the only git
  operation permitted to touch the network, and it MUST only update remote-tracking refs.
- **FR-005**: `--check` MUST report whether a run lock is held; when held, it MUST name
  the pid, host, command and start time recorded in it, and classify it as live, stale or
  suspect using the same rules `do-work` itself applies.
- **FR-006**: `--check` MUST report the newest recorded tick for this repository from the
  execution log: timestamp, age, per-outcome counts, executor-run count, exit code and any
  note.
- **FR-007**: `--check` MUST report a short history of recent ticks for this repository,
  including how many of them invoked the executor at all and how many were turned away by
  a held lock.
- **FR-008**: `--check` MUST detect that the scheduler appears to have stopped firing, by
  comparing the age of the newest tick against the cadence the recorded ticks themselves
  show, and MUST NOT require the cron interval to be configured.
- **FR-009**: `--check` MUST report the newest work-log records for this repository:
  subject, turn kind, outcome, executor/model/effort where recorded, and detail.
- **FR-010**: `--check` MUST report the git state of the checkout: current branch or
  detached HEAD, uncommitted changes with the changed paths, presence of the base branch
  locally and on the remote, and the local base branch's ahead/behind counts against its
  upstream.
- **FR-011**: `--check` MUST run `git fetch` for the base branch by default, and MUST
  accept `--no-fetch` to suppress it; with `--no-fetch`, or when the fetch fails,
  ahead/behind figures MUST be labelled as not refreshed.
- **FR-012**: `--check` MUST run the real selection path against live GitHub data —
  candidate discovery, per-issue surface reads, the open-pull-request link map, and the
  same decision rules a tick uses — and report, per candidate, either the work that would
  be done or the skip reason and detail.
- **FR-013**: `--check` MUST report the environment: automata version, repository slug,
  configuration validity with the exact validation message on failure, `gh` availability
  and authentication, the authenticated login and whether it is a self-triggering
  misconfiguration, the effective discovery filter, base branch, run cap and executor, and
  whether the executor's command is on `PATH`.
- **FR-014**: A failure in any one section MUST NOT abort the report; the section reports
  the failure and the remaining sections still print.
- **FR-015**: `--check` MUST exit `0` when no problem was found and `1` when at least one
  was, and MUST print a final line stating the count.
- **FR-016**: `--check` MUST accept `--json` and emit the whole report as a single JSON
  document on stdout, carrying every field the text report shows plus the per-section
  problem list and the exit code.
- **FR-017**: `--check` MUST honour `--issue <n>` and `--pr <n>` by narrowing the
  selection section to that subject.
- **FR-018**: `--check` combined with `--dry-run` MUST be refused with an explanatory
  message and a non-zero exit.
- **FR-019**: `--check` MUST inspect no scheduler-specific path — no cron file, no cron
  log, no process table scan — and MUST NOT offer any repair action.
- **FR-020**: `--check` MUST record nothing in the operation logs; running the diagnostic
  must not alter the history it reports on.

### Key Entities

- **Check report**: the whole diagnostic, made of six sections plus an overall verdict and
  a problem count.
- **Section**: a named part of the report (lock, ticks, work, git, selection,
  environment), each with its own findings and its own list of problems.
- **Problem**: one finding that makes the command exit 1, carrying the section it belongs
  to and a one-line explanation in the operator's words.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An operator can answer "is it running, when did it last run, and why is it
  not picking work up" from a single command invocation, with no manual file reading and
  no host-specific script.
- **SC-002**: Every failure mode the shell script in issue #75 detects that is not
  scheduler-specific is covered by a section of the report: active run, log presence and
  freshness, log error markers, branch, detached HEAD, dirty tree, missing upstream,
  ahead/behind divergence, CLI availability.
- **SC-003**: Running `--check` against a repository leaves the repository, the GitHub
  issue tracker and the operation logs byte-for-byte unchanged, other than git's
  remote-tracking refs when the fetch runs.
- **SC-004**: `--check` produces a report even when the configuration is invalid, `gh` is
  unavailable, the logs are missing and a lock is held — every one of those is reported as
  a finding rather than as a crash.
- **SC-005**: `--json` output is a single valid JSON document that a script can consume to
  reach the same verdict as the text report.

## Assumptions

- [AUTO] **Scheduler-silence threshold**: derived from the execution log itself — the
  median interval between recent recorded ticks, flagged when the newest tick is older
  than three times that median, and only once at least three intervals are available.
  Chosen over a new configuration key because the cron interval is not automata's to know,
  and over a fixed threshold because the interval varies per host. Recorded as an
  assumption because the multiplier is a judgement call.
- [AUTO] **A live lock is not a problem**: the script in issue #75 treats any running
  `do-work` as `FAIL`, which is wrong for a scheduled loop where an in-flight tick is the
  normal case. Only a stale or suspect lock is a problem.
- [AUTO] **Exit code `1` for "problems found"**, matching the convention of the script the
  issue supplied and the commitment made in the issue discussion — even though `1`
  elsewhere in `do-work` means "a precondition failed, nothing was attempted", which for a
  read-only report is a compatible reading.
- [AUTO] **The git section diagnoses rather than reusing the pre-flight**: `runRepoHygiene`
  mutates, and its dry-run mode is a *plan* of mutations rather than a description of
  state. A read-only reader of the same facts is used instead, so `--check` can never
  rescue, checkout, pull or prune by accident.
- [AUTO] **`--check` reports on the base branch's divergence, not the current branch's**:
  the base branch is what the pre-flight fast-forwards and what every turn branches from,
  so it is the one whose divergence stops work.
- [AUTO] **Log history window**: the last 20 execution-log ticks and the last 3 work-log
  records for this repository — enough to see a cadence and the last real activity without
  burying the report.
- [AUTO] **`--check` ignores `--with`, `--model`, `--effort`, `--limit` and `--max-runs`
  only insofar as they do not change what is read**: `--limit` is honoured because it
  determines how many candidates are fetched; the executor options are reported as the
  effective values rather than refused.
- The operation logs are best-effort diagnostics; their absence is meaningful information
  and not an error condition of the reading code.
- `gh` is the only GitHub client; `--check` is unsupported for Azure DevOps remotes, in
  the same way `do-work` itself is.
