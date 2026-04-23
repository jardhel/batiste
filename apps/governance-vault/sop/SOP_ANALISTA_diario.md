# SOP — Analista · Diário

> **Tempo total: 5 minutos por dia.** Manhã, antes de começar a entregar.

---

## Manhã (5 minutos)

### Passo 1 · Sync do Drive (1 min)

- Abra a Drive desktop client (Mac: na barra de menu superior; Windows: na bandeja). Confirme que sincronizou as últimas 24h.
- Se aparecer "conflito" ou "syncing" travado, avise a gestora **antes** de abrir qualquer nota.

### Passo 2 · Abrir o vault (1 min)

- Abra Obsidian. Vault: `_Governanca_Obsidian` (na pasta sincronizada).
- Vá em `00 Home.md` → confirme que está renderizando corretamente (links azuis funcionando, frontmatter visível).

### Passo 3 · Plano do dia da gestora (1 min)

- `05 Memory/Plano do dia/<data>.md` — leia. Sua tarefa do dia tá lá.
- Se você é responsável por uma entrega marcada como `PII-RESTRICTED`, vá pro Passo 4.

### Passo 4 · O que você pode (e não pode) fazer com PII-RESTRICTED (2 min)

**Você NÃO pode:**

- Decifrar blocos `%%🔐α ... α🔐%%`. A chave está com a gestora. Se você precisa do conteúdo específico, **pergunte a ela por canal interno** (Teams/Slack), não tente extrair.
- Copiar/colar o ciphertext em outro app. O ciphertext fora do vault é dado opaco mas associável; mantenha-o no vault.
- Editar a frontmatter `classification:`. Se você acha que uma nota deveria ser PII-RESTRICTED e não está, avise a gestora — só ela altera classification.
- Compartilhar links de arquivos da pasta `_Governanca_Obsidian/` com pessoas fora do time.

**Você PODE:**

- Ler tudo que NÃO está em bloco encrypted (frontmatter, títulos, contexto não-PII)
- Contribuir com notas em `04 Decision/` e `05 Memory/` desde que NÃO inclua PII em texto plano
- Carimbar entregas suas (PDFs, SVGs) — o audit emitter automaticamente registra
- Pedir contexto de blocos encrypted via gestora (ela responde com a info que você precisa, sem expor o resto)

---

## Como entregar uma peça hoje

1. Salve o arquivo final no caminho do vault correspondente ao cliente. Ex: `05 Memory/Cliente_X/campanha_Y/<peça>.pdf`.
2. **Não precisa** rodar nada manual — o audit emitter detecta e carimba dentro de até 15 minutos.
3. Se a entrega tem urgência (cliente esperando agora), pergunte à gestora — ela pode rodar `onDriveChange()` manualmente pra forçar emissão imediata.

---

## Quando algo fica estranho

| Situação | O que fazer |
|---|---|
| Conflito de sync | Pare. Avise a gestora. Não tente "resolver" sem ela. |
| Nota que você editou voltou ao estado anterior | Possível conflito de sync — Drive history mostra. Avise gestora. |
| Você abriu uma nota e viu PII em cleartext | Anote o nome da nota e mande pra gestora **por canal interno** (não cite o conteúdo). É ela que recriptografa. |
| Apareceu uma nota nova em `06 Audit/` que você não reconhece | Normal — provavelmente foi auto-emitida. Se o nome refere a uma de suas entregas, é confirmação. |
| Apps Script erro chega no seu e-mail | Encaminhe pra gestora; você não tem acesso de edição ao script. |

---

## Card de cabeceira

```
┌─ Analista · Diário ─────────────────────────┐
│                                             │
│  AM  ☐ Confirmar sync Drive 24h (1)         │
│      ☐ Abrir vault, conferir Home (1)       │
│      ☐ Ler plano do dia em 05 Memory (1)    │
│      ☐ PII-RESTRICTED? Reler regras (2)     │
│                                             │
│  Total: 5 min/dia                           │
│  Limite: NÃO decifrar, NÃO compartilhar     │
│  externamente, NÃO escrever PII em plano    │
└─────────────────────────────────────────────┘
```
