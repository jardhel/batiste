# SOP — Gestora · Diário

> **Tempo total: 15 minutos por dia.** 10 minutos pela manhã, 5 minutos no final do dia.
> Cumpra todos os dias úteis. Falhar 3 dias seguidos disparou alerta automático no quarterly audit.

---

## Manhã (10 minutos)

### Passo 1 · Abrir o vault e checar EOD do dia anterior (2 min)

- Abra Obsidian → vault `_Governanca_Obsidian`.
- Vá em `06 Audit/` → abra a nota `YYYY-MM-DD-EOD-DIGEST.md` do dia anterior.
- Confirme: número de carimbos do dia anterior, audit notes adicionadas, releases publicados, commits.
- Se algo está fora do esperado (zero artefatos quando o time produziu, ou um nome estranho aparece), investigue **agora**.

### Passo 2 · Triagem da inbox de eventos (3 min)

- Em `06 Audit/`, ordene por data. Veja as notas das **últimas 12 horas**.
- Para cada nota cujo nome começa com data de hoje:
  - Se for de tipo `file.changed` esperado → marque como lida (Obsidian: ⌘-B "Mark as read" ou similar plugin).
  - Se for `permission.drift` → vai pra Passo 4.
  - Se for `audit.finding` ou `permission.violation` → vai pra Passo 4.
- Tempo cap: 3 minutos. Se a inbox tem >20 notas novas, é sinal de que o ritmo do time mudou ou houve evento anormal — reporte ao Cachola Tech no debrief mensal.

### Passo 3 · Plano do dia em `05 Memory/` (3 min)

- Abra `05 Memory/Plano do dia/<data>.md` (cria se não existir, use template `_templates/memory.md`).
- Liste 3-5 entregas que vão ser carimbadas hoje. Para cada uma:
  - Cliente
  - Tipo (post, briefing, contrato, etc.)
  - Designer/analista responsável
  - Tem PII? Se sim, marca `classification: PII-RESTRICTED` na frontmatter da nota correspondente
- Salva. Esta nota não é compartilhada — vive no eixo Memory para servir de checklist pessoal.

### Passo 4 · Tratar drift / violations da noite (2 min)

- Para cada `permission.drift`:
  - Abra a pasta no Drive
  - Identifique quem está com acesso indevido
  - Remova o acesso pela UI do Drive
  - Volte na nota → adicione no fim: `Resolvido em <data> por <gestora>. Razão: <breve>`
- Para cada `audit.finding` crítica:
  - Decida: **(a)** está OK, anotar a justificativa; ou **(b)** corrigir agora
  - Em (b), execute, e depois rode `runPermissionsAudit()` no Apps Script editor pra confirmar
- Se não houver nada, perfeito. Esta etapa é zero-em-95%-dos-dias.

---

## Final do dia (5 minutos)

### Passo 5 · Gerar EOD digest do dia (2 min)

- Abra o Apps Script editor (link salvo nos favoritos do navegador)
- Selecione função `eodDigest` (ou rode o script local `python3 brand/eod_digest.py` se você tem acesso ao repo Cachola Tech) — gera nota `06 Audit/<data>-EOD-DIGEST.md`
- Volte ao Obsidian, abra a nota → confira: contagens batem com o que você lembra do dia?

### Passo 6 · Revisar PII-RESTRICTED criados hoje (2 min)

- Abra `05 Memory/`. Filtra por `classification:PII-RESTRICTED` e data de hoje.
- Para cada nota nova:
  - Cleartext sensível **dentro de blocos `%%🔐α ... α🔐%%`**? Se você ver CPF, CNPJ, e-mail de cliente, valor de fee em texto plano FORA de bloco encrypted → **falha**.
  - Recriptografe agora (Cmd-P → "Meld Encrypt: Encrypt selection")
- Se algum analista escreveu uma nota com PII em texto plano, manda mensagem direta. Não precisa ser drama — é treinamento contínuo.

### Passo 7 · Fechar laptop (1 min)

- Salve. Sincronize Drive (Drive desktop client deveria estar fazendo, mas confira).
- Feche Obsidian. Feche laptop. **Senha de tela ativada** (essencial — a chave Meld Encrypt está no Keychain protegido pela senha de login).

---

## Quando este SOP não basta

| Situação | Vá para |
|---|---|
| Suspeita de leak / acesso não autorizado | `SOP_INCIDENTE.md` (incident response) |
| Onboarding de novo cliente | `SOP_NOVO_CLIENTE.md` |
| Onboarding de novo analista | `SOP_ANALISTA_diario.md` (treinamento de 30 min) |
| Pergunta de compliance do cliente | Doc de prova `04_prova_dogfooding_verificavel.md` (do release Cachola Tech) |
| Algo quebrou no Apps Script | Mensagem no WhatsApp pra Jardhel + log no `06 Audit/<data>-INCIDENT-APPS-SCRIPT.md` |

---

## Card de cabeceira (imprimir, colar no monitor)

```
┌─ Gestora · Diário ──────────────────────────┐
│                                             │
│  AM  ☐ Abrir vault, checar EOD ontem (2)    │
│      ☐ Triagem inbox 06 Audit (3)           │
│      ☐ Plano em 05 Memory (3)               │
│      ☐ Drift / findings → resolver (2)      │
│                                             │
│  PM  ☐ Gerar EOD do dia (2)                 │
│      ☐ Revisar PII-RESTRICTED (2)           │
│      ☐ Fechar laptop com lock (1)           │
│                                             │
│  Total: 15 min/dia · ROI: contrato salvo    │
└─────────────────────────────────────────────┘
```
