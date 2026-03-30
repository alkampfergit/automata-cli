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
