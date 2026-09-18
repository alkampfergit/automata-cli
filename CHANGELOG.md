# Changelog

All notable changes to `automata-cli`, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows
[semantic versioning](https://semver.org/spec/v2.0.0.html).

The version headings come from the git tags on `master`, not from `package.json` — that field stays at `0.1.0` and is
rewritten by CI at publish time. Entries for `0.2.0` through `0.6.0` were reconstructed from git history after the fact;
see [docs/maintenance.md](docs/maintenance.md#changelog) for how to keep this file current from here on.

## [Unreleased]

### Fixed

- `automata git publish-release` no longer assumes the release branch is a local `master`. It resolves the trunk name
  from `origin` (an explicit `git.trunkBranch` setting, then `origin/HEAD`, then the remote's advertised HEAD, then a
  probe of `main`/`master`), fetches tags before inferring a version, and reads that version from `origin/<trunk>` — so
  a clone that only checked out `develop`, and a repository whose trunk is called `main`, both work.
- `do-work` recovers from a pull-request branch that has diverged from its remote because the same change reached the
  remote under a different sha. When every local-only commit is already on the remote as an equivalent patch, the
  branch is rebased onto the remote instead of being skipped as `pull-failed` on every tick forever. A branch holding
  a commit that is genuinely unpushed, or a merge commit, is still refused and left untouched.
- The `pull-failed` skip message now says how many commits are unpushed and gives the `git log origin/<b>..<b>`
  command to inspect them.
- A fast-forward that fails on a head branch holding nothing the remote does not — a stale `index.lock`, an
  unwritable ref, a hook that rejected the pull — is no longer reported as a divergence. The skip message names
  git's own error as the cause and no longer offers a `git reset --hard` for commits that do not exist.
- A rebase that was already in progress in the checkout is never aborted by `do-work`. The state is checked before
  the automatic rebase starts, and the item is skipped as `pull-failed` instead, so a paused manual rebase with a
  clean tree is left exactly as it was. An interrupted `git am`, which git keeps in the same `rebase-apply`
  directory, is likewise no longer mistaken for a rebase.
- The automatic rebase names `--no-reapply-cherry-picks`, so a repository with `rebase.reapplyCherryPicks` set no
  longer replays the commits that were established as already upstream. The branch is checked against the remote tip
  afterwards, and a rebase that reported success without landing there is reported as `pull-failed` rather than
  logged as synchronized.
- A `pull-failed` whose divergence could not be read at all — `git cherry` failed on a broken ref or an unreadable
  object — no longer claims the branch has diverged nor offers `git reset --hard` as the remedy. It says what could
  not be established and leaves the branch untouched.
- A pull-request branch this checkout has never seen is reported as `tracking-branch` in the operation log even when
  `git checkout` guessed it into existence from the remote-tracking ref, instead of being logged as a fast-forward of
  a branch that did not exist.

### Added

- `git.trunkBranch` in `.automata/config.json` pins the branch `publish-release` releases to, settable with
  `automata config set git-trunk-branch <name>` or the wizard's new `Git` screen. Unset by default.
- `publish-release` now refuses to run when a local trunk branch is behind `origin/<trunk>`, rather than silently
  fast-forwarding it, and prints which branch it resolved and where the name came from.
- A new `rebase-conflict` skip reason for a pull-request branch whose automatic rebase conflicted. The rebase is
  aborted first, so the branch is back on the tip it started from and the next tick does not see a conflicted index as
  a dirty working tree. It means a conflict and nothing else: a `git rebase` that git refused before replaying
  anything — a pre-rebase hook, a locked ref — is reported as `pull-failed` with `the rebase never started`, since
  there is no conflict to resolve and nothing to abort. The conflict detail carries git's stdout as well as its
  stderr, so the `CONFLICT (content): Merge conflict in <file>` lines reach the operator.
- The operation log keeps the synchronization strategy on an item that failed *after* its branch was moved, so a
  reset or a rebase is never lost from the log because a later GitHub call threw.
- The operation log records how each branch was synchronized: a `sync=` field per item in `automata-work.log`, and a
  `sync=<strategy>:<count>` summary in `automata-execution.log` whenever an item needed more than a fast-forward or
  could not be synchronized at all.

### Changed

- Every pull `automata` performs now names its strategy on the command line, so nothing depends on the machine's
  `pull.rebase` / `pull.ff` git configuration. In particular `git finish-feature` now runs `git pull --ff-only`
  instead of a bare `git pull`, which on a machine with no strategy configured failed with
  `Need to specify how to reconcile divergent branches`.
- Development dependencies refreshed: `@types/node` 26.6.1, `prettier` 3.9.7, `vitest` 5.0.1. `npm audit` reports no
  vulnerabilities.

## [0.7.0] - 2026-09-16

### Added

- `do-work` claims an issue and its pull request only when they are unassigned, so a human already working on an item
  is never taken over.

### Fixed

- `do-work` pre-flight rescue no longer gives up when a stale run lock is ignored, and now reports what each pre-flight
  step actually did instead of failing silently.
- The rescue branch is named consistently in the output, the operation log and the docs.
- The `do-work` plan line now says explicitly that an orphan pull request is not claimed.

### Changed

- Dependabot is restricted to security updates only. There is deliberately no `.github/dependabot.yml`: version
  updates re-proposed the majors this project holds back on purpose.

## [0.6.0] - 2026-09-10

### Added

- `do-work` gained a pre-flight repository hygiene pass — rescue an abandoned branch, pull, prune merged branches —
  before it picks up work.
- `do-work` writes an operation log, so a tick's decisions can be reconstructed afterwards.
- `do-work` handles orphaned pull requests: open PRs that close no issue in the repository are picked up as their own
  turn kind.
- `--effort` on every AI-invoking command, plus a `doWork.effort` config key.
- The executor and the model can be chosen from the triggering message, so a comment can ask for Codex or a specific
  model.

### Changed

- **Node.js 22.12 or newer is required.** Earlier releases documented Node 18+/20+; the dependency refresh moved the
  floor, set by `commander@15` and `ink@7`. See [docs/maintenance.md](docs/maintenance.md#supported-nodejs-versions).
- All direct dependencies were refreshed and the plugin and devcontainer setup was updated.

### Fixed

- The Codex TOML override is escaped correctly, configured effort is trimmed, and the test stubs were hardened.

### Security

- All 9 outstanding dependency advisories were cleared, and the SonarCloud security findings and code smells — including
  the duplicated `curl` TLS flags — were resolved.
- The supported-versions section of the security policy was revised.

## [0.5.0] - 2026-09-09

### Added

- `do-work`, the autonomous orchestrator: one tick finds the open issues whose newest authorized message has not been
  answered and answers them.
- `execute-prompt check-issue`, which reports whether an issue has new messages to respond to.

### Changed

- Spec Kit was updated, and the Claude skills under `.claude/skills/` are now exposed to Codex through symlinks so both
  agents see the same set.

## [0.4.0] - 2026-04-08

### Added

- `implement-next` selects across multiple issues, with `--take-first` and `--limit`.
- `execute` replaced the `test` command group and gained `--with`, `--silent` and `--model`.

### Changed

- The AI options (`--with`, `--model`, `--silent`, `--push`) are unified across every AI-invoking command.
- `execute-prompt` parameters were normalized so all prompts take the same shape.
- An issue and the pull request that implements it are linked and tracked together.

### Fixed

- Review feedback on the AI options and on the PR-linking feature was addressed.
- The test phase was sped up.

## [0.3.0] - 2026-04-01

### Added

- A `test` command group that invokes Claude Code.
- `--codex` on `implement-next`, and a `test codex` command, so Codex can be used as the executor.
- SonarCloud integration, an expanded config wizard and the `execute-prompt` command.
- `get-pr-info` reports actionable SonarCloud failure detail: gate violations, issues, and security hotspots with
  location, rule and remediation.
- A security policy (`SECURITY.md`).

### Changed

- Prompt configuration is stored as `.md` file references under `.automata/` instead of inline strings, so prompts can
  be edited as ordinary files.
- The checkout action in CI was bumped to v6.

### Fixed

- The test suite no longer deletes a real `.automata` configuration.
- Several `implement-next` bugs.

## [0.2.2] - 2026-03-31

### Security

- Published artifacts carry build provenance attestation.

## [0.2.1] - 2026-03-31

### Changed

- A clearer readme for the npm package page.

## [0.2.0] - 2026-03-31

### Added

- `config` — an ink-based configuration wizard, plus `config set type`.
- `git get-pr-info` and `git finish-feature`.
- `git get-pr-comments`, listing the open GitHub review comments.
- `git publish-release`, the full GitFlow release sequence.
- `get-ready`, which discovers a GitHub issue and hands it to Claude Code.
- `get-pr-info` lists each check with its pass/fail status and the failure detail.
- Azure DevOps remotes are recognised, with the gaps documented in [docs/azdo-gap.md](docs/azdo-gap.md).

### Fixed

- Version calculation when the repository has no tags yet.

## [0.1.0] - 2026-03-29

### Added

- Initial project setup.
- Basic CLI structure with commander.js.
