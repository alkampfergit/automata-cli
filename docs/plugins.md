# Agent plugins

This repository vendors [`agent-plugins-base`](https://github.com/alkampfergit/agent-plugins-base) as a git submodule and registers it with Claude Code, so the skills it carries load automatically for anyone working here.

```text
vendor/agent-plugins-base/          # git submodule, pinned by commit
└── .claude-plugin/marketplace.json # declares the `agent-plugins-base` marketplace
    └── plugins/github-alk/         # the plugin this repository enables
```

## What is configured

`.claude/settings.json` is checked in and declares both halves at **project scope**, so a clone needs no per-machine setup:

```json
{
  "extraKnownMarketplaces": {
    "agent-plugins-base": {
      "source": { "source": "directory", "path": "./vendor/agent-plugins-base" }
    }
  },
  "enabledPlugins": { "github-alk@agent-plugins-base": true }
}
```

The marketplace source is the **vendored directory**, not the git URL, which matters for two reasons:

- **The submodule pins the version.** The plugin the repository uses is whatever commit the submodule points at, so it changes only when someone deliberately bumps it — not whenever the upstream default branch moves.
- **No network is needed** to resolve the plugin once the submodule is present.

The path is written **relative** to the project root. Claude Code expands it against the project, so it works in a fresh clone and in the devcontainer at `/workspaces/automata-cli` alike. Note that `claude plugin marketplace add` writes an *absolute* path — if you re-add the marketplace with the CLI, change it back to `./vendor/agent-plugins-base` before committing.

## Getting the submodule

```bash
git clone --recurse-submodules https://github.com/alkampfergit/automata-cli.git
# or, in an existing clone:
git submodule update --init --recursive
```

The devcontainer's `postcreate.sh` runs this for you. **If the submodule is missing, the marketplace resolves to an empty directory and the plugin's skills silently do not load** — that is the symptom to recognise.

## Verifying

```bash
claude plugin marketplace list      # agent-plugins-base -> Directory (…/vendor/agent-plugins-base)
claude plugin list                  # github-alk@agent-plugins-base, scope project, enabled
```

## Updating the plugin

```bash
git -C vendor/agent-plugins-base fetch origin
git -C vendor/agent-plugins-base checkout <commit-or-tag>
git add vendor/agent-plugins-base
git commit -m "chore: bump agent-plugins-base"
```

The submodule pointer is the version record, so bumping it is a reviewable change like any other.

## Relationship to `do-work`

These are separate concerns and it is worth keeping them separate.

automata models no concept of a skill: `do-work` assembles context and enforces a turn boundary, and the *instructions* come from prompts in `.automata/`. A prompt may name a skill this plugin provides — that is the intended way to point the agent at richer behaviour — but nothing in automata depends on the plugin being installed. The built-in default prompts name no skill at all, so the loop works correctly in an environment with no plugins.

See [wiki/Prompts.md](wiki/Prompts.md) for the prompt contract and a worked example that names a skill.
