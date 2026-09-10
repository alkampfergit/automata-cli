# Feature Specification: Operation log for `do-work`

**Feature Branch**: `feature/033-operation-log`

**Created**: 2026-09-10

**Status**: Draft

**Input**: User description: "For each do-work two log files should be maintained. 1. `automata-execution.log` contains one line for each run, brief, keep only latest 1000 lines. 2. `automata-work.log` a log that contains a brief summary of each run that actually performs something. Keep only records of last month. Automata should create these two files in the parent directory from where it runs, check permission to write, if no permission exists, just ignore writing those files."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See that the loop is alive (Priority: P1)

An operator runs `automata do-work` from cron every few minutes. Most ticks find
nothing to do and print a two-line summary that nobody reads. When the loop
silently stops working — a lock left behind, a credential expiry, a repository
that no longer matches the discovery query — there is no durable record to look
at, because cron's own output has been discarded.

After this feature, every `do-work` invocation appends exactly one line to
`automata-execution.log` in the directory above the checkout. The operator can
`tail` that file and see, at a glance, that ticks are still firing, how long
they take, how many items each one considered and what exit code each produced.

**Why this priority**: This is the file that answers "is the loop running at
all", which is the question the operator has today no way to answer. It is also
the only one written on every tick, so it is the smaller, independently useful
slice.

**Independent Test**: Run `do-work` twice in a checkout whose parent directory
is writable, once with work available and once without. Both invocations append
a line; the file has two lines; each line names the timestamp, repository,
counts and exit code.

**Acceptance Scenarios**:

1. **Given** a writable parent directory and a tick that answers one issue,
   **When** `do-work` finishes, **Then** `../automata-execution.log` has gained
   one line containing the UTC timestamp, the repository slug, the item counts
   by outcome, the number of executor runs, the exit code and the duration.
2. **Given** a tick that finds nothing to do, **When** `do-work` finishes,
   **Then** a line is still appended, recording zero items and exit code 0.
3. **Given** `automata-execution.log` already holds 1000 lines, **When** another
   tick appends its line, **Then** the file still holds 1000 lines and the
   oldest line is gone.
4. **Given** a parent directory that cannot be written, **When** `do-work` runs,
   **Then** the tick completes exactly as it does today, no error is printed on
   stdout, and the exit code is unchanged.

---

### User Story 2 - Review what the agent actually did (Priority: P2)

The same operator wants a longer-horizon record of the ticks that *did*
something — which issues were picked up, which turn ran, and what the outcome
was — without keeping every no-op tick. `automata-work.log` holds one record per
tick in which the executor was actually invoked, and drops records older than 30
days.

**Why this priority**: Useful, but it depends on the same file-writing
foundation as Story 1 and answers a less urgent question ("what happened last
week" rather than "is it running").

**Independent Test**: Run a tick where the executor is invoked for one item and
a tick where nothing is actionable. Only the first writes a record to
`../automata-work.log`.

**Acceptance Scenarios**:

1. **Given** a tick that invokes the executor for two issues, **When** it
   finishes, **Then** `../automata-work.log` gains one record whose header names
   the timestamp and repository and whose body has one line per invoked item
   with the issue number, turn, outcome and a brief detail.
2. **Given** a tick in which no item reached the executor (nothing actionable,
   every item deferred by the run cap, or every item skipped for a dirty tree),
   **When** it finishes, **Then** `automata-work.log` is not modified and is not
   created.
3. **Given** `automata-work.log` contains records dated 40 days ago and 5 days
   ago, **When** a new record is appended, **Then** the 40-day-old record is
   removed and the 5-day-old record is kept.

---

### User Story 3 - Never let logging break a tick (Priority: P1)

The logs are diagnostics, not deliverables. An unattended loop must not start
failing because the disk filled, the parent directory became read-only, or the
checkout was moved to a filesystem root.

**Why this priority**: Same priority as Story 1 because it is a property of the
same code path rather than a later addition — a logging write that can throw
would turn a healthy tick into a failed one on the very machines this feature
exists to observe.

**Independent Test**: Make the parent directory read-only and run a tick that
would otherwise succeed. The tick's stdout, stderr and exit code are identical
to a run with logging disabled, apart from at most one warning on stderr.

**Acceptance Scenarios**:

1. **Given** a parent directory without write permission, **When** a tick
   answers an issue, **Then** the exit code is 0 and neither log file exists.
2. **Given** an `automata-execution.log` that exists but cannot be opened for
   append, **When** a tick runs, **Then** the failure is swallowed and the tick
   reports its normal summary.
3. **Given** a corrupt `automata-work.log` whose content does not match the
   record format, **When** a tick appends a record, **Then** the append still
   succeeds and no exception escapes.

---

### Edge Cases

- **Checkout at the filesystem root**: `dirname("/")` is `/`. The write is
  attempted there and, on a normal system, fails the permission check and is
  skipped. No special case is needed.
- **Two repositories under one parent**: both write to the same pair of files.
  The repository slug on every line and every record header keeps them
  distinguishable. Appends use O_APPEND so interleaving does not corrupt a line.
- **Trim racing an append**: the trim rewrites the whole file, so a line another
  process appended between the read and the rename can be lost. Accepted: this
  is a diagnostic log, and the trim only runs on the rare tick that crosses the
  1000-line boundary.
- **A `--dry-run` tick**: writes nothing to either file, matching the flag's
  documented promise that nothing changes.
- **A tick blocked by the run lock**: still writes an execution line, marked as
  such. A loop that is doing nothing because of a stale lock is exactly the
  failure this log exists to expose.
- **An interrupted tick** (SIGINT/SIGTERM): no line is written, because the
  process exits from the signal handler before the tick returns. Documented, not
  worked around.
- **A very long detail string**: truncated so one item never dominates a record.

## Clarifications

### Session 2026-09-10 (autonomous)

- Q: Should a run blocked by the run lock write an execution line? → A: Yes, with `note=lock-held` [AUTO: a loop stalled behind a stale lock is the failure the log exists to expose; silence there is indistinguishable from cron not firing].
- Q: How long may an item's `detail` be inside a work record? → A: Truncated to 200 characters with an ellipsis [AUTO: a `failed` outcome carries an executor error message that can run to kilobytes, and "brief summary" is the stated requirement].
- Q: Should the trim/prune run before or after the append? → A: After [AUTO: the newest line must survive even if the rewrite fails, and appending first keeps the common path a single `O_APPEND` write].
- Q: What happens if `automata-work.log` content does not parse as records? → A: Text before the first `=== ` header is preserved as-is and the append still succeeds [AUTO: silently discarding a user's file is worse than keeping an unparseable prefix, and FR-008 forbids throwing].
- Q: Should the execution line include the skipped count? → A: Yes, all four outcome buckets [AUTO: `skipped` is how a dirty working tree surfaces, which is a common and otherwise invisible reason a tick does nothing].

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `do-work` MUST append one line to `automata-execution.log` in the
  parent directory of the process working directory at the end of every
  non-dry-run invocation, including invocations that found no work and
  invocations blocked by the run lock.
- **FR-002**: The execution line MUST be a single line carrying: a UTC ISO-8601
  timestamp, the command name, the repository slug, the number of reported
  items, the count for each of the five outcomes (`answered`,
  `answered-no-reply`, `skipped`, `failed`, `deferred`), the number of executor
  runs, the process exit code and the wall-clock duration.
- **FR-003**: After appending, if `automata-execution.log` holds more than 1000
  lines, the oldest lines MUST be discarded so that exactly the newest 1000
  remain.
- **FR-004**: `do-work` MUST append one record to `automata-work.log` at the end
  of a non-dry-run invocation in which the executor was invoked for at least one
  item, and MUST write nothing to that file otherwise.
- **FR-005**: A work record MUST consist of a header line naming the UTC
  timestamp and the repository, followed by one line per item that reached the
  executor, giving the issue number, the turn, the outcome and a brief detail.
- **FR-006**: On append, records in `automata-work.log` whose header timestamp is
  more than 30 days older than the current time MUST be removed.
- **FR-007**: Before writing, the system MUST check that the target directory is
  writable and skip both files silently when it is not.
- **FR-008**: Any error raised while checking, opening, appending, trimming or
  pruning either file MUST be swallowed. Logging MUST NOT change the command's
  stdout, its exit code, or whether the tick succeeded.
- **FR-009**: `do-work --dry-run` MUST NOT create or modify either file.
- **FR-010**: `do-work --json` MUST keep emitting exactly the JSON it emits
  today; the logs are a side channel, not part of the contract.
- **FR-011**: Commands other than `do-work` MUST NOT write to either file.

### Key Entities

- **Execution log entry**: one tick, as one line. Timestamp, command,
  repository, counts, exit code, duration, optional note (`lock-held`).
- **Work log record**: one tick that ran the executor. A header (timestamp,
  repository) plus one line per invoked item (issue, turn, outcome, detail).
- **Log location**: the parent directory of the process working directory,
  resolved once per invocation.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After 10 consecutive `do-work` invocations, `automata-execution.log`
  contains exactly 10 lines, one per invocation, in chronological order.
- **SC-002**: `automata-execution.log` never exceeds 1000 lines regardless of how
  many ticks have run.
- **SC-003**: `automata-work.log` contains a record for every tick that invoked
  the executor within the last 30 days and for no tick that did not.
- **SC-004**: With the parent directory read-only, a full `do-work` tick produces
  byte-identical stdout and the same exit code as the same tick with the parent
  directory writable.
- **SC-005**: An operator can determine from one line of `automata-execution.log`
  whether a given tick did any work, without consulting any other source.

## Assumptions

- [AUTO] **Location is not configurable**: the directory is `dirname(cwd)` with
  no config key and no opt-out, because the description states it directly and
  the constitution's Simplicity principle rejects configuration not demanded by
  a user scenario.
- [AUTO] **"Last month" means a rolling 30 days**, not the previous calendar
  month, because a calendar boundary would delete four weeks of history in one
  step on the first of the month.
- [AUTO] **Timestamps are UTC ISO-8601** (`YYYY-MM-DDTHH:MM:SS.sssZ`), matching
  the run-lock owner file and the `gh` payloads the codebase already compares as
  strings.
- [AUTO] **Only `do-work` logs**; `implement-next`, `execute`, `execute-prompt`
  and `git *` are untouched, because the description says "for each do-work" and
  the constitution's Single Responsibility principle argues against retrofitting
  unrelated commands in the same change.
- [AUTO] **A lock-held invocation writes an execution line** carrying
  `note=lock-held`, because a loop that does nothing because of a stale lock is
  precisely the condition the execution log exists to reveal, and its absence
  would read as "cron stopped firing".
- [AUTO] **The work log records only items that reached the executor**
  (`ranExecutor === true`), which is the codebase's existing definition of
  "actually performed something" — it is what the run cap counts.
- [AUTO] **Line format is `key=value` fields**, not JSON, because the
  description asks for one brief line per run and a JSON object per line is
  neither brief nor greppable by eye.
- The parent directory is assumed to be a stable workspace root; automata is not
  responsible for creating it.
- Log files are written unencrypted and may contain issue titles and outcome
  details; the repository owner is assumed to accept that on the machine running
  the loop.
