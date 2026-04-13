---
name: signal-collect
description: >
  Signal Note to Self collector — extracts messages from Signal Desktop SQLCipher DB,
  classifies via MiniMax AI, creates PA tickets. Run manually or via 2-hour systemd timer.
pa-tier: 3
pa-inject-as: reference
---

# Signal Note to Self Collector

## Overview

Automated pipeline: Signal "Note to Self" messages → PA tickets.

```
Signal Desktop DB (SQLCipher)
        ↓
pa signal collect
        ↓
~/Documents/ai-usage/signal/raw/         # extracted messages
        ↓
MiniMax classification
        ↓
~/Documents/ai-usage/signal/classified/  # classified notes
        ↓
PA ticket creation
        ↓
~/Documents/ai-usage/signal/processed/  # done
```

Attachments are copied to `~/Documents/ai-usage/signal/attachments/` and referenced in tickets.

---

## Running the Collector

### Manual run

```bash
pa signal collect
```

Options:
- `--dry-run` — preview messages that would be extracted; no files written, no tickets created
- `--skip-classify` — extract raw notes but skip AI classification (for debugging extraction)

### Dry run (preview only)

```bash
pa signal collect --dry-run
```

---

## Scheduling (Every 2 Hours)

Set up a systemd user timer to run every 2 hours automatically:

```bash
pa schedule signal:collect every 2h
```

This creates:
- `~/.config/systemd/user/pa-signal-collect.service`
- `~/.config/systemd/user/pa-signal-collect.timer`

The timer uses `OnCalendar=*:0/2:00` (fires at 00:00, 02:00, 04:00, ... each day).

### Managing the timer

```bash
# Check status
systemctl --user status pa-signal-collect.timer

# List active timers
systemctl --user list-timers 'pa-signal-collect*'

# Remove timer
pa remove-timer signal-collect
```

---

## Folder Structure

```
~/Documents/ai-usage/signal/
  raw/          # Extracted but unclassified messages (YYYY-MM-DD-HH-MM-<hash>.md)
  classified/   # Notes with AI classification metadata (classified-<original>.md)
  processed/    # Successfully converted to tickets (original raw notes)
  attachments/  # Copied media files (YYYY-MM-DD-HH-MM-<filename>)
  state.json    # Incremental state (lastProcessedAt, totalProcessed)
```

---

## Classification Categories

| Signal Note Content | Category | PA Ticket Type | Priority |
|---------------------|----------|----------------|----------|
| Ideas, concepts, proposals | `idea` | `idea` | low |
| Action items, tasks to do | `task` | `task` | medium |
| Things to learn, study | `learning` | `idea` + `category:learning` tag | medium |
| Links, data, reference material | `data` | `task` + `category:data-processing` tag | medium |

All created tickets are assigned to `sinh` for review.

---

## Attachment Handling

When a Signal note includes an attachment (image, file, voice note):

1. Attachment is copied from `~/.config/Signal/attachments.noindex/<path>` to
   `~/Documents/ai-usage/signal/attachments/<timestamp>-<filename>`
2. Raw note frontmatter includes `attachmentsCopied: ["/path/to/file"]`
3. PA ticket summary includes an `## Attachments` section listing the paths

Missing source attachments (e.g., not yet synced) are skipped with a warning.

---

## State Tracking

State file: `~/Documents/ai-usage/signal/state.json`

```json
{
  "lastProcessedAt": 1713000000000,
  "lastRunAt": "2026-04-13T10:00:00.000Z",
  "totalProcessed": 42
}
```

- `lastProcessedAt`: Unix timestamp (ms) of the most recent processed message
- `lastRunAt`: ISO datetime of the last collection run
- `totalProcessed`: Cumulative message count across all runs

Running twice is safe — messages are deduplicated by timestamp.

---

## Prerequisites

- Signal Desktop installed and synced (`~/.config/Signal/sql/db.sqlite` exists)
- `sqlcipher` available in PATH (added to PA's `runtimePath` via `flake.nix`)
- MiniMax API key configured (`ANTHROPIC_AUTH_TOKEN` env var set by `pa deploy --provider minimax`)
- Signal DB key accessible at `~/.config/Signal/config.json`

---

## Troubleshooting

### "Signal config not found"
Signal Desktop is not installed or the config path is non-standard.

### "Could not find Note to Self conversation"
Signal Desktop may not be synced yet. Send at least one Note to Self message and re-sync.

### "ANTHROPIC_AUTH_TOKEN not set"
Classification requires MiniMax API access. Ensure the env var is set before running.

### DB locked / busy timeout
Signal Desktop may be active. The collector retries for up to 5 seconds (`PRAGMA busy_timeout=5000`).
If it still fails, wait for Signal Desktop to finish its write and retry.

### Attachments not copied
Source paths are derived from the Signal DB. If Signal Desktop hasn't fully synced the attachment,
the file won't exist yet. The note is still extracted; the attachment can be recovered from Signal manually.
