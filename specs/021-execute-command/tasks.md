# Tasks: Execute Command (021)

**Input**: specs/021-execute-command/plan.md, spec.md, research.md  
**Branch**: `021-execute-command`

---

## Phase 1: Foundation — Codex model support

**Purpose**: Extend codexService to accept a model parameter, enabling US5.

- [ ] T001 [US5] Add `model?: string` to `InvokeCodexOptions` in `src/codex/codexService.ts` and forward `--model <value>` to `codex exec` args when set

**Checkpoint**: `codexService` compiles; existing callers unaffected.

---

## Phase 2: Core — execute command (US1 — inline --prompt)

**Purpose**: Create `src/commands/execute.ts` with `--with` and `--prompt` working end-to-end.

- [ ] T002 [US1] Create `src/commands/execute.ts` with `executeCommand` top-level `Command("execute")`, `--with <executor>` option, `--prompt <string>` option, `--silent` flag, `--model <string>` option
- [ ] T003 [US1] Implement `--with` validation in action handler: accept only `claude`/`codex`, exit 1 with usage error otherwise
- [ ] T004 [US1] Implement prompt-from-`--prompt` path: validate presence, invoke `invokeClaudeCode` with `yolo: true, verbose: !silent, model` or `invokeCodexCode` with `yolo: true, model` based on `--with`
- [ ] T005 Register `executeCommand` in `src/index.ts`: add import and `program.addCommand(executeCommand)`

**Checkpoint**: `automata execute --with claude --prompt "hello"` invokes Claude unattended with verbose output.

---

## Phase 3: US2 — --file-prompt source

**Purpose**: Support reading the prompt from a file on disk.

- [ ] T006 [US2] In `execute.ts` action handler, add `--file-prompt <path>` option; when set, read file with `fs.readFileSync`; exit 1 with clear message if file not found
- [ ] T007 [US2] Add mutual exclusivity check: if `--prompt` and `--file-prompt` both provided, exit 1 with "mutually exclusive" error

**Checkpoint**: `automata execute --with claude --file-prompt prompt.md` reads and forwards file content.

---

## Phase 4: US3 — stdin source

**Purpose**: Support piped input from stdin.

- [ ] T008 [US3] In `execute.ts` action handler, add async stdin-reading helper; when `!process.stdin.isTTY` and neither `--prompt` nor `--file-prompt` is set, read all stdin data as prompt
- [ ] T009 [US3] If `--prompt` is set and stdin is piped, exit 1 with "mutually exclusive" error
- [ ] T010 [US3] If no prompt source resolved and no stdin, exit 1 with "no prompt provided" error

**Checkpoint**: `echo "do something" | automata execute --with codex` forwards stdin content to Codex.

---

## Phase 5: Cleanup — remove test command

**Purpose**: Remove the old `test` command.

- [ ] T011 Remove `import { testCommand }` and `program.addCommand(testCommand)` from `src/index.ts`
- [ ] T012 Delete `src/commands/test.ts`

**Checkpoint**: `automata --help` no longer shows `test` command; `automata execute --help` is present.

---

## Phase 6: Documentation

**Purpose**: Update docs per project convention.

- [ ] T013 [P] Create `docs/execute.md` with command description, all options, examples for each prompt source, exit codes
- [ ] T014 [P] Update `README.md` command-group table: replace `test` row with `execute` row linking to `docs/execute.md`

---

## Phase 7: Tests

**Purpose**: Verify execute command behavior with unit tests.

- [ ] T015 [P] Write vitest unit tests in `src/commands/execute.test.ts` covering:
  - `--with` validation (invalid value → process.exit(1))
  - mutual exclusivity of `--prompt` + `--file-prompt`
  - `--file-prompt` with non-existent file → process.exit(1)
  - no prompt source → process.exit(1)

---

## Phase 8: Validate

- [ ] T016 Run `npm test && npm run lint`; fix any failures

---

## Dependencies & Execution Order

- T001 can run independently (codexService change)
- T002–T005 must be sequential (build the command first)
- T006–T007 depend on T002 (file-prompt extends existing command)
- T008–T010 depend on T006 (stdin extends existing command)
- T011–T012 can run after T005 (once execute is registered)
- T013–T015 can run in parallel [P] after T010
- T016 must be last
