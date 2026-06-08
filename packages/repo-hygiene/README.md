# @batiste-aidk/repo-hygiene

Gate de higiene de repositório — **o padrão da casa como gate, não como memória.**
Nasceu do postmortem maju-1/astrus (2026-06-08): a doutrina (templatizável,
single-source, asset-canônico-primeiro) existia escrita mas nada **bloqueava** uma
sessão de vibe coding de terminar suja. Este check bloqueia.

## Uso
```bash
node hygiene.mjs [path] [--strict] [--warn-only] [--json]
```
- `path` — dir-alvo (default: cwd). Escaneia arquivos git-tracked sob ele.
- `--strict` — WARN também derruba (exit 1).
- `--warn-only` — nada derruba; só reporta.
- `--json` — saída estruturada (CI/Batiste).

Exit 1 = falha (use no fim da sessão / pre-commit / CI). Exit 0 = limpo.

## Os 4 checks
| Check | Nível | O que pega |
|---|---|---|
| `git-clean` | ERRO | dir não é repo git, ou tem mudança não-commitada (sem rede de segurança = faxina irreversível) |
| `no-duplicate` | WARN | arquivo idêntico por hash em >1 pasta (multi-source) |
| `drafts-scoped` | ERRO | rascunho/variante (`concepts/`, `_final_b`, `a.html`, `_v2`…) fora de `_scratch/` |
| `canonical` | WARN | asset declarado em `*.brand.yaml` que não existe no disco |

ERRO bloqueia (sem ambiguidade). WARN reporta pra julgamento humano (bundles de
upload auto-contidos podem duplicar de propósito).

## Config por repo — `.hygiene.json` na raiz
```json
{
  "allowDuplicateBasenames": ["favicon.svg", "og-image.png"],
  "draftPatterns": ["_wip\\b"],
  "ignore": ["node_modules/", "dist/"]
}
```

## Convenção `_scratch/`
Todo draft/variante/concept vive em `_scratch/` (gitignored). Graduou pra
canônico? Mover pra fora explicitamente. O gate falha se draft escapar disso.
