#!/usr/bin/env bash
# version_bump.sh — bump package version and push to main
# Usage: ./scripts/version_bump.sh [patch|minor|major]
set -euo pipefail

BUMP=${1:-patch}

# Validate
case "$BUMP" in
  patch|minor|major) ;;
  *) echo "Usage: $0 [patch|minor|major]"; exit 1 ;;
esac

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

# Update package.json (single source of truth — flake.nix reads from it)
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pkg.version = '$NEW';
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"

pnpm build

git add package.json
git commit -m "chore: bump version to $NEW"
git push

echo "Done — v$NEW pushed to main"
