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

## Commands

| Command group | Description | Docs |
|---|---|---|
| `automata config` | Configure the tool | [docs/config.md](docs/config.md) |
| `automata git` | Git workflow helpers (requires `gh` CLI) | [docs/git.md](docs/git.md) |

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
