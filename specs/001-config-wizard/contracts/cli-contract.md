# CLI Contract: Config Wizard

**Branch**: `001-config-wizard` | **Date**: 2026-03-30

## Commands

### `automata config`

Launches interactive ink wizard to configure the tool.

**Behaviour**:
- Renders a list selector with options: `GitHub` / `Azure DevOps`
- Pre-selects current value if config exists
- On confirm: writes `.automata/config.json` and exits
- On Ctrl+C: exits without writing

**Exit codes**:
- `0` — success (config saved or wizard cancelled cleanly)
- Non-zero — unexpected error (e.g., disk write failure)

---

### `automata config set type <value>`

Sets a config key non-interactively.

**Arguments**:
- `<value>`: `gh` | `azdo`

**Stdout**: `Remote type set to: gh` (or `azdo`)
**Stderr**: Error message if value is invalid

**Exit codes**:
- `0` — success
- `1` — invalid value
