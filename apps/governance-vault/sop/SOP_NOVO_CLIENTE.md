# SOP — Onboarding de novo cliente

> **Tempo total: ~25 minutos.** Faça uma vez por cliente. Depois disso, o cliente vive no fluxo normal do `SOP_GESTORA_diario.md`.

---

## Pré-requisito

- Cliente tem contrato assinado (mesmo que MoU informal — basta ter o nome e o escopo).
- Você decidiu se este cliente é `INTERNAL` (sem dados sensíveis) ou `PII-RESTRICTED` (com CPF/CNPJ/e-mail/valor financeiro).

## Passo 1 · Criar a árvore do cliente em `05 Memory/` (5 min)

- `05 Memory/<Cliente_Slug>/` (ex: `Itau_Asset/`, `Volkswagen_Marca/`)
- Dentro, crie:
  - `_index.md` (use template `_templates/memory.md`, ou se PII, use `_templates/client_pii.md`)
  - `briefs/`
  - `entregas/`
  - `historico/`

## Passo 2 · Preencher `_index.md` (8 min)

Frontmatter mínimo:

```yaml
---
title: "Cliente: <Nome>"
axis: memory
classification: INTERNAL  # ou PII-RESTRICTED
client_slug: <slug>
contract_status: signed   # signed | mou | exploratory | declined
created: <data>
account_lead: <nome do account>
account_email: <email do account>
tags: [axis/memory, client/<slug>]
---
```

Body:

- **Resumo do cliente** (3 linhas — quem é, vertical, porte)
- **Escopo contratado** (1 parágrafo)
- **Valor / regime** (mensal? por entrega? equity? — aqui é onde PII começa: se há valor monetário, **encrypte**)
- **Calendário-chave** (pitches, datas de entrega, evento)
- **Stakeholders no cliente** (PII — encrypte os e-mails se for o caso)

## Passo 3 · Política de IA específica do cliente (5 min)

Em `02 Policy/Cliente/<slug>_ai_policy.md`, registre:

- O cliente permite uso de IA generativa nas entregas? (sim / não / com restrições)
- Quais ferramentas estão liberadas? (Midjourney, Firefly, ChatGPT, Sora, etc.)
- Que tipo de proveniência o cliente exige na entrega? (manifest? C2PA? só declaração?)
- Quem é o ponto de contato de compliance no cliente?
- Quando foi a última revisão dessa política?

Esta nota é o que se mostra ao compliance do cliente quando perguntarem "como vocês governam IA na conta de vocês?".

## Passo 4 · Permissões IAM (5 min)

- Designer principal do cliente → adicione como Reader na pasta `05 Memory/<Cliente_Slug>/` (Drive UI, click direito → "Compartilhar").
- Account lead → Reader (mesmo).
- Externos do cliente (raro) → **NÃO adicione**. Se for absolutamente necessário, registre uma `04 Decision/` justificando, e mantenha por janela limitada.

> **Princípio:** o vault é interno da agência. O cliente não recebe acesso ao vault — recebe **entregas + manifests**.

## Passo 5 · Audit note de onboarding (2 min)

- Crie `06 Audit/<data>-CLIENT-ONBOARD-<slug>.md`
- Conteúdo: data, slug, classification escolhida, link pro `_index.md`, link pra ai_policy.md.
- Esta nota fica como evidência do start formal da relação.

---

## Checklist de fechamento

- [ ] `05 Memory/<slug>/_index.md` criado e preenchido
- [ ] Classification correta (INTERNAL ou PII-RESTRICTED)
- [ ] PII em blocos `%%🔐α ... α🔐%%` (se aplicável)
- [ ] `02 Policy/Cliente/<slug>_ai_policy.md` registrado
- [ ] IAM aplicado no Drive (designer + account lead)
- [ ] `06 Audit/<data>-CLIENT-ONBOARD-<slug>.md` criado
- [ ] EOD digest do dia vai mostrar este onboarding (deixar pra confirmar à noite)

## Quando o cliente sai

Use o `SOP_INCIDENTE.md` na seção "client offboarding" (mesma disciplina que incident response — preserva audit history, revoga acessos, arquiva pasta).
