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
