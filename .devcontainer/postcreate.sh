#!/bin/bash
# Post-creation setup script for the development container
set -e

echo "=========================================="
echo "Starting devcontainer post-creation setup"
echo "=========================================="

# Every download below is an install script or a release tarball, so pin the
# transport: a redirect must not be able to downgrade the fetch to plaintext.
CURL_TLS_OPTS=(--proto '=https' --tlsv1.2)

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

echo "  Configuring tokensave for Claude Code..."
tokensave install --agent claude || true
echo "  Configuring tokensave for Codex CLI..."
tokensave install --agent codex || true
tokensave enable-upload-counter || true

echo "  Indexing repository..."
tokensave sync || true
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

# Fetch the vendored agent plugins. `.claude/settings.json` registers
# vendor/agent-plugins-base as a project-scope marketplace, so without this the
# github-alk plugin resolves to an empty directory.
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN_ROOT="$REPO_DIR/vendor/agent-plugins-base"

echo "Initialising git submodules..."
git -C "$REPO_DIR" submodule update --init --recursive

# A submodule that fails to check out leaves an empty directory behind, and both
# clients then resolve the marketplace to nothing without reporting an error.
# Assert on the manifests each client actually reads.
echo "Verifying vendored plugin checkout..."
missing=0
for manifest in \
    "$PLUGIN_ROOT/.claude-plugin/marketplace.json" \
    "$PLUGIN_ROOT/.agents/plugins/marketplace.json" \
    "$PLUGIN_ROOT/plugins/github-alk/.claude-plugin/plugin.json" \
    "$PLUGIN_ROOT/plugins/github-alk/.codex-plugin/plugin.json"; do
    if [[ -f "$manifest" ]]; then
        echo "  OK      ${manifest#$REPO_DIR/}"
    else
        echo "  MISSING ${manifest#$REPO_DIR/}" >&2
        missing=1
    fi
done
if (( missing )); then
    echo "vendor/agent-plugins-base is not checked out; run 'git submodule update --init --recursive'." >&2
    exit 1
fi

# Claude Code picks the marketplace up from .claude/settings.json
# (extraKnownMarketplaces + enabledPlugins), so it needs no imperative step.
# Codex keeps marketplaces in ~/.codex/config.toml with no project-scoped
# equivalent, so register it here. Both commands are idempotent.
if command -v codex >/dev/null 2>&1; then
    echo "Registering agent-plugins-base marketplace with Codex..."
    codex plugin marketplace add "$PLUGIN_ROOT" || true
    echo "Installing github-alk plugin for Codex..."
    codex plugin add github-alk@agent-plugins-base || true
    codex plugin list || true
else
    echo "codex not on PATH; skipping Codex plugin registration." >&2
fi

# Expose the Spec Kit skills in .claude/skills/ to Codex by symlinking them
# under .agents/skills/ (Codex's discovery path). Idempotent: already-correct
# links are left alone.
echo "Linking Claude skills into .agents/skills/ for Codex..."
bash "$REPO_DIR/scripts/link-claude-skills.sh"
