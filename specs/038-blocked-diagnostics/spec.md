# Feature Specification: Blocked-exit diagnostics for `do-work`

**Feature Branch**: `feature/038-blocked-diagnostics`

**Created**: 2026-09-21

**Status**: Draft

**Input**: User description: "Improve `do-work` diagnostics (issue #82): (1) every blocked exit renders the same six-section report `--check` builds, headed by the trigger, with `--json` carrying it under `blocked: { reason, report }` and a `doWork.dumpOnBlock` config key (default on) to disable; (2) record `cwd` in the run lock file and always print the resolved operation-log directory, its `dirname(cwd)` derivation and its writability — not only when the log is missing — and compare the lock owner's cwd with the checking process's; (3) a lock heartbeat (phase, item n of m, issue number, executor running since T) written by the live tick and rendered under `Run lock`; (4) `--check --verbose`: every git/gh invocation with duration and exit code, the discovery query as sent, the unfiltered candidate list; (5) an investigative command printed under each problem. Also: when the lock is held and no tick has ever completed, `Recent ticks` must not raise a problem."

## Context

Issue #82 reports a `--check` run whose output contained a contradiction it could not explain:
a tick was live (pid 851554, ~4 minutes) while the same report said there was no execution log at all,
and raised that as a problem — exit 1. Two facts are missing from the report that would have resolved it:

- the operation-log directory is `dirname(process.cwd())`, so a tick launched from a different working
  directory than the one being checked writes its logs somewhere else entirely, and the report never
  says where its own path came from;
- `recordTick` runs when a tick *ends*, so a first-ever tick still in flight legitimately has no line yet.

The same issue asks for two further things: that a tick which is *blocked* dump everything useful rather
than one line, and that the live tick's mid-flight state be observable at all.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A blocked tick explains itself (Priority: P1)

An operator runs `do-work` (by hand or from cron) and it does nothing. Today each of the five ways that
happens prints a single line and exits. The operator wants the tick to leave behind the same six-section
health report `--check` produces, headed by what blocked it, so that one output answers "why did nothing
happen" without a second command.

**Why this priority**: it is the ask that closes the ticket, it reuses a renderer that already exists, and
it subsumes the reported symptom — the paste in the issue is a blocked tick's one line plus a guess.

**Independent Test**: run `do-work` in a checkout whose run lock is held; the command prints
`blocked: run lock held by pid <n>` followed by `Run lock` / `Recent ticks` / `Last work` / `Repository` /
`Selection` / `Environment`, and exits with the code it would have exited with anyway.

**Acceptance Scenarios**:

1. **Given** a held run lock, **When** `do-work` runs, **Then** the existing one-line message is printed
   and followed by the full six-section report headed `blocked: run lock held by pid <n> on <host>`, and
   the exit code is unchanged (0, or 2 when the lock is suspect).
2. **Given** an unusable configuration, **When** `do-work` runs, **Then** the existing `Error: …` line is
   printed and followed by the report headed `blocked: configuration is not usable`, and the exit code
   stays 1.
3. **Given** a tick whose pre-flight left the working tree dirty and every item skipped, **When** the tick
   finishes, **Then** the report is printed headed `blocked: the pre-flight did not prepare the checkout`.
4. **Given** a tick where no candidate was picked up, **When** the tick finishes, **Then** the report is
   printed headed `blocked: no candidate was picked up (0 of <n>)`.
5. **Given** a tick where candidates were picked up but the executor ran for none of them, **When** the
   tick finishes, **Then** the report is printed headed `blocked: <n> item(s) selected, none reached the executor`.
6. **Given** `--json`, **When** any of the above occurs, **Then** stdout carries one JSON object with a
   `blocked` key holding `{ reason, trigger, report }`, `report` being the same payload `--check --json`
   emits, and no report text is written to stdout.
7. **Given** `doWork.dumpOnBlock` set to `false`, **When** any of the above occurs, **Then** the existing
   one-line behaviour is what happens, no report is rendered, and no `blocked` key appears in the JSON.
8. **Given** a tick that answered at least one item, **When** it finishes, **Then** no report is rendered:
   the tick was not blocked.

---

### User Story 2 - The report says where it looked and who is holding the lock (Priority: P1)

The operator wants the report to name the operation-log directory, say that it is `dirname(cwd)`, say
whether it is writable, and — when a lock is held — say which working directory the holding tick runs from,
so a holder logging to a different directory than the one being read is visible rather than inferred.

**Why this priority**: it is the cheapest fix and it is the one that explains the paste in the issue.

**Independent Test**: run `do-work --check` from a checkout; `Recent ticks` names the directory and its
derivation whether or not a log is present there.

**Acceptance Scenarios**:

1. **Given** any `--check` run, **When** `Recent ticks` is rendered, **Then** it always contains a line
   naming the resolved log directory, stating it is the parent of the current working directory, naming
   that working directory, and reporting whether the directory is writable.
2. **Given** a log directory that cannot be written, **When** `--check` runs, **Then** that is a problem
   with an investigative command, because a tick there records nothing.
3. **Given** a run lock written by this version, **When** it is inspected, **Then** the lock file records
   the holder's working directory and `Run lock` prints it.
4. **Given** a held lock whose recorded working directory differs from the checking process's, **When**
   `Run lock` is rendered, **Then** it states that the holding tick logs to the parent of *its* directory
   while this check reads the parent of *this* one, and raises that as a problem.
5. **Given** a run lock written by an older automata with no recorded working directory, **When** it is
   inspected, **Then** the directory is reported as unknown and no comparison problem is raised.

---

### User Story 3 - A live tick is no longer opaque (Priority: P2)

The operator wants to know what the running tick is actually doing: which phase it is in, which item of how
many, which issue or pull request, and — when a model is running — since when.

**Why this priority**: it is the largest piece and the only one that needs a new write path, but without it
"blocked: run lock held by pid n" still cannot say what that pid is busy with.

**Independent Test**: while a tick is running, `do-work --check` prints a phase line under `Run lock`.

**Acceptance Scenarios**:

1. **Given** a tick holding the lock, **When** it moves between pre-flight, discovery and per-item work,
   **Then** the lock's heartbeat records the phase, and for per-item work the item's ordinal, the total and
   the item's subject.
2. **Given** a tick that has launched the executor, **When** the heartbeat is read, **Then** it names the
   executor command and the time the run started.
3. **Given** a held lock with a heartbeat, **When** `Run lock` is rendered, **Then** the phase, the item and
   the executor are printed under the owner line, each with how long ago the heartbeat was updated.
4. **Given** a heartbeat left behind by a previous holder, **When** the current lock is read, **Then** the
   heartbeat is ignored, because it does not belong to the lock that is held.
5. **Given** a heartbeat that cannot be written or read, **When** a tick runs or a report is rendered,
   **Then** nothing changes: no output, no problem, no change to any exit code.

---

### User Story 4 - `--check --verbose` shows the work behind the answer (Priority: P2)

The operator wants to see the `git` and `gh` calls the check made, with durations and exit codes, the
discovery query as sent, and the candidate list before the discovery filter narrowed it.

**Why this priority**: it turns "the selection found nothing" into "here is the query, here is what came
back, here is what was dropped".

**Independent Test**: `do-work --check --verbose` prints a `Commands` block listing every `git`/`gh`
invocation with a duration and an exit code.

**Acceptance Scenarios**:

1. **Given** `--check --verbose`, **When** the report is rendered, **Then** a `Commands` block follows the
   six sections listing each `git` and `gh` invocation in the order made, with its arguments, its duration
   and its exit code.
2. **Given** `--check` without `--verbose`, **When** the report is rendered, **Then** no `Commands` block
   appears and no command is recorded.
3. **Given** `--check --verbose`, **When** `Selection` is rendered, **Then** it additionally states the
   discovery technique, value and limit as sent, lists every issue the discovery query returned, and lists
   every open orphan pull request considered with whether the discovery filter kept it.
4. **Given** `--check --verbose --json`, **When** the report is emitted, **Then** the command trace is a
   top-level `trace` array on the JSON payload.
5. **Given** `--verbose` on a blocked dump, **When** the report is rendered, **Then** it carries the same
   additions.

---

### User Story 5 - Each problem names the command that investigates it (Priority: P3)

The operator wants each problem followed by one command that digs further, so the report ends with an
action rather than a description.

**Why this priority**: it is the smallest change and it depends on nothing else.

**Acceptance Scenarios**:

1. **Given** a report with problems, **When** it is rendered as text, **Then** each problem that has an
   investigative command is followed by an indented line naming it.
2. **Given** a problem for which no single command investigates further, **When** it is rendered, **Then**
   no such line is printed and nothing is invented.
3. **Given** `--json`, **When** a problem is emitted, **Then** it carries a `command` field holding the
   command or `null`.

---

### User Story 6 - A live first tick is not reported as a broken loop (Priority: P1)

**Acceptance Scenarios**:

1. **Given** a held (or suspect) run lock and an execution log that is absent, unreadable-as-empty or holds
   no tick for this repository, **When** `--check` runs, **Then** `Recent ticks` states the fact as a line
   but raises no problem, because a first tick still in flight has not recorded itself yet.
2. **Given** a free run lock and the same absent log, **When** `--check` runs, **Then** it is a problem, as
   today.
3. **Given** a held lock and an execution log that could not be *read* (a permissions or I/O failure),
   **When** `--check` runs, **Then** it stays a problem: a live tick does not explain an unreadable file.

### Edge Cases

- A blocked dump must never change an exit code, and must never be the reason a tick fails: every part of
  it is wrapped so that a failure inside the report is reported as one line and swallowed.
- A blocked dump for a lock-held tick must not issue a GitHub discovery query: a wedged loop firing every
  five minutes would otherwise page the API on every tick for a report nobody reads.
- The heartbeat must never be able to break the run lock it describes; it is a separate file, and the lock
  protocol is untouched.
- A heartbeat or lock file written by an older automata parses, with the new fields absent.
- `--verbose` given without `--check` and without a block is accepted and changes nothing visible.

## Clarifications

### Session 2026-09-21 (autonomous)

- Q: Should a blocked dump re-run the GitHub discovery to fill `Selection`? → A: No — it reuses the decisions
  the tick already computed and says "not run: the tick was blocked before discovery" for the reasons that
  fire before discovery. [AUTO: a lock-held tick fires on every cron interval, so re-querying would page the
  API continuously for a report nobody is reading, and the section already has an honest "not run" shape.]
- Q: Does the blocked dump go to stdout or stderr? → A: stderr in text mode; inside the JSON object on stdout
  under `--json`. [AUTO: `do-work` already splits progress to stderr and the summary to stdout, and stderr is
  the only choice that cannot break an existing stdout consumer.]
- Q: Where does the heartbeat live? → A: `.automata/automata-heartbeat.json`, carrying the lock token.
  [AUTO: the lock file is the mutual-exclusion primitive; a diagnostic must not be able to break the thing it
  is diagnosing, and the token is what makes a stale heartbeat unreadable rather than misleading.]
- Q: Is the `--check --verbose` command trace a seventh section? → A: No — an appendix rendered after the six.
  [AUTO: `SECTION_ORDER` is pinned by the 036 contract and its tests; an appendix keeps both true.]
- Q: What happens to the exit code when the dump itself fails? → A: Nothing. Every part of the dump is
  wrapped, and a failure prints one warning line. [AUTO: matches `recordTick`, which is already the
  best-effort diagnostic precedent in this command.]

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `do-work` MUST recognise five blocked exits — a held run lock, an unusable configuration, a
  pre-flight that did not prepare the checkout, a tick that picked up no candidate, and a tick that picked
  up candidates but reached the executor for none — and MUST render the six-section health report for each.
- **FR-002**: The rendered report MUST be produced by the same code path `--check` uses, so that its
  sections, their order and their wording are identical.
- **FR-003**: The report MUST be headed by a line naming the blocking reason in the operator's terms,
  including the identifying facts available (pid and host for a held lock, the counts for a selection).
- **FR-004**: In text mode the blocked dump MUST be written to stderr, leaving stdout's existing contract
  intact; under `--json` it MUST appear as a `blocked` object on the single JSON object stdout carries.
- **FR-005**: A `doWork.dumpOnBlock` setting, default true, MUST suppress the dump entirely when false, and
  MUST be settable with `automata config set do-work-dump-on-block <true|false>` and through the config wizard.
- **FR-006**: The blocked dump MUST NOT change any exit code, MUST NOT make any GitHub call the tick had not
  already made, and MUST NOT fetch.
- **FR-007**: The run lock file MUST record the holder's working directory.
- **FR-008**: `Run lock` MUST print the holder's working directory, and when it differs from the checking
  process's MUST state both derived log directories and raise it as a problem.
- **FR-009**: `Recent ticks` MUST always state the resolved operation-log directory, that it is the parent of
  the current working directory, that working directory, and whether the directory is writable.
- **FR-010**: An operation-log directory that is not writable MUST be a problem.
- **FR-011**: A tick MUST publish a heartbeat carrying its phase, and for per-item work the item ordinal, the
  item total and the item subject, and while a model runs the executor command and the time it started.
- **FR-012**: The heartbeat MUST be stored outside the lock file and MUST be bound to the lock's token, so a
  heartbeat that does not belong to the lock currently held is ignored.
- **FR-013**: Every heartbeat read and write MUST be best-effort: no failure may produce output, a problem, or
  a change to any exit code.
- **FR-014**: `Run lock` MUST render the heartbeat of a held or suspect lock, with the age of its last update.
- **FR-015**: A `--verbose` option MUST record every `git` and `gh` invocation made while a report is being
  built, with the command, its arguments, its duration and its exit code, and MUST render them after the six
  sections; without `--verbose` nothing is recorded.
- **FR-016**: Under `--verbose`, `Selection` MUST additionally state the discovery technique, value and limit
  as sent, the issues the discovery query returned, and the orphan pull requests considered with whether the
  discovery filter kept each.
- **FR-017**: A problem MUST be able to carry one investigative command, rendered under it in text and emitted
  as a `command` field in JSON; a problem with no useful command MUST carry null rather than an invented one.
- **FR-018**: When the run lock is held or suspect and the execution log is absent or holds no tick for this
  repository, `Recent ticks` MUST report the fact without raising a problem; an execution log that could not
  be read MUST stay a problem.

### Key Entities

- **Blocked reason**: what stopped the tick — one of `lock-held`, `config-invalid`, `preflight-failed`,
  `no-candidates`, `all-skipped` — plus the operator-facing trigger sentence for it.
- **Heartbeat**: the lock token it belongs to, when it was last updated, the phase, optionally the current
  item (ordinal, total, subject) and optionally the running executor (command, start time).
- **Traced command**: a `git` or `gh` invocation with its arguments, duration and exit code.
- **Problem**: extended with an optional investigative command.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Each of the five blocked exits produces a report whose section titles and order are identical
  to `--check`'s, verified by comparing the rendered section headings.
- **SC-002**: The paste in issue #82 — a live lock with no execution log — no longer reports a problem, and
  the report states the log directory, its derivation, its writability and the holder's working directory.
- **SC-003**: A held lock whose holder runs from a different working directory produces a problem naming both
  derived log directories.
- **SC-004**: No blocked dump changes an exit code: for each of the five reasons, the code with the dump on
  equals the code with `doWork.dumpOnBlock` false.
- **SC-005**: `--check --verbose` lists at least the `git` invocations `inspectRepoStatus` makes, each with a
  non-negative duration and an exit code.
- **SC-006**: Every problem the report can raise either carries an investigative command or is deliberately
  recorded as having none.

## Assumptions

- [AUTO] **Heartbeat storage**: a sidecar file `.automata/automata-heartbeat.json` keyed by the lock token,
  not extra fields rewritten into the lock file — the lock's protocol rests on `link`/`rename` atomicity, and
  a mid-tick rewrite could recreate a path a contender had just renamed away; token matching also makes a
  leftover heartbeat unreadable rather than misleading.
- [AUTO] **Blocked dump does no network work**: the report's `Selection` section reuses the decisions the tick
  already computed, and reports "not run: the tick was blocked before discovery" for the two pre-lock reasons;
  the repository section is inspected without fetching. A wedged loop on a five-minute cron must not page the
  GitHub API on every tick for a report nobody is reading.
- [AUTO] **The dump goes to stderr in text mode**, matching where `do-work` already writes per-item progress,
  so no existing stdout consumer changes and `--json` stdout stays a single parseable object.
- [AUTO] **Exit codes are untouched**: the dump is additive output. A diagnostic that changed what the loop
  reported would be a behaviour change disguised as a report.
- [AUTO] **`--verbose` is a plain boolean option on `do-work`**, meaningful for `--check` and for a blocked
  dump, accepted and inert otherwise — a dedicated `--check-verbose` would not compose with the blocked dump.
- [AUTO] **The command trace is a report appendix, not a seventh section**: `SECTION_ORDER` stays six long so
  the "six-section report" contract, and the tests pinning it, remain true.
- [AUTO] **`doWork.dumpOnBlock` is a boolean key under `doWork`**, reachable through `config set` and the
  wizard, following every existing `doWork.*` key.
- The operation logs stay where they are — `dirname(cwd)`, not configurable. The issue asks to be *told* where
  they are, not to move them.
- `gh` and `git` remain the only external commands worth tracing; nothing else is instrumented.
