# Plan: conductor thread assembly and prompts

- `src/conductor/thread.ts` (pure): `ConductorThread`, `composeConductorPrompt`, `renderChecks`, `promptKeyFor`.
- `src/github/ghWorkService.ts`: `getPrChecks`.
- `src/config/configStore.ts`: `ConductorPrompts`, two defaults, resolution in `readConfig()`.
- `src/commands/config.ts`: `config set conductor-prompt`. `src/config/ConfigWizard.tsx`: two prompt screens.
- Docs: `docs/conductor.md`, `docs/config.md`, `CHANGELOG.md`.
- Tests: `conductorThread`, `ghWorkService`, `configStore`, `config.cmd`, `ConfigWizard`.
