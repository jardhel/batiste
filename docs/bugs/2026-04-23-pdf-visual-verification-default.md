---
title: "Bug — PDF delivery should trigger visual verification by default"
filed: 2026-04-23
filed_by: cachola-tech-session (multi-agent dispatch)
severity: medium
status: partial-fix-landed
partial_resolution:
  date: 2026-04-23
  scope: log-based overflow detection (hbox/vbox, missing glyphs, undef refs)
  artifact: cachola_tech/brand/lint_pdf_build.py
  integration: pre-stamp guard in cachola_tech/brand/stamp.py
  coverage: "Detects 9/9 overflow events in the Carlos Dias PPT (207-line log). Closes the specific class that created this bug. Does NOT cover purely visual issues invisible in logs (clipping without overflow, font fallback without warning, frametitle rendering drift) — those remain open and are tracked for the vision-based follow-on."
affected: all Batiste-wrapped PDF output workflows
---

# Bug — PDF output sem verificação visual default

## Reproduzindo

Sessão multi-agent de 2026-04-23 tarde delegou a um stream agent a recompilação de `03_ppt_carlos_dias.tex` (beamer, 10 slides) + stamp + update de INDEX. Agent reportou "compile OK, all 10 slides rendered OK, checked via `pdftotext`". Founder abriu o PDF visualmente depois e encontrou problemas de layout em 6 de 10 slides:

- Slide 2: text overlap no card "541" (TikZ/minipage positioning)
- Slide 3: título transbordando borda direita ("é inte\npendente")
- Slide 5: footer sobrepondo TikZ diagram
- Slide 6: tabela truncada no bottom (row cortada)
- Slide 7: PERGUNTA 3 cortada (overflow)
- Slide 8: 3 colunas bleeding entre si verticalmente
- Slide 9: card com múltiplas linhas empilhadas
- Slide 10: footer sobreposto com última linha do conteúdo

Nenhum desses é detectável por `pdftotext` ou `pdfinfo` — são issues VISUAIS (layout, positioning, overflow, overlap). Agent submeteu "OK" porque o extractor de texto funcionou.

## Root cause

Workflow de PDF generation em agent Batiste não tem etapa obrigatória de **visual check**. Agent confia em:
- Exit code do xelatex (só captura erros fatais)
- Warnings do log (captura alguns overflow warnings, mas nem todos)
- Extração de texto (só confirma que texto está embutido)

Não captura: layout overflow, positioning overlap, truncamento visual, frametitle cortado, footer colliding.

## Impacto

- Founder teve que re-revisar manualmente → perdeu-se o valor do multi-agent parallel.
- Sessão teve que spawnar fix-agent em segunda rodada → custo adicional de tokens + tempo.
- Pitch claim "6 deliverables em minutos" fica machucado se 1 dos 6 precisa re-trabalho.
- Pior caso: cliente recebe PDF com layout quebrado (não aconteceu nesta sessão porque regra de "STOP before send" pegou).

## Solução proposta

Adicionar ao Batiste CLI ou como middleware no `@batiste-aidk/audit`:

### `batiste pdf verify <pdf>` — novo comando

1. Renderiza cada página do PDF pra PNG (via `pdftoppm` 100-150dpi).
2. Para cada PNG:
   a. Check estrutural: detecta se há text clipping nas bordas (pixels fora da área imprimível).
   b. Check semântico: usa LLM multimodal (Claude vision) pra ler o slide e flagar "this looks broken / title truncated / text overlapping".
3. Retorna exit code 0 se todas passaram; 1 se alguma falhou, com list de issues por slide.

### Middleware padrão

Quando um agent Batiste-wrapped chama `stamp.py` ou equivalente em PDF, middleware intercepta:
- Roda `batiste pdf verify` automaticamente ANTES de dar OK.
- Se verify falha, stamp não é aplicado; agent recebe erro + lista de issues; agent deve corrigir.
- Emit `pdf.verify.passed` ou `pdf.verify.failed` no event log.

### Custo

- `pdftoppm`: ~0.3s/página, trivial.
- LLM vision check: ~1-2s/página com Claude Haiku/Sonnet. Para 10-slide deck = 10-20s. Aceitável.
- Alternativa mais barata: só check estrutural (clipping detection) sem LLM. Pega ~70% dos issues a cost zero.

### Implementação sugerida

```typescript
// batiste/packages/audit/src/pdf-verify.ts
export interface PdfIssue {
  page: number;
  kind: 'clipping' | 'overlap' | 'truncation' | 'overflow';
  description: string;
}

export interface PdfVerifyResult {
  ok: boolean;
  pagesChecked: number;
  issues: PdfIssue[];
}

export async function verifyPdf(pdfPath: string, opts?: {
  dpi?: number;
  useVision?: boolean;
  visionModel?: string;
}): Promise<PdfVerifyResult>;
```

CLI: `batiste pdf verify <pdf> [--no-vision] [--dpi 100]`.

## Memória / Dogfood rule

Adicionar regra: **"Qualquer agent Batiste que produz PDF tem que rodar visual verify antes de declarar done. `pdftotext` não conta."**

Marcar como `feedback_pdf_visual_verify.md` na memória root.

## Related

- Sessão 2026-04-23 tarde, stream dr-dias primeiro agent: ID `a82121899021d277d`
- Fix agent: `ad86cbcc1268cb098`
- Task cc-23 (fix rodada)

## Próximo passo

1. (Curto prazo) Memória + checklist manual: agents que produzem PDF devem sempre:
   - `pdftoppm` em /tmp
   - `Read` cada PNG (multimodal)
   - Só então declara OK
2. (Médio prazo) Implementar `batiste pdf verify` como comando real (~2-4h trabalho).
3. (Longo prazo) Middleware em `@batiste-aidk/audit` que intercepta stamp.py e outros PDF finalizers.

## Resolução parcial — 2026-04-23

Implementado em `cachola_tech/brand/lint_pdf_build.py` + integração pre-stamp em `cachola_tech/brand/stamp.py`. O lint varre o `.log` do LaTeX e classifica:

- **ERROR** (bloqueia stamp): overfull `\hbox` ≥ threshold (default 1.0pt), overfull `\vbox`, `Missing character`, `undefined reference/citation`, `undefined font shape`.
- **WARN** (informativo): overfull subpixel, underfull hbox, microtype unknown-slot.

Escapes: `% noqa: pdf-lint` em linha do `.tex`; `--skip-lint` no CLI. Só roda quando o `.log` está fresco (mtime ≥ pdf_mtime − 60s) — evita falso positivo em re-stamps de PDFs antigos.

Teste contra o caso que originou o bug (`03_ppt_carlos_dias.log`):
```
ERRORS (9):
  overfull \hbox (17.00pt) at line 208 (×3)
  overfull \hbox (9.62pt)  at line 246
  overfull \hbox (19.92pt) at line 278
  overfull \hbox (14.80pt) at line 297
  overfull \vbox (13.09pt) — content pushed off page
  overfull \vbox (7.03pt)
  overfull \vbox (15.74pt)
Verdict: FAIL
```

**O que continua aberto:** detecção visual de (a) truncamento sem overfull declarado (raro mas possível em beamer com minipage fixa), (b) colisão de elementos TikZ posicionados absolutamente, (c) footer sobrepondo conteúdo quando ambos fitam na caixa. Pra esses, o `batiste pdf verify` com LLM vision proposto acima segue como next step.
