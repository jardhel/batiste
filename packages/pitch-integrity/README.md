# @batiste-aidk/pitch-integrity

Gate de integridade de **pitch/demo** — fecha a porta pro teatro, pra não voltar.

Doutrina da casa: **integridade comercial é inegociável.** Um demo bonito que
vende maturidade inexistente (números sorteados, `result: 'success'` fixo, sleep
"simulate real work", alvo de arquivo que não existe, claim "production-ready"
sem prova) queima a confiança no produto — e o produto **é** a disciplina.
Doutrina escrita não impede entropia; só **gate** impede. Este é o gate.

A regra: um demo só "passa" se as tarefas tocam **arquivos reais** e os números
são **medidos/computados** — nunca de um gerador aleatório ou multiplicador fixo.

## Uso
```bash
node pitch-integrity.mjs [path] [--warn-only] [--json]
```
- `path` — dir-alvo (default: cwd). Escaneia artefatos de pitch/demo git-tracked
  sob ele: `examples/`, `demos/`, e docs marcados (`docs/*demo|pitch|investor|deck*`).
- `--warn-only` — nada derruba (exit 0); só reporta.
- `--json` — saída estruturada (CI/Batiste).

Exit 1 = teatro detectado. Exit 0 = limpo.

**Opt-in / CI** — de propósito **não** está wired no pre-commit que bloqueie
(não trava commit do dia-a-dia). Rode no fim da sessão de demo ou no CI antes de
mostrar pra investidor.

## O que pega
| Check | O que acende |
|---|---|
| `theater-success` | `result: 'success'` (ou `ok`/`pass`) literal constante — resultado tem que ser computado do trabalho |
| `fake-work-sleep` | `sleep`/`setTimeout`/`delay` com comentário "simulate … work/real" — demo deve EXECUTAR, não dormir fingindo |
| `random-metric` | latência/duração/p95/p99/score vindo de `Math.random()`/`jitter()` — número de pitch é medido, não sorteado |
| `multiplier-metric` | p95/p99/latência por multiplicador fixo (ex. `latencyMs * 1.4`) — percentil sai da distribuição medida |
| `production-ready` | claim "production-ready"/"enterprise-grade"/"battle-tested" sem proveniência (link/teste/commit/medição) ao lado |
| `ghost-target` | demo afirma processar `foo.csv`/`bar.pdf`/`x.ts` que **não existe** no repo — usar fixture real e versionado |

Todo hit é **ERRO** (bloqueia). A correção é tornar **honesto** o que o
investidor vê: medir o que se afirma, processar arquivo que existe, ou marcar o
claim como "no roadmap (target: data)".

## Por que existe
O `examples/investor-demo` foi escrito com latências `jitter(38,18)` (random),
p95/p99 por `× 1.4`/`× 1.9`, `await sleep(latency + 20); // simulate real work`,
`result: 'success'` fixo, "Batiste is production-ready" e seis arquivos-alvo
(`src/auth/middleware.ts`, `NDA.pdf`, `customer_data.csv`, …) que não existem.
Este gate **pega** esse estado — prova que não é vacuamente verde — e fica verde
quando o demo passa a tocar arquivos reais com números medidos.

## Teste
```bash
node --test packages/pitch-integrity/
```
Heurísticas (`scanSource`, `extractTargets`, `isPitchArtifact`) são puras e
testadas sem rede nem filesystem; inclui caso de regressão do bloco teatral e um
caso de demo honesto que passa limpo.
