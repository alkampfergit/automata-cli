# Data Model: Config Wizard

**Branch**: `001-config-wizard` | **Date**: 2026-03-30

## Entities

### AutomataConfig

Stored at `.automata/config.json` relative to `process.cwd()`.

| Field       | Type                | Required | Description                          |
|-------------|---------------------|----------|--------------------------------------|
| remoteType  | `"gh"` \| `"azdo"` | Yes      | Remote environment type (post-setup) |

**Validation rules**:
- `remoteType` must be one of `"gh"` or `"azdo"` (enforced by `config set type`)
- File must be valid JSON; corrupted file is treated as missing

**State transitions**:
- `missing` → `{ remoteType }` (first run of wizard or `config set type`)
- `{ remoteType }` → `{ remoteType }` (update via wizard or `config set type`)

## TypeScript Types

```typescript
export type RemoteType = "gh" | "azdo";

export interface AutomataConfig {
  remoteType?: RemoteType;
}
```
