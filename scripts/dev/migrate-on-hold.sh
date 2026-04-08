#!/usr/bin/env bash
# migrate-on-hold.sh — One-time idempotent migration: convert on-hold tickets to
# their previous active status + backlog tag.
#
# Part of PA-905: Backlog & Archive Mechanism.
#
# Logic:
#   - Finds all tickets with status "on-hold"
#   - For each: updates status to RESTORE_STATUS + adds "backlog" tag
#   - Preserves all existing tags; does not duplicate "backlog" if already present
#   - Idempotent: skips tickets already off "on-hold"
#
# Usage:
#   ./scripts/migrate-on-hold.sh           # live run
#   ./scripts/migrate-on-hold.sh --dry-run # preview without changes

set -euo pipefail

RESTORE_STATUS="pending-implementation"
ACTOR="migrate-on-hold"
DRY_RUN=false

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    *) echo "ERROR: Unknown argument: $arg" >&2; exit 1 ;;
  esac
done

echo "[migrate-on-hold] ${DRY_RUN:+DRY RUN — }Starting on-hold migration"
echo "  Restore status: ${RESTORE_STATUS}"
echo ""

# --- Collect on-hold ticket IDs ---
# pa ticket list outputs: ID  STATUS  PRIORITY  EST  ASSIGNEE  TITLE
# Filter lines that start with a ticket ID pattern (e.g. AVO-001, PA-123)
mapfile -t ON_HOLD_IDS < <(
  pa ticket list --status on-hold 2>/dev/null \
    | grep -E '^[A-Z]+-[0-9]+' \
    | awk '{print $1}'
)

if [[ ${#ON_HOLD_IDS[@]} -eq 0 ]]; then
  echo "No on-hold tickets found. Nothing to migrate."
  exit 0
fi

echo "Found ${#ON_HOLD_IDS[@]} on-hold ticket(s): ${ON_HOLD_IDS[*]}"
echo ""

MIGRATED=0
SKIPPED=0

for id in "${ON_HOLD_IDS[@]}"; do
  echo "--- Processing ${id} ---"

  # Get full ticket data as JSON
  ticket_json=$(pa ticket show "$id")
  current_status=$(echo "$ticket_json" | jq -r '.status')

  # Idempotency: if status has already changed, skip
  if [[ "$current_status" != "on-hold" ]]; then
    echo "  [SKIP] ${id}: status is '${current_status}', not on-hold. Already migrated."
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  # Build new tags: existing tags joined with commas, then append "backlog" if absent
  existing_tags_csv=$(echo "$ticket_json" | jq -r '[.tags[]?] | join(",")' 2>/dev/null || echo "")

  if [[ -z "$existing_tags_csv" ]]; then
    new_tags="backlog"
  elif echo ",$existing_tags_csv," | grep -q ",backlog,"; then
    # backlog already present — keep as-is (shouldn't happen for on-hold tickets but be safe)
    new_tags="$existing_tags_csv"
  else
    new_tags="${existing_tags_csv},backlog"
  fi

  echo "  Status:   ${current_status} → ${RESTORE_STATUS}"
  echo "  Tags:     ${existing_tags_csv:-<none>} → ${new_tags}"

  if [[ "$DRY_RUN" == "true" ]]; then
    echo "  [DRY-RUN] Would update ${id}: status=${RESTORE_STATUS}, tags=${new_tags}"
  else
    pa ticket update "$id" \
      --status "$RESTORE_STATUS" \
      --tags "$new_tags" \
      --actor "$ACTOR"

    pa ticket comment "$id" \
      --author "$ACTOR" \
      --content "Migrated from on-hold → ${RESTORE_STATUS} + backlog tag. Part of PA-905 backlog/archive mechanism. Run by scripts/migrate-on-hold.sh."

    echo "  [DONE] ${id} migrated."
  fi

  MIGRATED=$((MIGRATED + 1))
done

echo ""
echo "--- Summary ---"
echo "  Migrated: ${MIGRATED}"
echo "  Skipped:  ${SKIPPED}"
echo ""

if [[ "$DRY_RUN" == "true" ]]; then
  echo "(dry-run: no changes were made)"
else
  echo "Migration complete."
fi
