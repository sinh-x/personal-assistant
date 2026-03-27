#!/usr/bin/env bash
# dedupe-doc-refs.sh — Deduplicate doc_refs in ticket JSON files
# Requirement F7 from doc-ref-deduplication spec
# Keeps the LAST entry per path (most recent), removes earlier duplicates
# Creates .bak backup before writing

set -euo pipefail

TICKETS_DIR="$HOME/Documents/ai-usage/tickets"
BACKUP_EXT=".bak"

# Find all ticket JSON files (exclude backup dirs, counter.json, audit.jsonl, lock files)
mapfile -t TICKET_FILES < <(
  find "$TICKETS_DIR" -type f -name '*.json' \
    ! -name 'counter.json' \
    ! -name 'audit.jsonl' \
    ! -path '*/backup-*/*' \
    ! -name '*.bak' \
    | sort
)

total_scanned=0
total_with_dups=0
fixed_tickets=()

for ticket_file in "${TICKET_FILES[@]}"; do
  total_scanned=$((total_scanned + 1))

  # Skip if file doesn't have doc_refs or is not valid JSON
  if ! jq -e '.doc_refs' "$ticket_file" > /dev/null 2>&1; then
    continue
  fi

  # Count duplicate paths (paths that appear more than once)
  doc_ref_count=$(jq '.doc_refs | length' "$ticket_file")
  if [[ "$doc_ref_count" -eq 0 ]]; then
    continue
  fi

  # Find duplicate paths: count distinct paths vs total doc_refs
  distinct_paths=$(jq -r 'reduce .doc_refs[] as $ref ({}; .[$ref.path] = true) | to_entries | length' "$ticket_file")
  total_paths=$(jq -r '.doc_refs | length' "$ticket_file")

  if [[ "$distinct_paths" -eq "$total_paths" ]]; then
    # No duplicates in this file
    continue
  fi

  total_with_dups=$((total_with_dups + 1))

  # Get the deduped doc_refs (keep last entry per unique path)
  # Use jq to dedupe: group by path, keep last occurrence
  deduped=$(jq '
    .doc_refs |
    reduce to_entries[] as $item
      ({}; .[$item.value.path] = $item.value) |
    [.[]] |
    .
  ' "$ticket_file")

  # Count how many duplicates were removed
  original_count=$(jq '.doc_refs | length' "$ticket_file")
  deduped_count=$(jq 'length' <<< "$deduped")
  dups_removed=$((original_count - deduped_count))

  # Create backup
  cp "$ticket_file" "${ticket_file}${BACKUP_EXT}"

  # Write deduplicated file (preserve all other fields, replace doc_refs)
  ticket_basename=$(basename "$ticket_file")
  tmp_file=$(mktemp)

  jq --argjson deduped "$deduped" '
    .doc_refs = $deduped
  ' "$ticket_file" > "$tmp_file" && mv "$tmp_file" "$ticket_file"

  fixed_tickets+=("${ticket_basename} (removed ${dups_removed} duplicate(s))")
done

# Print summary
echo "=== doc_ref Deduplication Summary ==="
echo "Tickets scanned: $total_scanned"
echo "Tickets with duplicates: $total_with_dups"
echo "Tickets fixed: ${#fixed_tickets[@]}"

if [[ ${#fixed_tickets[@]} -gt 0 ]]; then
  echo ""
  echo "Fixed tickets:"
  for fix in "${fixed_tickets[@]}"; do
    echo "  - $fix"
  done
  echo ""
  echo "Backups created with .bak extension."
else
  echo ""
  echo "No duplicates found — no changes made."
fi