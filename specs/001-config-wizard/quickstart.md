# Quickstart: Config Wizard

## Setup

```bash
npm install
npm run build
```

## Usage

### Interactive wizard

```bash
node dist/index.js config
```

Use arrow keys to select `GitHub` or `Azure DevOps`, then press Enter to confirm.

### Non-interactive

```bash
node dist/index.js config set type gh
node dist/index.js config set type azdo
```

### Read current config

```bash
cat .automata/config.json
```
