#!/usr/bin/env bash
# Shared config loader for personal-assistant scripts
#
# Hardcoded config path: ~/.config/sinh-x/personal-assistant/config.yaml
#
# Source this AFTER setting SCRIPT_DIR and PA_HOME defaults.
# Sets PA_CONFIG, PA_DATA from the config file.

PA_USER_CONFIG="${HOME}/.config/sinh-x/personal-assistant/config.yaml"

if [[ -f "$PA_USER_CONFIG" ]]; then
    _pa_cfg_val() {
        grep "^${1}:" "$PA_USER_CONFIG" 2>/dev/null | sed "s/^${1}:[[:space:]]*//" | sed 's/^"//' | sed 's/"$//' | sed "s|^~|$HOME|"
    }

    PA_CONFIG="$(_pa_cfg_val config_dir)"
    _data="$(_pa_cfg_val data_dir)"
    [[ -n "$_data" ]] && PA_DATA="$_data"
    unset _data
fi
