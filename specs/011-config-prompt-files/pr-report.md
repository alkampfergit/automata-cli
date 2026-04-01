# PR Report: Config Prompt Files

**Branch**: `011-config-prompt-files`
**Date**: 2026-04-01
**Spec**: [specs/011-config-prompt-files/spec.md](./spec.md)

## Summary

Prompt-type configuration fields (`claudeSystemPrompt`, `prompts.sonar`, `prompts.fixComments`) previously required embedding long text directly in `.automata/config.json`, making them difficult to edit. This feature introduces a file-reference convention: when a field value ends with `.md`, the tool reads the referenced file from `.automata/` at config-load time. Existing inline string values continue to work unchanged.

## What's New

<!-- Completed in Phase 7 after implementation -->

- **[config/configStore.ts — resolvePromptRef()]**: [placeholder]
- **[config/configStore.ts — readConfig()]**: [placeholder]
- **[config/ConfigWizard.tsx — prompt save handlers]**: [placeholder]
- **[.automata/ convention]**: [placeholder]

## Testing

<!-- Completed in Phase 7 after implementation -->

- **[Unit]**: [placeholder]
- **[Integration]**: [placeholder]

## Notes

- By convention, any prompt field value ending with `.md` is treated as a file reference. This is a documented behaviour; values that happen to end with `.md` and are intended as inline strings would need to be renamed.
