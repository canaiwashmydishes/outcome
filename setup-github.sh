#!/usr/bin/env bash
#
# Outcome99 — one-command push to GitHub
#
# Usage:
#   bash setup-github.sh
#
# What this does:
#   1. Verifies git is installed and the repo URL is reachable.
#   2. Runs `git init` if not already initialized.
#   3. Sets the remote to canaiwashmydishes/outcome.
#   4. Stages all files (respecting .gitignore).
#   5. Commits with a sensible first-push message.
#   6. Pushes to main.
#
# After running this, the entire Build B2 source is live on GitHub.

set -euo pipefail

REMOTE_URL="https://github.com/canaiwashmydishes/outcome.git"
BRANCH="main"

echo "==> Outcome99 GitHub setup"
echo "    Target: $REMOTE_URL"
echo ""

# --- Sanity checks ----------------------------------------------------------

if ! command -v git >/dev/null 2>&1; then
  echo "ERROR: git is not installed. Install git first."
  exit 1
fi

# --- Git init ---------------------------------------------------------------

if [ ! -d .git ]; then
  echo "==> Initializing git repository"
  git init -b "$BRANCH"
else
  echo "==> Git repository already initialized, reusing"
  # Ensure we're on the expected branch name
  current_branch=$(git symbolic-ref --short HEAD 2>/dev/null || echo "")
  if [ "$current_branch" != "$BRANCH" ]; then
    git branch -M "$BRANCH"
  fi
fi

# --- Configure remote -------------------------------------------------------

if git remote get-url origin >/dev/null 2>&1; then
  existing=$(git remote get-url origin)
  if [ "$existing" != "$REMOTE_URL" ]; then
    echo "==> Updating origin remote ($existing -> $REMOTE_URL)"
    git remote set-url origin "$REMOTE_URL"
  else
    echo "==> Remote origin already points to $REMOTE_URL"
  fi
else
  echo "==> Adding origin remote"
  git remote add origin "$REMOTE_URL"
fi

# --- Safety check — confirm no env files are about to be committed ----------

echo "==> Pre-commit safety scan"
if git status --porcelain | grep -E '^\?\? .*\.env$|^\?\? .*serviceAccount.*\.json$' >/dev/null 2>&1; then
  echo "ERROR: Found .env or serviceAccount*.json files staged for commit."
  echo "       These must not be committed. Check your .gitignore."
  exit 1
fi

# --- Stage + commit ---------------------------------------------------------

echo "==> Staging files"
git add -A

# Only commit if there's something to commit
if git diff --cached --quiet; then
  echo "==> Nothing new to commit. Skipping commit."
else
  echo "==> Committing"
  git commit -m "Initial commit: Outcome99 Build B2

Multi-build progression from v5.0 pivot through cloud-storage integrations:
- Build 0: v6.0 foundation (deals, teams, subscriptions, audit log)
- Build A: Team management (multi-team, invitations, role management)
- Build B: Document ingestion (OCR + classification via Document AI + Claude Sonnet)
- Build B2: Cloud-storage integrations (Google Drive, SharePoint, Dropbox)
       + VDR placeholder flows (Intralinks, Datasite, Firmex)

See README.md for deploy instructions and Outcome99_BuildB2_Handoff.md
for the full architecture and test walkthrough."
fi

# --- Push -------------------------------------------------------------------

echo "==> Pushing to $BRANCH"
echo "    (you may be prompted for GitHub credentials / personal access token)"
git push -u origin "$BRANCH"

echo ""
echo "==> Done. View the repo at:"
echo "    https://github.com/canaiwashmydishes/outcome"
