# automata-cli

A command-line interface tool for automating Git and project workflows.

## Installation

```bash
npm install -g automata-cli
```

## Quick start

```bash
automata --help
```

---

## `automata config`

Launch the interactive configuration wizard to select the remote environment type.

```bash
automata config
```

Configuration is saved to `.automata/config.json` in the current directory.

### `automata config set type <value>`

Set the remote type non-interactively (useful in scripts or CI).

```bash
automata config set type gh      # GitHub (requires gh CLI)
automata config set type azdo    # Azure DevOps
```

---

## `automata git`

Git workflow helpers. Most commands require the [`gh` CLI](https://cli.github.com/) installed and authenticated. `publish-release` only requires `git`.

### `automata git get-pr-info`

Show the pull request for the current branch, including CI check results.

```bash
automata git get-pr-info           # human-readable output
automata git get-pr-info --json    # full PR object as JSON
```

### `automata git get-pr-comments`

List open (unresolved) review thread comments on the current branch's PR.

```bash
automata git get-pr-comments           # human-readable output
automata git get-pr-comments --json    # JSON array output
```

### `automata git finish-feature`

Clean up a merged feature branch: checkout `develop`, pull latest, delete the local branch.

```bash
automata git finish-feature
```

Checks that the PR exists and is merged, the working tree is clean, and the remote tracking branch is gone before making any changes.

### `automata git publish-release`

Execute the full GitFlow release sequence and push to `origin`. Only requires `git`.

```bash
automata git publish-release            # auto-detect version from master tag
automata git publish-release 2.0.0      # explicit version
automata git publish-release --dry-run  # preview without executing
```

When no version is given, the latest semver tag on `master` is detected and the minor segment is incremented (e.g. `1.2.0 → 1.3.0`).

---

## `automata implement-next`

Find the next open GitHub issue matching the configured filter, claim it, and invoke Claude Code to implement it.

```bash
automata implement-next                # find, claim, and implement
automata implement-next --query-only   # print the issue and exit
automata implement-next --yolo         # skip Claude permission prompts
automata implement-next --json         # JSON output
automata implement-next --no-claude    # claim without launching Claude
```

See [docs/implement-next.md](docs/implement-next.md) for full details.

---

## `automata execute`

Delegate work to an AI executor (Claude or Codex) by providing a prompt inline, from a file, or via stdin.

```bash
automata execute --with claude --prompt "refactor the auth module"
automata execute --with codex  --file-prompt prompts/fix.md
echo "fix lint errors" | automata execute --with claude
```

See [docs/execute.md](docs/execute.md) for full details.

---

## Development

### Prerequisites

- Node.js LTS (20+)
- npm

### Setup

```bash
git clone https://github.com/alkampfergit/automata-cli.git
cd automata-cli
npm install
```

### Scripts

| Command | Description |
|---|---|
| `npm run build` | Build the CLI with tsup |
| `npm test` | Build and run tests with vitest |
| `npm run lint` | Lint source files with ESLint |
| `npm run typecheck` | Type-check with tsc (no emit) |
| `npm run format` | Check formatting with Prettier |

## License

[MIT](LICENSE)
