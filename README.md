# automata-cli

A command-line interface tool.

## Installation

```bash
npm install -g automata-cli
```

## Usage

```bash
automata --help
```

## Commands

### `automata config`

Launch the interactive configuration wizard. Use arrow keys to select the remote environment type and press Enter to save.

```bash
automata config
```

### `automata config set type <value>`

Set a configuration value non-interactively (useful in scripts or CI).

```bash
automata config set type gh      # GitHub
automata config set type azdo    # Azure DevOps
```

Configuration is saved to `.automata/config.json` in the current directory.

### `automata git get-pr-info`

Show the pull request associated with the current branch (requires [`gh` CLI](https://cli.github.com/) installed and authenticated).

```bash
automata git get-pr-info           # human-readable output
automata git get-pr-info --json    # JSON output
```

Example output:

```
PR:    #42
Title: Fix authentication bug
State: MERGED
URL:   https://github.com/org/repo/pull/42
```

If no PR exists for the current branch, a friendly message is printed and the command exits with code 0.

### `automata git finish-feature`

Clean up a merged feature branch in one step: checkout `develop`, pull the latest, and delete the local branch.

```bash
automata git finish-feature
```

The command validates all preconditions before making any changes:

- Must **not** be on the `develop` branch
- Working tree must be clean (no uncommitted changes)
- A pull request for the branch must exist
- The PR must be in `merged` state (not open or closed-without-merge)
- The remote tracking branch must no longer exist (`origin/<branch>` is gone)

If any precondition fails, the command prints a descriptive error to stderr and exits with a non-zero code.

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
| --- | --- |
| `npm run build` | Build the CLI with tsup |
| `npm test` | Build and run tests with vitest |
| `npm run lint` | Lint source files with ESLint |
| `npm run typecheck` | Type-check with tsc (no emit) |
| `npm run format` | Check formatting with Prettier |

## License

[MIT](LICENSE)
