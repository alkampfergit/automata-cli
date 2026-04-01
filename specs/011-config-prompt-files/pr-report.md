# PR Report: Config Prompt Files

**Branch**: `011-config-prompt-files`
**Date**: 2026-04-01
**Spec**: [specs/011-config-prompt-files/spec.md](./spec.md)

## Summary

Prompt-type configuration fields (`claudeSystemPrompt`, `prompts.sonar`, `prompts.fixComments`) previously required embedding long text directly in `.automata/config.json`, making them difficult to edit. This feature introduces a file-reference convention: when a field value ends with `.md`, the tool reads the referenced file from `.automata/` at config-load time. Existing inline string values continue to work unchanged.

## What's New

- **`resolvePromptRef()` helper** (`src/config/configStore.ts`): New exported function that resolves a config field value ending with `.md` to the file's contents from `.automata/`. Includes path-traversal prevention. Inline strings are returned unchanged.
- **`readRawConfig()` function** (`src/config/configStore.ts`): New exported function that reads `config.json` without resolving file references — used internally by the config wizard when merging updates.
- **`readConfig()` resolution** (`src/config/configStore.ts`): Updated to automatically resolve `claudeSystemPrompt`, `prompts.sonar`, and `prompts.fixComments` through `resolvePromptRef()` before returning — fully transparent to callers.
- **Config wizard prompt saves** (`src/config/ConfigWizard.tsx`): The system-prompt, sonar-prompt, and fix-comments-prompt save handlers now write prompt content to the corresponding `.automata/*.md` file and store only the filename in `config.json`.
- **`.automata/config.json` migration**: `claudeSystemPrompt` now references `claude-system-prompt.md` instead of embedding the prompt inline.
- **Documentation** (`docs/config.md`): New "Prompt file references" section documents the convention, rules, and wizard filename mapping.

## Testing

- **Unit — `resolvePromptRef()`**: inline string pass-through, `.md` file read, missing file error, path traversal rejection.
- **Unit — `readConfig()` resolution**: resolves `claudeSystemPrompt`, `prompts.sonar`, `prompts.fixComments` from `.md` refs; inline strings unchanged; throws on missing file.
- **Unit — `readRawConfig()`**: returns filename as-is without resolving.
- **Regression — ConfigWizard**: existing wizard tests updated with `readRawConfig` mock and `node:fs` mock to prevent disk writes; all 197 tests pass.

## Notes

- By convention, any prompt field value ending with `.md` is treated as a file reference. Inline prompt values that happen to end with `.md` would need to be renamed (edge case — prompt text ending with `.md` is extremely unlikely in practice).
