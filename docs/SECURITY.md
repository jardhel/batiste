# Security automation (como o repositorio se defende)

Politica de reporte e SLA: ver [`../SECURITY.md`](../SECURITY.md).

## Camadas

| Camada | Onde | Quando | Falha o build? |
|---|---|---|---|
| `pnpm audit --prod --audit-level=high` | `.github/workflows/ci.yml` (job `dependency-audit`) | push e PR | sim |
| Dependency review (severidade >= high, licencas proibidas) | `dependency-review.yml` | PR | sim |
| OSV-Scanner sobre `pnpm-lock.yaml` | `osv-scanner.yml` | diario 03:23 UTC, PR que toca o lockfile | sim |
| CodeQL (`javascript-typescript`, `security-extended`) | `codeql.yml` | push, PR, semanal | alertas no Code Scanning |
| OpenSSF Scorecard | `scorecard.yml` | semanal, push na main | alertas no Code Scanning |
| Gate de licencas | job `license-gate` + `scripts/generate-license-report.mjs` | push e PR | sim |
| Dependabot (alertas, security updates, version updates) | configuracao do repo + `.github/dependabot.yml` | continuo / semanal | PRs |
| Secret scanning + push protection | configuracao do repo | cada push | bloqueia o push |

## Regras de CI

- Toda GitHub Action fica fixada por SHA de commit de 40 hex, com comentario `# vX.Y.Z`. Dependabot (`github-actions`) atualiza SHA e comentario juntos.
- `permissions: contents: read` no topo de cada workflow; escopos extras so no job que precisa.
- `actions/checkout` com `persist-credentials: false`; nenhum uso de `pull_request_target`.
- Dependabot usa `cooldown` (3 dias; 7 para major) para nao adotar versao recem-publicada. Atualizacoes de seguranca ignoram o cooldown.

## Release e SBOM

`release.yml` gera: SBOM CycloneDX (`scripts/generate-sbom.sh`), SBOM SPDX 2.3 (API nativa de dependency graph do GitHub, sem instalar ferramenta), assinatura keyless com cosign e atestado de proveniencia.

## Pendencias conhecidas

- `scripts/generate-sbom.sh` ainda chama `npx --yes @cyclonedx/cdxgen@latest` (versao nao fixada) e, na ausencia de `syft`, `docker run anchore/syft:latest` (imagem nao fixada). Fixar versao/digest e decisao de quem mantem `scripts/`.
