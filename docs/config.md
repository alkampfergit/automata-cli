# automata config

Commands for configuring the tool.

---

## `automata config`

Launch the interactive configuration wizard. Use arrow keys to select the remote environment type and press Enter to save.

```bash
automata config
```

Configuration is saved to `.automata/config.json` in the current directory.

---

## `automata config set type <value>`

Set a configuration value non-interactively (useful in scripts or CI).

```bash
automata config set type gh      # GitHub
automata config set type azdo    # Azure DevOps
```

### Supported values

| Value | Description |
|---|---|
| `gh` | GitHub (requires [`gh` CLI](https://cli.github.com/)) |
| `azdo` | Azure DevOps |

### Config file location

`.automata/config.json` in the current working directory.
