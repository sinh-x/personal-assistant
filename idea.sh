#!/usr/bin/env bash
set -euo pipefail

# Log an idea interactively to ~/Documents/ai-usage/sinh-inputs/ideas/
#
# Usage: ./idea.sh
#        ./idea.sh --help

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: idea.sh"
    echo ""
    echo "  Interactively log an idea with title, category, effort, and notes."
    echo "  Saves to ~/Documents/ai-usage/sinh-inputs/ideas/YYYY-MM-DD-<slug>.md"
    exit 0
fi

IDEAS_DIR="$HOME/Documents/ai-usage/sinh-inputs/ideas"
mkdir -p "$IDEAS_DIR"

timestamp="$(date '+%Y-%m-%d %H:%M')"
today="$(date +%Y-%m-%d)"

# --- Interactive prompts ---

echo "=== Log an Idea ==="
echo ""

# Title (required)
read -rp "Title: " title
if [[ -z "$title" ]]; then
    echo "Error: Title is required." >&2
    exit 1
fi

# Category
echo ""
echo "Categories: personal | work | volunteer | learning | infra"
read -rp "Category [personal]: " category
category="${category:-personal}"

# Effort
echo ""
echo "Effort: S | M | L | XL"
read -rp "Effort [M]: " effort
effort="${effort:-M}"

# What
echo ""
read -rp "What (one-line description): " what
what="${what:-$title}"

# Why
echo ""
read -rp "Why (why this matters): " why

# Who
echo ""
read -rp "Who benefits [Sinh]: " who
who="${who:-Sinh}"

# Notes (multi-line)
echo ""
echo "Notes (extra context, press Ctrl-D when done, or Enter to skip):"
notes=""
if read -r first_line; then
    if [[ -n "$first_line" ]]; then
        notes="$first_line"
        while IFS= read -r line; do
            notes="${notes}
${line}"
        done
    fi
fi

# Tags
echo ""
read -rp "Tags (space-separated, or Enter to skip): " tags_input

# --- Generate filename ---

slug="$(echo "$title" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | sed 's/^-//' | sed 's/-$//' | cut -c1-50)"
filename="${today}-${slug}.md"

# Avoid overwriting
if [[ -f "$IDEAS_DIR/$filename" ]]; then
    counter=2
    while [[ -f "$IDEAS_DIR/${today}-${slug}-${counter}.md" ]]; do
        ((counter++))
    done
    filename="${today}-${slug}-${counter}.md"
fi

# --- Format tags ---

tags_formatted=""
if [[ -n "$tags_input" ]]; then
    for tag in $tags_input; do
        tags_formatted="${tags_formatted}\`${tag}\` "
    done
else
    tags_formatted="(none yet)"
fi

# --- Write file ---

cat > "$IDEAS_DIR/$filename" << EOF
# Idea: ${title}

> **Date:** ${timestamp}
> **Category:** ${category}
> **Status:** new
> **Effort:** ${effort}

## What
${what}

## Why
${why:-_(not specified)_}

## Who
${who}

## Notes
${notes:-_(none)_}

## Tags
${tags_formatted}
EOF

echo ""
echo "Saved: $IDEAS_DIR/$filename"
