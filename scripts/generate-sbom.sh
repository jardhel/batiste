#!/usr/bin/env bash
# generate-sbom.sh — emite o SBOM SPDX do monorepo Batiste.
#
# Fonte: dependency graph do GitHub (API oficial), que devolve SPDX JSON sem
# baixar nem executar nenhum codigo de terceiros (sem npx, dlx, docker, syft,
# cdxgen). Requer `gh` autenticado (GH_TOKEN no CI) e o repo no GitHub.
#
# Invocado por .github/workflows/release.yml e reproduzivel localmente:
#   GITHUB_REPOSITORY=jardhel/batiste bash scripts/generate-sbom.sh
#
# Saidas (idempotente):
#   reports/sbom.spdx.json
#   reports/sbom.sha256
#
# O release.yml assina (cosign keyless) e atesta (attest-build-provenance)
# o arquivo. GDPR Art. 32, NIS2 Art. 21(2)(e), DORA Art. 28.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPORTS="$REPO_ROOT/reports"
mkdir -p "$REPORTS"

REPO="${GITHUB_REPOSITORY:-}"
if [ -z "$REPO" ]; then
  REPO="$(git -C "$REPO_ROOT" remote get-url origin 2>/dev/null | sed -E 's#(git@github.com:|https://github.com/)##; s#\.git$##' || true)"
fi
if [ -z "$REPO" ]; then
  echo "✖ defina GITHUB_REPOSITORY=owner/repo" >&2
  exit 1
fi

COMMIT="$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo 'unknown')"
echo "▶ sbom: ${REPO} commit=${COMMIT:0:12}"

gh api "repos/${REPO}/dependency-graph/sbom" --jq .sbom > "$REPORTS/sbom.spdx.json"

node -e '
const s = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
if (!s.spdxVersion || !(s.packages || []).length) { console.error("✖ SPDX invalido ou vazio"); process.exit(1); }
console.log("✔", s.spdxVersion, s.packages.length, "packages");
' "$REPORTS/sbom.spdx.json"

(
  cd "$REPORTS"
  if command -v sha256sum >/dev/null 2>&1; then sha256sum sbom.spdx.json > sbom.sha256
  else shasum -a 256 sbom.spdx.json > sbom.sha256; fi
)

echo "✔ sbom done"
ls -la "$REPORTS"/sbom.*
