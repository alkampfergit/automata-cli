# Agent plugins

This repository vendors [`agent-plugins-base`](https://github.com/alkampfergit/agent-plugins-base) as a git submodule and registers it in two complementary layers, so the skills it carries load both for anyone who clones the repo and for you across every project in the devcontainer.

```text
vendor/agent-plugins-base/              # git submodule, pinned by commit
├── .claude-plugin/marketplace.json     # marketplace as Claude Code reads it
├── .agents/plugins/marketplace.json    # marketplace as Codex reads it
└── plugins/github-alk/                 # the plugin, with a manifest per client
```

## The two layers

**Project scope — checked in, no setup required.** `.claude/settings.json` declares both halves, so a plain clone gets the plugin with nothing to run:

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

The path is **relative** to the project root, so it resolves in a fresh clone and in the devcontainer at `/workspaces/automata-cli` alike. Note that `claude plugin marketplace add` writes an *absolute* path — if you re-add the marketplace with the CLI, change it back to `./vendor/agent-plugins-base` before committing.

**User scope — added by the devcontainer.** `.devcontainer/postcreate.sh` initialises the submodule and then, for every plugin the marketplace declares:

```bash
claude plugin marketplace add "$PLUGIN_ROOT" --scope user
claude plugin install "<name>@agent-plugins-base" --scope user --yes

codex plugin marketplace add "$PLUGIN_ROOT"
codex plugin add "<name>@agent-plugins-base"
```

This is what makes the skills available in *every* project in the container rather than only in this one, and it is the only way to reach Codex at all — Codex keeps marketplaces in `~/.codex/config.toml` and has no project-scoped equivalent.

The two layers coexist without conflict. With both present, Claude reports a single marketplace and a single plugin:

```
❯ github-alk@agent-plugins-base
  Version: 0.1.1
  Scope: user
  Status: ✔ enabled
```

Two further properties of the postcreate step are deliberate:

- **The plugin list is read from the manifest**, not hard-coded, so a plugin added upstream is picked up on the next rebuild with no change to the script.
- **Nothing is written into the working tree.** Registration state lives in `~/.claude/` and `~/.codex/`; a container rebuild never produces a repo diff.

The user-scope registrations store an **absolute** path. That is fine as written, because the devcontainer mounts neither `~/.claude` nor `~/.codex` — each rebuild starts from an empty home and re-registers against the container's own workspace path. If you ever mount either from the host to preserve credentials, those absolute paths will point at host locations that do not exist in the container, and the user-scope marketplace will resolve to nothing (the project-scope declaration, being relative, would still work).

## Getting the submodule

```bash
git clone --recurse-submodules https://github.com/alkampfergit/automata-cli.git
# or, in an existing clone:
git submodule update --init --recursive
```

The devcontainer's `postcreate.sh` runs this for you and then asserts that each declared plugin has both a `.claude-plugin/plugin.json` and a `.codex-plugin/plugin.json`, exiting non-zero if not. **A missing submodule otherwise resolves to an empty directory and the skills silently do not load** — that is the symptom the check exists to prevent.

## Outside the devcontainer

A plain clone gets the plugin through the project-scope declaration, for this repository only. To make it available in your other projects too, run the user-scope commands above by hand, substituting the absolute path to `vendor/agent-plugins-base`.

## Verifying

```bash
claude plugin marketplace list   # agent-plugins-base -> Directory (…/vendor/agent-plugins-base)
claude plugin list               # github-alk@agent-plugins-base, scope user, enabled
codex plugin list                # github-alk from agent-plugins-base
```

## Updating the plugin

```bash
git -C vendor/agent-plugins-base fetch origin
git -C vendor/agent-plugins-base checkout <commit-or-tag>
git add vendor/agent-plugins-base
git commit -m "chore: bump agent-plugins-base"
```

The submodule pointer is the version record, so bumping it is a reviewable change like any other. Rebuild the container (or re-run the `claude plugin install` / `codex plugin add` commands) to pick the new version up.

## Plugin skills vs. this repository's own skills

Two separate sets, easily confused:

| | Plugin skills | Repository skills |
|---|---|---|
| Live in | `vendor/agent-plugins-base/plugins/*/skills/` | `.claude/skills/` |
| Installed by | the marketplace commands above, at user scope | nothing — they are part of the checkout |
| Seen by Codex via | `codex plugin add` | the tracked `.agents/skills/` symlinks |

The `.agents/skills/` symlinks are committed, so they arrive with the clone. Regenerate them with `bash scripts/link-claude-skills.sh` after adding a skill to `.claude/skills/`; `postcreate.sh` deliberately does not run it, so that container creation cannot modify the working tree.

## Relationship to `do-work`

These are separate concerns and it is worth keeping them separate.

automata models no concept of a skill: `do-work` assembles context and enforces a turn boundary, and the *instructions* come from prompts in `.automata/`. A prompt may name a skill this plugin provides — that is the intended way to point the agent at richer behaviour — but nothing in automata depends on the plugin being installed. The built-in default prompts name no skill at all, so the loop works correctly in an environment with no plugins.

See [wiki/Prompts.md](wiki/Prompts.md) for the prompt contract and a worked example that names a skill.
