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
            for script in deploy.sh daily.sh schedule.sh status.sh list-timers.sh remove-timer.sh; do
              install -Dm755 "$script" "$libexec/$script"
            done

            # --- Create wrapped binaries ---
            mkdir -p $out/bin

            for pair in \
              "deploy.sh:pa-deploy" \
              "daily.sh:pa-daily" \
              "schedule.sh:pa-schedule" \
              "status.sh:pa-status" \
              "list-timers.sh:pa-timers" \
              "remove-timer.sh:pa-remove-timer" \
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
  echo "  schedule      Schedule a team with systemd timers"
  echo "  status        Show deployment status"
  echo "  timers        List scheduled timers"
  echo "  remove-timer  Remove a scheduled timer"
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
  schedule)     exec "$self_dir/pa-schedule" "$@" ;;
  status)       exec "$self_dir/pa-status" "$@" ;;
  timers)       exec "$self_dir/pa-timers" "$@" ;;
  remove-timer) exec "$self_dir/pa-remove-timer" "$@" ;;
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
            ];
          };
        });
    };
}
