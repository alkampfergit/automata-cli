#!/bin/bash
# Post-creation setup script for the development container
set -e

echo "=========================================="
echo "Starting devcontainer post-creation setup"
echo "=========================================="

# Every download below is an install script or a release tarball, so pin the
# transport: a redirect must not be able to downgrade the fetch to plaintext.
CURL_TLS_OPTS=(--proto '=https' --tlsv1.2)

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Fix apt sources issue with yarn (copied from reference container)
echo "Cleaning up apt sources..."
sudo rm -f /etc/apt/sources.list.d/yarn.list

# Update apt and install utilities
echo "Installing system dependencies..."
sudo apt-get update
sudo apt-get install -y git-flow

# Setup git aliases
echo "Configuring git aliases..."
bash .devcontainer/setup-git-aliases.sh

# Install Claude Code CLI via official native installer (auto-updates)
# See: https://docs.anthropic.com/en/docs/claude-code/overview
echo "Installing Claude Code CLI..."
curl "${CURL_TLS_OPTS[@]}" -fsSL https://claude.ai/install.sh | bash || true

# Install CLI tools that are distributed via npm
if command -v npm >/dev/null 2>&1; then
    echo "Installing OpenAI Codex..."
    npm install -g --ignore-scripts @openai/codex || true
    # Install the published automata-cli from the official npm registry so the
    # `automata` command is available in the container alongside the local
    # working copy (built with `npm run build`).
    echo "Installing automata-cli from npm..."
    npm install -g --ignore-scripts automata-cli || true
else
    echo "npm not available, skipping npm-based CLI installs."
fi

# Install uv (Astral) and GitHub spec-kit via uv tool
# uv provides a universal version manager; we install via official script
if ! command -v uv >/dev/null 2>&1; then
    echo "Installing uv..."
    curl "${CURL_TLS_OPTS[@]}" -LsSf https://astral.sh/uv/install.sh | sh
else
    echo "uv already installed, skipping."
fi

# use uv to install github spec-kit command-line tool.
# spec-kit is published only as a git source, never as a wheel, so uv has to
# build it — `--no-build` would make this command fail outright rather than
# make it safer. The trust decision is the pinned upstream repository itself.
if command -v uv >/dev/null 2>&1; then
    echo "Installing github spec-kit via uv..."
    uv tool install specify-cli --from git+https://github.com/github/spec-kit.git || true # NOSONAR
else
    echo "uv not available, cannot install spec-kit."
fi

# tokensave: semantic code intelligence for Claude Code and Codex CLI.
echo "Installing tokensave..."
TOKENSAVE_TAG=$(curl "${CURL_TLS_OPTS[@]}" -sI https://github.com/aovestdipaperino/tokensave/releases/latest | grep -i '^location:' | sed 's|.*/tag/||;s/\r//')
TOKENSAVE_VERSION="${TOKENSAVE_TAG#v}"
ARCH=$(uname -m)
if [[ "$ARCH" = "aarch64" ]] || [[ "$ARCH" = "arm64" ]]; then
    TOKENSAVE_ARCH="aarch64-linux"
else
    TOKENSAVE_ARCH="x86_64-linux"
fi
TOKENSAVE_URL="https://github.com/aovestdipaperino/tokensave/releases/download/${TOKENSAVE_TAG}/tokensave-${TOKENSAVE_TAG}-${TOKENSAVE_ARCH}.tar.gz"
echo "  Downloading tokensave ${TOKENSAVE_VERSION} (${TOKENSAVE_ARCH})..."
curl "${CURL_TLS_OPTS[@]}" -sL "$TOKENSAVE_URL" -o /tmp/tokensave.tar.gz
tar xzf /tmp/tokensave.tar.gz -C /tmp
sudo mv /tmp/tokensave /usr/local/bin/tokensave
rm -f /tmp/tokensave.tar.gz
echo "  tokensave $(tokensave --version) installed."

# `tokensave install` ends by *prompting* on stdin to install the global
# post-commit / post-checkout git hooks, which hangs a non-interactive
# postCreateCommand. `--git-hook yes` answers it up front — and those hooks are
# what keeps the index fresh automatically (the daemon and file watcher were
# removed in 6.0.0 / 6.1.1, so git hooks are the supported auto-sync path).
echo "  Configuring tokensave for Claude Code..."
tokensave install --agent claude --git-hook yes || true
echo "  Configuring tokensave for Codex CLI..."
tokensave install --agent codex --git-hook yes || true

# `sync` only updates projects that are already initialized; `init` is the
# one-time per-project opt-in that creates .tokensave/ and does the full index.
# Running sync alone on a fresh clone is a no-op.
echo "  Indexing repository..."
tokensave init "$REPO_DIR" || true
tokensave status "$REPO_DIR" || true
echo "  tokensave setup complete."

# Install Homebrew and rtk.
append_if_missing() {
    local line="$1"
    local file="$2"

    touch "$file"
    if ! grep -Fqx "$line" "$file"; then
        echo "$line" >>"$file"
    fi
}

if ! command -v brew >/dev/null 2>&1; then
    echo "Installing Homebrew..."
    NONINTERACTIVE=1 bash -c "$(curl "${CURL_TLS_OPTS[@]}" -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
else
    echo "Homebrew already installed, skipping."
fi

if [[ -x /home/linuxbrew/.linuxbrew/bin/brew ]]; then
    BREW_BIN="/home/linuxbrew/.linuxbrew/bin/brew"
elif [[ -x /opt/homebrew/bin/brew ]]; then
    BREW_BIN="/opt/homebrew/bin/brew"
else
    BREW_BIN=""
fi

if [[ -n "$BREW_BIN" ]]; then
    BREW_SHELLENV_LINE="eval \"\$($BREW_BIN shellenv)\""
    append_if_missing "$BREW_SHELLENV_LINE" "$HOME/.zprofile"
    append_if_missing "$BREW_SHELLENV_LINE" "$HOME/.zshrc"
    append_if_missing "$BREW_SHELLENV_LINE" "$HOME/.bashrc"
    eval "$("$BREW_BIN" shellenv)"

    if brew list --formula rtk >/dev/null 2>&1; then
        echo "rtk already installed, skipping."
    else
        echo "Installing rtk via Homebrew..."
        brew install rtk
    fi

    echo "Configuring rtk for Claude Code..."
    rtk init --global --auto-patch || true
    echo "Configuring rtk for Codex CLI..."
    rtk init --global --codex --auto-patch || true
else
    echo "Homebrew install did not expose brew on a known path; skipping rtk."
fi

# ── Vendored agent plugins ────────────────────────────────────────────────────
# The plugins live in a submodule and are registered with both clients at *user*
# scope, so they follow the user around every project in this container. Nothing
# here writes into the working tree: the repo is the source of the plugins, not
# a place where installation state is recorded.
PLUGIN_ROOT="$REPO_DIR/vendor/agent-plugins-base"
CLAUDE_MARKETPLACE_MANIFEST="$PLUGIN_ROOT/.claude-plugin/marketplace.json"
CODEX_MARKETPLACE_MANIFEST="$PLUGIN_ROOT/.agents/plugins/marketplace.json"

echo "Initialising git submodules..."
git -C "$REPO_DIR" submodule update --init --recursive

# A submodule that fails to check out leaves an empty directory behind, and both
# clients then resolve the marketplace to nothing without reporting an error.
# Assert on the manifests each client actually reads.
echo "Verifying vendored plugin checkout..."
missing=0
for manifest in "$CLAUDE_MARKETPLACE_MANIFEST" "$CODEX_MARKETPLACE_MANIFEST"; do
    if [[ -f "$manifest" ]]; then
        echo "  OK      ${manifest#"$REPO_DIR/"}"
    else
        echo "  MISSING ${manifest#"$REPO_DIR/"}" >&2
        missing=1
    fi
done
if (( missing )); then
    echo "vendor/agent-plugins-base is not checked out; run 'git submodule update --init --recursive'." >&2
    exit 1
fi

# Read the marketplace name and its plugin list from the manifest rather than
# hard-coding them, so a plugin added upstream is picked up with no change here.
# node is guaranteed by the base image; jq is not.
read_marketplace_name() {
    node -e '
        const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
        if (!m.name) { process.exit(1); }
        process.stdout.write(m.name);
    ' "$CLAUDE_MARKETPLACE_MANIFEST"
}

# Emits one "name<TAB>source" line per declared plugin.
read_plugin_entries() {
    node -e '
        const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
        const root = (m.metadata && m.metadata.pluginRoot) || ".";
        const rows = (m.plugins ?? [])
            .filter((p) => p.name)
            .map((p) => [p.name, p.source ?? `${root}/${p.name}`].join("\t"));
        if (rows.length === 0) { process.exit(1); }
        process.stdout.write(rows.join("\n") + "\n");
    ' "$CLAUDE_MARKETPLACE_MANIFEST"
}

if ! MARKETPLACE_NAME=$(read_marketplace_name); then
    echo "Could not read a marketplace name from ${CLAUDE_MARKETPLACE_MANIFEST#"$REPO_DIR/"}." >&2
    exit 1
fi

# Capture into a variable first, and read it with a plain `while` loop: a
# `< <(...)` redirect would report the reader's status as the loop's, and
# `mapfile` needs bash 4. Either way a failing reader must not yield an empty
# list that then looks like "nothing to install".
if ! plugin_entries=$(read_plugin_entries); then
    echo "Could not read any plugin names from ${CLAUDE_MARKETPLACE_MANIFEST#"$REPO_DIR/"}." >&2
    exit 1
fi

PLUGIN_NAMES=()
while IFS=$'\t' read -r plugin_name plugin_source; do
    [[ -n "$plugin_name" ]] || continue
    PLUGIN_NAMES+=("$plugin_name")

    # Each client reads its own manifest; a plugin missing either one would be
    # installed for one client and silently absent from the other.
    for manifest in \
        "$PLUGIN_ROOT/$plugin_source/.claude-plugin/plugin.json" \
        "$PLUGIN_ROOT/$plugin_source/.codex-plugin/plugin.json"; do
        if [[ -f "$manifest" ]]; then
            echo "  OK      ${manifest#"$REPO_DIR/"}"
        else
            echo "  MISSING ${manifest#"$REPO_DIR/"}" >&2
            missing=1
        fi
    done
done <<<"$plugin_entries"
if (( missing )); then
    echo "A declared plugin is missing a client manifest; the submodule checkout looks incomplete." >&2
    exit 1
fi

echo "Marketplace '$MARKETPLACE_NAME' declares ${#PLUGIN_NAMES[@]} plugin(s): ${PLUGIN_NAMES[*]}"

# Registration is best-effort per client — a container that comes up without one
# of the CLIs should still finish — but every failure is reported rather than
# swallowed, so a broken install is visible in the creation log.
plugin_failures=0
try_step() {
    local description="$1"
    shift
    # stdin from /dev/null: postCreateCommand is non-interactive, and a client
    # that decided to prompt (Codex declares `authentication: ON_INSTALL`) would
    # otherwise hang container creation instead of failing.
    if "$@" </dev/null; then
        return 0
    fi
    echo "  WARNING: $description failed (${*})" >&2
    plugin_failures=$((plugin_failures + 1))
    return 0
}

# Claude Code: `--scope user` records the marketplace in ~/.claude/settings.json
# and the enablement in ~/.claude/plugins/, never in the repo. Re-running is
# harmless; an already-registered marketplace just reports itself as present.
if command -v claude >/dev/null 2>&1; then
    echo "Registering $MARKETPLACE_NAME marketplace with Claude Code (user scope)..."
    try_step "claude marketplace add" claude plugin marketplace add "$PLUGIN_ROOT" --scope user
    for plugin_name in "${PLUGIN_NAMES[@]}"; do
        echo "Installing $plugin_name for Claude Code (user scope)..."
        try_step "claude install of $plugin_name" \
            claude plugin install "$plugin_name@$MARKETPLACE_NAME" --scope user --yes
    done
    claude plugin list || true
else
    echo "claude not on PATH; skipping Claude plugin registration." >&2
    plugin_failures=$((plugin_failures + 1))
fi

# Codex keeps marketplaces in ~/.codex/config.toml, which is user scope by
# construction — there is no project-scoped equivalent.
if command -v codex >/dev/null 2>&1; then
    echo "Registering $MARKETPLACE_NAME marketplace with Codex..."
    try_step "codex marketplace add" codex plugin marketplace add "$PLUGIN_ROOT"
    for plugin_name in "${PLUGIN_NAMES[@]}"; do
        echo "Installing $plugin_name for Codex..."
        try_step "codex add of $plugin_name" codex plugin add "$plugin_name@$MARKETPLACE_NAME"
    done
    codex plugin list || true
else
    echo "codex not on PATH; skipping Codex plugin registration." >&2
    plugin_failures=$((plugin_failures + 1))
fi

if (( plugin_failures )); then
    echo "$plugin_failures plugin registration step(s) failed; see the warnings above." >&2
else
    echo "Plugins registered for Claude Code and Codex at user scope."
fi

# The .agents/skills/ symlinks are tracked in git, so they arrive with the
# checkout and need no step here. Regenerate them by hand with
# `bash scripts/link-claude-skills.sh` after adding a skill to .claude/skills/.
