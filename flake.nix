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
            util-linux    # flock
            systemd
            git
            sqlcipher     # Signal Desktop DB access (read-only)
          ]);
        in
        pkgs.stdenv.mkDerivation (finalAttrs: {
          pname = "personal-assistant";
          version = (builtins.fromJSON (builtins.readFile ./package.json)).version;

          src = pkgs.lib.cleanSourceWith {
            src = ./.;
            filter = path: _type:
              let baseName = builtins.baseNameOf path;
              in !(builtins.elem baseName [ "node_modules" "dist" ".git" ]);
          };

          nativeBuildInputs = with pkgs; [
            nodejs_22
            pnpm
            pnpmConfigHook
            makeWrapper
            python3
            pkg-config
            sqlite.dev
            node-gyp
          ];

          buildInputs = with pkgs; [
            sqlite.out
          ];

          pnpmDeps = pkgs.fetchPnpmDeps {
            inherit (finalAttrs) pname src;
            hash = "sha256-4j9ObgBvn3nxLFzCjQAMLvbClzgqiSUh7agOgTMyrFQ=";
            fetcherVersion = 3;
          };

          buildPhase = ''
            runHook preBuild
            pnpm build
            runHook postBuild
          '';

          installPhase = ''
            runHook preInstall

            # --- Install read-only data ---
            share=$out/share/personal-assistant
            mkdir -p $share
            cp -r teams skills $share/
            # Runtime scripts (extract-session-content.sh etc.) — exclude dev/
            mkdir -p $share/scripts
            cp scripts/*.sh $share/scripts/
            for f in IDENTITY.md JOURNAL.md README.md; do
              [ -f "$f" ] && cp "$f" $share/
            done

            # --- Install TypeScript CLI + node_modules ---
            mkdir -p $out/bin
            cp dist/cli.mjs $share/cli.mjs
            cp package.json $share/package.json
            cp -r node_modules $share/node_modules

            makeWrapper ${pkgs.nodejs_22}/bin/node $out/bin/pa \
              --add-flags "$share/cli.mjs" \
              --set PA_HOME "$share" \
              --run 'export PA_DATA="''${PA_DATA:-$HOME/.local/share/personal-assistant}"' \
              --run 'mkdir -p "$PA_DATA/primers" "$PA_DATA/logs"' \
              --prefix PATH : "${runtimePath}"

            # --- Install fish completions ---
            mkdir -p $out/share/fish/vendor_completions.d
            cp completions/pa.fish $out/share/fish/vendor_completions.d/pa.fish

            # --- Rebuild better-sqlite3 native addon using local node headers ---
            cd $out/share/personal-assistant/node_modules/better-sqlite3
            patchShebangs .
            export npm_config_nodedir=${pkgs.nodejs_22}
            ${pkgs.nodejs_22}/bin/node ${pkgs.nodejs_22}/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js rebuild --nodedir=${pkgs.nodejs_22} --openssl-fips=false

            runHook postInstall
          '';

          dontStrip = true;

          meta = with pkgs.lib; {
            description = "CLI agent team orchestrator for NixOS";
            license = licenses.mit;
            platforms = platforms.linux;
            mainProgram = "pa";
          };
        });
    in
    {
      packages = forAllSystems (system: {
        personal-assistant = personalAssistantFor system;
        default = personalAssistantFor system;
      });

      overlays.default = final: prev: {
        personal-assistant = self.packages.${prev.stdenv.hostPlatform.system}.personal-assistant;
      };

      devShells = forAllSystems (system:
        let
          pkgs = pkgsFor system;
          dev-pa = pkgs.writeShellScriptBin "dev-pa" ''
            set -euo pipefail
            PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo "$PWD")"
            cd "$PROJECT_ROOT"
            pnpm build
            exec node "$PROJECT_ROOT/dist/cli.mjs" "$@"
          '';
          dev-pa-serve = pkgs.writeShellScriptBin "dev-pa-serve" ''
            set -euo pipefail
            PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo "$PWD")"
            cd "$PROJECT_ROOT"
            pnpm build

            DTACH_SOCKET="/tmp/pa-serve.dtach"

            case "''${1:-}" in
              stop|status)
                exec node "$PROJECT_ROOT/dist/cli.mjs" serve "$@"
                ;;
              restart)
                node "$PROJECT_ROOT/dist/cli.mjs" serve stop 2>/dev/null || true
                sleep 1
                ${pkgs.dtach}/bin/dtach -n "$DTACH_SOCKET" node "$PROJECT_ROOT/dist/cli.mjs" serve --port 9848 --cors
                echo "[dev-pa-serve] Restarted in background. Attach: dtach -a $DTACH_SOCKET"
                ;;
              *)
                ${pkgs.dtach}/bin/dtach -n "$DTACH_SOCKET" node "$PROJECT_ROOT/dist/cli.mjs" serve --port 9848 --cors "$@"
                echo "[dev-pa-serve] Started in background. Attach: dtach -a $DTACH_SOCKET"
                ;;
            esac
          '';
        in {
          default = pkgs.mkShell {
            packages = with pkgs; [
              bash
              coreutils
              util-linux
              systemd
              dtach
              git
              git-cliff
              # TypeScript
              nodejs_22
              pnpm
              # Signal Desktop DB access
              sqlcipher
              # Dev wrappers
              dev-pa
              dev-pa-serve
            ];
          };
        });

      # Systemd user service for pa serve
      # Install with: install -Dm644 <(nix build .#pa-serve-unit --print-out-paths) ~/.config/systemd/user/pa-serve.service
      # Or reference from home-manager: systemd.user.services.pa-serve = import (inputs.pa + "/service.nix") { inherit pkgs; };
      nixosModules = {
        pa-serve = { config, lib, pkgs, ... }: {
          options.services.pa-serve = {
            enable = lib.mkEnableOption "personal-assistant serve daemon";
            port = lib.mkOption {
              type = lib.types.port;
              default = 9848;
              description = "Port for pa serve to listen on";
            };
          };
          config = lib.mkIf config.services.pa-serve.enable {
            systemd.user.services.pa-serve = {
              Unit = {
                Description = "personal-assistant agent API server";
                After = [ "network.target" ];
              };
              Service = {
                Type = "simple";
                ExecStart = "${self.packages.${pkgs.stdenv.hostPlatform.system}.personal-assistant}/bin/pa serve --port ${toString config.services.pa-serve.port}";
                Restart = "on-failure";
                RestartSec = 5;
                Environment = [ "PA_DATA=%h/.local/share/personal-assistant" ];
              };
              Install = {
                WantedBy = [ "default.target" ];
              };
            };
          };
        };
      };

      # Standalone systemd user service unit file (for manual installation)
      paServeUnit = forAllSystems (system:
        let pkgs = pkgsFor system; in
        pkgs.writeText "pa-serve.service" ''
          [Unit]
          Description=personal-assistant agent API server
          After=network.target

          [Service]
          Type=simple
          ExecStart=${self.packages.${system}.personal-assistant}/bin/pa serve --port 9848
          Restart=on-failure
          RestartSec=5
          Environment=PA_DATA=%h/.local/share/personal-assistant

          [Install]
          WantedBy=default.target
        '');
    };
}
