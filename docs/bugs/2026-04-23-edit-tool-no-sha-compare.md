---
title: "Bug — Edit tool has no SHA comparison, fails silently on Unicode mismatch / concurrent edits"
filed: 2026-04-23
filed_by: cachola-tech-session (multi-agent dispatch)
severity: medium
status: open
affected: all agent workflows that use Claude Code Edit tool on files the user (or LSP/linter) is concurrently editing
related: 2026-04-23-pdf-visual-verification-default.md (same family — tool reports OK on wrong verification)
---

# Bug — Edit tool sem comparação de SHA, falha silenciosa em mismatch Unicode ou edição concorrente

## Reproduzindo

Sessão 2026-04-23 noite. Agent faz `Read` de `releases/2026-04-23-effect-v1/01_email_effect_outreach.md` (arquivo no vault Obsidian do usuário). Usuário edita o mesmo arquivo no Obsidian em paralelo — Obsidian ou plugin de \emph{smart typography} insere **non-breaking space (U+00A0, bytes `c2 a0`)** entre "I built" e `**Cachola Tech**` (padrão: NBSP antes de marcador `**bold**`).

Agent chama Edit com `old_string` contendo espaço regular (U+0020) na mesma posição. Edit tool compara byte-a-byte, não casa, retorna `String to replace not found` — **sem sinalizar que o arquivo mudou desde o Read**. Retry do agent com mesma string falha do mesmo jeito. Agent precisa pular pra `python3 f.read() + str.replace()` em banda para descobrir (via `line.encode('utf-8').hex()`) que o byte do espaço mutou.

Fundador observou: *"isso eh dogfooding na veia meu chapa"* --- apontando que o \emph{failure mode} é exatamente o que Batiste/GVS foi desenhado pra impedir: mutação não-observada de artefato entre operações.

## Root cause

Claude Code native Edit tool:

- Faz `old_string in file_content` literal byte-a-byte.
- **Não calcula SHA-256 do arquivo no Read.**
- **Não compara SHA do Read com SHA no momento do Edit.**
- Não diferencia "string não existe" de "arquivo mudou concorrentemente".
- Não emite evento de concorrência detectada.

Tool funciona como se o arquivo fosse imutável entre operações. Em vaults reais (Obsidian com plugins de formatação, LSP com format-on-save, editor humano paralelo, pre-commit hooks), o arquivo não é. O resultado é ou retry cego ou bypass manual, ambos sem rastro.

Contraste com `brand/stamp.py` da Cachola Tech (ref GVS 0.1 §9): essa sim carimba SHA-256 antes e depois do XMP-inject, guarda ambos no manifest + ledger, e rolls-back as três \emph{atomic writes} se qualquer uma falha. **Disciplina oposta**.

## Impacto

- Agent não sabe que falhou por concorrência, pode repetir ação e ficar em \emph{loop}.
- Fundador vê \emph{errors} aparentemente idênticos retornando, não sabe se é problema do agent ou do arquivo.
- Tempo perdido em diagnóstico manual (hex dump, byte comparison) que o tool podia fazer automaticamente.
- Pior: em fluxos onde o agent tenta \emph{bypass} (ex: re-read + re-edit), pode escrever por cima de mudanças recentes do usuário sem saber — corrupção silenciosa.

## Solução proposta

Wrap do Edit tool em middleware `@batiste-aidk/audit` com disciplina GVS:

### 1. Primeira chamada — captura

No primeiro Read em uma sessão, middleware registra:
```
{ event: "file.read", path, sha_at_read: "<sha256>", ts: <iso>, agent_id: <id> }
```

### 2. Edit — gate de concorrência

Antes de aplicar `old_string → new_string`:
```
current_sha = sha256(file)
if current_sha != sha_at_read:
    emit { event: "edit.concurrent_modification_detected",
           expected_sha: sha_at_read, actual_sha: current_sha }
    reject Edit with REASON="file changed since last Read; re-read and retry"
    return ERROR to agent
```

Agent aprende a "re-Read antes de Edit quando este erro aparecer".

### 3. Edit aplicado — nova baseline

Se a edição aplica, middleware atualiza `sha_at_read = sha256(file_after_write)` pro próximo Edit na mesma sessão.

### 4. Escape hatch explícito

Um flag `--force-byte-exact-no-sha-check` pro raro caso onde o agent está ciente de edição concorrente e quer aplicar mesmo assim. Mas é explícito — não silencioso.

### 5. Observabilidade

O evento `edit.concurrent_modification_detected` entra no \emph{event log} do Batiste audit. Sessões posteriores podem ver padrão de arquivos frequentemente mutados concorrentemente (candidatos a flag "high-concurrency zone").

## Implementação sugerida

Em `packages/code/src/validation/`, ao lado do `ESLintValidator.ts`, adicionar:

```typescript
// packages/code/src/validation/EditConcurrencyGuard.ts
export interface ReadRecord {
  path: string;
  shaAtRead: string;
  ts: string;
  agentId: string;
}

export interface ConcurrencyCheckResult {
  ok: boolean;
  expectedSha?: string;
  actualSha?: string;
  reason?: string;
}

export class EditConcurrencyGuard {
  private readSnapshots = new Map<string, ReadRecord>();

  recordRead(path: string, content: string, agentId: string): void { ... }
  checkBeforeEdit(path: string): ConcurrencyCheckResult { ... }
  updateAfterEdit(path: string, newContent: string): void { ... }
}
```

Integrar no \emph{wrapper} que o Batiste aplica em torno da Claude Code Edit tool (analogamente ao ESLintValidator em workflows TS).

## Related

- `2026-04-23-pdf-visual-verification-default.md` --- mesma família de bug (\emph{tool reports OK on wrong verification}). Ambos apontam pra disciplina que Batiste/GVS carrega mas ferramentas upstream não.
- Memória de origem do diagnóstico: `cachola-tech/memory/feedback_edit_tool_nbsp_gotcha.md`.

## Próximo passo

1. (Curto prazo) Memória operacional: agents que usam Edit em vault Obsidian devem trocar pra Python `str.replace` em banda se Edit falhar com \emph{"String to replace not found"} — esse padrão já está em `feedback_edit_tool_nbsp_gotcha.md`.
2. (Médio prazo) Implementar `EditConcurrencyGuard` no `@batiste-aidk/code` e plugar como \emph{middleware} padrão do Edit wrapper. ~4-6h de trabalho.
3. (Longo prazo) Expandir a disciplina pra Write tool também — SHA pre/post de qualquer operação de escrita em artefato tracked. Consistente com GVS 0.1 §9 três \emph{atomic writes}.
