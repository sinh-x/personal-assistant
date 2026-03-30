#!/usr/bin/env bash
# check-completions.sh — Validate fish shell completions against CLI --help output
# Exits non-zero if any drift is detected between CLI and completions.

set -euo pipefail

PA_BIN="${PA_BIN:-./dist/cli.mjs}"
COMPLETIONS_FILE="${COMPLETIONS_FILE:-./completions/pa.fish}"
TIMEOUT=2

# ANSI colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

declare -A MISSING_FLAGS=()   # flags in CLI but not in fish
declare -A SPURIOUS_FLAGS=() # flags in fish but not in CLI
ERRORS=0

# --- Helper functions ---

log_info() {
  echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $1"
}

# Run pa command with timeout
run_pa() {
  timeout "$TIMEOUT" node "$PA_BIN" "$@" 2>/dev/null || return 1
}

# Extract flags from --help output for a given command
# Returns flags WITHOUT the -- prefix (normalized for comparison with fish completions)
# Returns empty string if no flags found (e.g., command only has --help)
extract_cli_flags() {
  local cmd="$1"
  shift
  local subcmd="${1:-}"

  local help_output
  if [[ -n "$subcmd" ]]; then
    help_output=$(run_pa "$cmd" "$subcmd" --help 2>/dev/null) || return 1
  else
    help_output=$(run_pa "$cmd" --help 2>/dev/null) || return 1
  fi

  # Extract --flag patterns from Options: section
  # Remove the -- prefix to match fish completion format (fish uses -l flag, not -l --flag)
  # Also skip --help as it's implicit in fish completions
  # Use || true to handle case where grep finds nothing (exit code 1)
  echo "$help_output" | grep -oE -- '--[a-z][a-z0-9-]*' | grep -v '^--help$' | sed 's/^--//' | sort -u | tr '\n' ' ' || true
}

# Extract flags from fish completions for a given command [and subcommand]
# Returns flags as space-separated string
extract_fish_flags() {
  local cmd="$1"
  local subcmd="${2:-}"

  if [[ -z "$subcmd" ]]; then
    # Top-level command: look for '-n "__fish_seen_subcommand_from CMD"'
    grep -E "^complete -c pa -n '__fish_seen_subcommand_from $cmd'" "$COMPLETIONS_FILE" 2>/dev/null | \
      grep -oE -- '-l [a-z][a-z0-9-]*' | \
      sed 's/^-l //' | \
      sort -u | \
      tr '\n' ' ' || true
  else
    # Nested subcommand: look for '-n "__fish_seen_subcommand_from CMD; and __fish_seen_subcommand_from SUBCMD"'
    grep -E "^complete -c pa -n '__fish_seen_subcommand_from $cmd; and __fish_seen_subcommand_from $subcmd'" "$COMPLETIONS_FILE" 2>/dev/null | \
      grep -oE -- '-l [a-z][a-z0-9-]*' | \
      sed 's/^-l //' | \
      sort -u | \
      tr '\n' ' ' || true
  fi
}

# Compare two flag sets and report mismatches
compare_flags() {
  local cmd="$1"
  local subcmd="${2:-}"
  local cli_flags="$3"
  local fish_flags="$4"

  local cmd_path="$cmd"
  [[ -n "$subcmd" ]] && cmd_path="$cmd $subcmd"

  # Convert to arrays
  read -ra CLI_FLAGS <<< "$cli_flags"
  read -ra FISH_FLAGS <<< "$fish_flags"

  # Find missing flags (in CLI but not in fish)
  for flag in "${CLI_FLAGS[@]}"; do
    local found=0
    for fish_flag in "${FISH_FLAGS[@]}"; do
      if [[ "$flag" == "$fish_flag" ]]; then
        found=1
        break
      fi
    done
    if [[ $found -eq 0 ]]; then
      MISSING_FLAGS["$cmd_path"]+="$flag "
      ERRORS=$((ERRORS + 1))
    fi
  done

  # Find spurious flags (in fish but not in CLI)
  for flag in "${FISH_FLAGS[@]}"; do
    local found=0
    for cli_flag in "${CLI_FLAGS[@]}"; do
      if [[ "$flag" == "$cli_flag" ]]; then
        found=1
        break
      fi
    done
    if [[ $found -eq 0 ]]; then
      SPURIOUS_FLAGS["$cmd_path"]+="$flag "
      ERRORS=$((ERRORS + 1))
    fi
  done
}

# Validate a single command [subcommand]
validate_command() {
  local cmd="$1"
  local subcmd="${2:-}"

  local cmd_path="$cmd"
  [[ -n "$subcmd" ]] && cmd_path="$cmd $subcmd"

  # Skip if PA_BIN doesn't exist
  if [[ ! -f "$PA_BIN" ]]; then
    log_warn "PA_BIN not found at $PA_BIN, skipping $cmd_path"
    return 0
  fi

  # Skip if completions file doesn't exist
  if [[ ! -f "$COMPLETIONS_FILE" ]]; then
    log_warn "Completions file not found at $COMPLETIONS_FILE, skipping $cmd_path"
    return 0
  fi

  # Get CLI flags
  local cli_flags
  cli_flags=$(extract_cli_flags "$cmd" "$subcmd") || {
    log_warn "Could not get CLI help for $cmd_path, skipping"
    return 0
  }

  # Get fish flags
  local fish_flags
  fish_flags=$(extract_fish_flags "$cmd" "$subcmd") || fish_flags=""

  compare_flags "$cmd" "$subcmd" "$cli_flags" "$fish_flags"
}

# --- Main validation ---

log_info "Starting completion validation..."
log_info "PA binary: $PA_BIN"
log_info "Completions file: $COMPLETIONS_FILE"
echo ""

# Top-level commands (those that have --help and are not nested subcommands)
TOP_LEVEL_CMDS=(
  "teams"
  "board"
  "deploy"
  "daily"
  "status"
  "schedule"
  "timers"
  "remove-timer"
  "idea"
  "report"
  "repos"
  "requirements"
  "serve"
  "ticket"
  "bulletin"
  "registry"
  "trash"
)

# Nested subcommands
declare -A NESTED_SUBCOMMANDS=(
  ["ticket"]="create update list show attach comment"
  ["bulletin"]="create list resolve"
  ["registry"]="complete"
  ["trash"]="move list show restore purge"
)

# Validate top-level commands
for cmd in "${TOP_LEVEL_CMDS[@]}"; do
  validate_command "$cmd"
done

# Validate nested subcommands
for cmd in "${!NESTED_SUBCOMMANDS[@]}"; do
  for subcmd in ${NESTED_SUBCOMMANDS[$cmd]}; do
    validate_command "$cmd" "$subcmd"
  done
done

# --- Report results ---
echo ""
if [[ $ERRORS -eq 0 ]]; then
  log_info "All completions validated successfully!"
  exit 0
else
  log_error "Completion drift detected!"
  echo ""

  if [[ ${#MISSING_FLAGS[@]} -gt 0 ]]; then
    log_error "Missing fish completions (flags in CLI but not in pa.fish):"
    for cmd in "${!MISSING_FLAGS[@]}"; do
      echo -e "  ${RED}$cmd:${NC} ${MISSING_FLAGS[$cmd]}"
    done
    echo ""
  fi

  if [[ ${#SPURIOUS_FLAGS[@]} -gt 0 ]]; then
    log_error "Spurious fish completions (flags in pa.fish but not in CLI):"
    for cmd in "${!SPURIOUS_FLAGS[@]}"; do
      echo -e "  ${RED}$cmd:${NC} ${SPURIOUS_FLAGS[$cmd]}"
    done
    echo ""
  fi

  log_error "Total: $ERRORS drift(s) found"
  exit 1
fi
