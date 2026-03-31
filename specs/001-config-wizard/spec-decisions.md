# Spec Decisions: Config Wizard

**Branch**: `001-config-wizard`
**Date**: 2026-03-30
**Spec**: [specs/001-config-wizard/spec.md](./spec.md)
**Plan**: [specs/001-config-wizard/plan.md](./plan.md)
**Research**: [specs/001-config-wizard/research.md](./research.md)

## Planning Decisions

- **ink framework for UI**: Used `ink` (React-for-CLIs) directly without `@inkjs/ui`. **Rationale**: ink's built-in primitives (`useInput`, `Box`, `Text`) are sufficient for a two-option selector; avoids an extra dependency. **Alternatives considered**: `@inkjs/ui` Select component (heavier), `enquirer`/`prompts` (not ink, contradicts spec requirement).

- **Config location**: `.automata/config.json` relative to `process.cwd()`. **Rationale**: Project-level tools conventionally use a local hidden folder. **Alternatives considered**: `~/.automata/config.json` (global) — rejected because the tool manages agents per-project.

- **Config format**: Flat JSON `{ "remoteType": "gh" | "azdo" }`. **Rationale**: Single key; simplest format per YAGNI/Simplicity constitution principle. **Alternatives considered**: TOML/YAML — rejected to avoid adding parse dependencies.

- **JSX transform**: Added `"jsx": "react-jsx"` to tsconfig. **Rationale**: Modern JSX transform without explicit React import in every file. tsup handles bundling. **Alternatives considered**: Classic `"react"` transform — requires boilerplate `import React` in each TSX file.

- **Project structure**: New `src/config/` module for config store and wizard component; `src/commands/config.ts` for commander registration. **Rationale**: Keeps config concerns together, consistent with flat module structure per constitution. **Alternatives considered**: Inline in `src/index.ts` — rejected as it would bloat the entry point.
