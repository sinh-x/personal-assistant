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
          ]);
        in
        pkgs.stdenv.mkDerivation (finalAttrs: {
          pname = "personal-assistant";
          version = "0.1.0";

          src = ./.;

          nativeBuildInputs = with pkgs; [
            nodejs_22
            pnpm
            pnpmConfigHook
            makeWrapper
          ];

          pnpmDeps = pkgs.fetchPnpmDeps {
            inherit (finalAttrs) pname src;
            hash = "sha256-HNVDr+78qUbSCm6w2gAFoGaQdJxV9sTbvYCD5k86IrM=";
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

            runHook postInstall
          '';

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
        personal-assistant = self.packages.${prev.system}.personal-assistant;
      };

      devShells = forAllSystems (system:
        let
          pkgs = pkgsFor system;
          dev-pa = pkgs.writeShellScriptBin "dev-pa" ''
            set -euo pipefail
            PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo "$PWD")"
            RESULT="$PROJECT_ROOT/result"
            if [ ! -x "$RESULT/bin/pa" ]; then
              echo "No result/bin/pa found. Run: nix build" >&2
              exit 1
            fi
            exec "$RESULT/bin/pa" "$@"
          '';
        in {
          default = pkgs.mkShell {
            packages = with pkgs; [
              bash
              coreutils
              util-linux
              systemd
              git
              # TypeScript
              nodejs_22
              pnpm
              # Dev wrapper
              dev-pa
            ];
          };
        });
    };
}
