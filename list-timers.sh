#!/usr/bin/env bash
# List all personal-assistant scheduled timers
systemctl --user list-timers 'pa-*' --no-pager
