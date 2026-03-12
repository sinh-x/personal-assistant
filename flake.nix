{
  description = "personal-assistant — CLI agent team orchestrator for NixOS";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      supportedSystems = [ "x86_64-linux" "aarch64-linux" ];
      forAllSystems = nixpkgs.lib.genAttrs supportedSystems;

      pkgsFor = system: nixpkgs.legacyPackages.${system};

      personalAssistantFor = system:
        let
          pkgs = pkgsFor system;
          runtimePath = pkgs.lib.makeBinPath (with pkgs; [
            bash
            coreutils
            gnused
            gnugrep
            util-linux    # flock
            systemd
            git
            unixtools.xxd
          ]);
        in
        pkgs.stdenv.mkDerivation {
          pname = "personal-assistant";
          version = "0.1.0";

          src = ./.;

          nativeBuildInputs = [ pkgs.makeWrapper ];

          dontBuild = true;

          installPhase = ''
            runHook preInstall

            # --- Install read-only data ---
            share=$out/share/personal-assistant
            mkdir -p $share
            cp -r teams skills $share/
            for f in IDENTITY.md JOURNAL.md README.md; do
              [ -f "$f" ] && cp "$f" $share/
            done

            # --- Install scripts to libexec ---
            libexec=$out/libexec/personal-assistant
            mkdir -p $libexec
            for script in deploy.sh daily.sh schedule.sh status.sh list-timers.sh remove-timer.sh idea.sh pa-config.sh; do
              install -Dm755 "$script" "$libexec/$script"
            done
            # Also install pa-config.sh to share/ so scripts can find it via PA_HOME
            install -Dm644 pa-config.sh "$share/pa-config.sh"

            # --- Create wrapped binaries ---
            mkdir -p $out/bin

            for pair in \
              "deploy.sh:pa-deploy" \
              "daily.sh:pa-daily" \
              "schedule.sh:pa-schedule" \
              "status.sh:pa-status" \
              "list-timers.sh:pa-timers" \
              "remove-timer.sh:pa-remove-timer" \
              "idea.sh:pa-idea" \
            ; do
              src_script="''${pair%%:*}"
              bin_name="''${pair##*:}"
              makeWrapper "$libexec/$src_script" "$out/bin/$bin_name" \
                --set PA_HOME "$share" \
                --set PA_BIN "$out/bin" \
                --run 'export PA_DATA="''${PA_DATA:-$HOME/.local/share/personal-assistant}"' \
                --run 'mkdir -p "$PA_DATA/primers" "$PA_DATA/logs"' \
                --prefix PATH : "${runtimePath}"
            done

            # --- pa dispatcher ---
            cat > $out/bin/pa <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

self_dir="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"

usage() {
  echo "Usage: pa <command> [args...]"
  echo ""
  echo "Commands:"
  echo "  deploy        Deploy an agent team"
  echo "  daily         Daily lifecycle (plan|progress|end)"
  echo "  teams         List available teams"
  echo "  schedule      Schedule a team with systemd timers"
  echo "  status        Show deployment status"
  echo "  timers        List scheduled timers"
  echo "  remove-timer  Remove a scheduled timer"
  echo "  idea          Log an idea interactively"
  echo ""
  echo "Run 'pa <command> --help' for command-specific help."
}

cmd="''${1:-}"
if [[ -z "$cmd" ]]; then
  usage
  exit 1
fi
shift

case "$cmd" in
  deploy)       exec "$self_dir/pa-deploy" "$@" ;;
  daily)        exec "$self_dir/pa-daily" "$@" ;;
  teams)
    pa_home="''${PA_HOME:-}"
    # Load config file for PA_CONFIG
    _cfg="$HOME/.config/sinh-x/personal-assistant/config.yaml"
    pa_config=""
    if [[ -f "$_cfg" ]]; then
      pa_config="$(grep '^config_dir:' "$_cfg" 2>/dev/null | sed 's/^config_dir:[[:space:]]*//' | sed 's/^"//' | sed 's/"$//' | sed "s|^~|$HOME|")"
    fi
    base_dir="''${pa_home:+$pa_home/teams}"
    base_dir="''${base_dir:-$(dirname "$(readlink -f "$0")")/../share/personal-assistant/teams}"
    config_dir="''${pa_config:+$pa_config/teams}"
    declare -A seen
    for tdir in ''${config_dir:+"$config_dir"} "$base_dir"; do
      [[ -d "$tdir" ]] || continue
      for f in "$tdir"/*.yaml; do
        [[ -f "$f" ]] || continue
        name="$(basename "$f" .yaml)"
        [[ -n "''${seen[$name]:-}" ]] && continue
        seen["$name"]=1
        desc="$(grep '^description:' "$f" | sed 's/^description:[[:space:]]*//' | head -1)"
        src=""
        [[ "$tdir" == "$config_dir" ]] && src=" [user]"
        printf "  %-20s %s%s\n" "$name" "$desc" "$src"
      done
    done
    ;;
  schedule)     exec "$self_dir/pa-schedule" "$@" ;;
  status)       exec "$self_dir/pa-status" "$@" ;;
  timers)       exec "$self_dir/pa-timers" "$@" ;;
  remove-timer) exec "$self_dir/pa-remove-timer" "$@" ;;
  idea)         exec "$self_dir/pa-idea" "$@" ;;
  help|--help|-h) usage ;;
  *)
    echo "Error: Unknown command '$cmd'" >&2
    usage >&2
    exit 1
    ;;
esac
EOF
            chmod +x $out/bin/pa

            runHook postInstall
          '';

          meta = with pkgs.lib; {
            description = "CLI agent team orchestrator for NixOS";
            license = licenses.mit;
            platforms = platforms.linux;
            mainProgram = "pa";
          };
        };
    in
    {
      packages = forAllSystems (system: {
        personal-assistant = personalAssistantFor system;
        default = personalAssistantFor system;
      });

      overlays.default = final: prev: {
        personal-assistant = self.packages.${prev.system}.personal-assistant;
      };

      devShells = forAllSystems (system:
        let pkgs = pkgsFor system;
        in {
          default = pkgs.mkShell {
            packages = with pkgs; [
              bash
              coreutils
              gnused
              gnugrep
              util-linux
              systemd
              git
              unixtools.xxd
              # TypeScript migration
              nodejs_22
              pnpm
            ];
          };
        });
    };
}
