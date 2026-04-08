#!/usr/bin/env bash
# version_bump.sh — bump package version, generate changelog, tag, and push
# Usage: ./scripts/version_bump.sh [patch|minor|major] [--no-edit] [--force]
set -euo pipefail

BUMP="patch"
NO_EDIT=false
FORCE=false

# Parse arguments
for arg in "$@"; do
  case "$arg" in
    patch|minor|major) BUMP="$arg" ;;
    --no-edit) NO_EDIT=true ;;
    --force) FORCE=true ;;
    *) echo "Usage: $0 [patch|minor|major] [--no-edit] [--force]"; exit 1 ;;
  esac
done

# Read current version from package.json
CURRENT=$(node -e "process.stdout.write(require('./package.json').version)")

IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"
case "$BUMP" in
  patch) PATCH=$((PATCH + 1)) ;;
  minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
  major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
esac
NEW="$MAJOR.$MINOR.$PATCH"

echo "Bumping $CURRENT → $NEW ($BUMP)"

# Bump validation warnings (unless --force)
if [[ "$FORCE" == false ]]; then
  LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
  RANGE="${LAST_TAG:+${LAST_TAG}..HEAD}"

  if [[ "$BUMP" == "patch" ]]; then
    FEAT_COMMITS=$(git log ${RANGE:-HEAD} --oneline --grep='^feat(' 2>/dev/null | wc -l | tr -d ' ')
    if [[ "$FEAT_COMMITS" -gt 0 ]]; then
      echo "⚠️  WARNING: $FEAT_COMMITS feat() commit(s) found since last tag. Consider bumping minor instead."
    fi
  elif [[ "$BUMP" == "minor" ]]; then
    BREAKING_COMMITS=$(git log ${RANGE:-HEAD} --oneline --grep='BREAKING CHANGE' 2>/dev/null | wc -l | tr -d ' ')
    if [[ "$BREAKING_COMMITS" -gt 0 ]]; then
      echo "⚠️  WARNING: $BREAKING_COMMITS BREAKING CHANGE commit(s) found since last tag. Consider bumping major instead."
    fi
  fi
fi

# Update package.json (single source of truth — flake.nix reads from it)
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pkg.version = '$NEW';
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"

pnpm build

# Generate changelog with git-cliff (installed via nix devshell)
if command -v git-cliff &>/dev/null; then
  git-cliff --config cliff.toml --unreleased --tag "v$NEW" --prepend CHANGELOG.md
  echo "Changelog updated."
else
  echo "⚠️  git-cliff not found — skipping changelog generation (run inside nix devshell to enable)"
fi

# Review pause (unless --no-edit)
if [[ "$NO_EDIT" == false ]]; then
  echo "Review CHANGELOG.md before continuing"
  read -r -p "Press Enter to continue (Ctrl+C to abort)..."
fi

git add package.json CHANGELOG.md
git commit -m "chore: bump version to $NEW"

# Create annotated tag pointing at the bump commit
git tag -a "v$NEW" -m "Release v$NEW ($(date +%Y-%m-%d))"

# Push current branch + tags (no hardcoded branch name)
git push && git push --tags

echo "Done — v$NEW pushed with tag v$NEW"
