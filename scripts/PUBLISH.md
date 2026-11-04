# PUBLISH.md — runbook de publicação npm do Batiste

O "terraform" de publicação: pipeline declarativo, repetível e idempotente para
publicar os pacotes **MIT** do Batiste em `npm` sob a org `@batiste-aidk`.

- **Pipeline:** [`scripts/publish-npm.mjs`](./publish-npm.mjs)
- **Manifesto (fonte da verdade do conjunto público):** [`scripts/npm-publish.config.json`](./npm-publish.config.json)

> **Default é dry-run.** Nada é publicado sem `--yes-publish` **E** um `npm whoami` logado.

---

## Regra de IP — inegociável

Só pacotes **MIT** vão público. Os **proprietários** (`license` ≠ MIT) **nunca** são publicados:

| Proprietário (`UNLICENSED` / sem licença) | Por quê fica privado |
|---|---|
| `atrium` | facility-manager / runtime proprietário |
| `cli` | CLI pesado proprietário (ver decisão abaixo) |
| `marketplace` | gateway de billing/roteamento — core do IP |
| `parallel` | orquestração paralela proprietária |
| `credential-preflight` | gate interno |
| `pitch-integrity` | gate interno |
| `repo-hygiene` | gate interno |
| `ui-consistency` | gate interno |

O pipeline **re-verifica no disco** `license === "MIT"` e `private !== true` antes de tocar
qualquer pacote. Se um proprietário aparecer no manifesto, o **IP gate hard-aborta** a run
inteira (exit 1) — inclusive em dry-run. Publicar um proprietário = vazar IP.

> ⚠️ **Achado em aberto:** hoje **todos** os `packages/*/package.json` estão com
> `"private": false` (inclusive os proprietários). O isolamento dos proprietários é
> garantido **por ausência no manifesto + IP gate por licença**, não por `private:true`.
> Recomendado (decisão do founder): adicionar `"private": true` em cada proprietário como
> cinto-e-suspensório. Ver "Hardening recomendado".

---

## Pré-requisitos

1. **Login npm (founder, uma vez por máquina):**
   ```bash
   npm login            # org @batiste-aidk, com 2FA habilitado
   npm whoami           # deve imprimir o usuário; o pipeline exige isto pra publish real
   ```
   O agente **não** tem credencial npm. O publish real é exclusivamente do founder.

2. **Build fresco** (o pipeline empacota `dist/`, não `src/`):
   ```bash
   pnpm install
   pnpm build           # turbo build em todos os pacotes
   ```

3. **Decisão do `cli`** (ver seção abaixo) antes de prometer "qualquer um instala".

---

## Dry-run (seguro, repetível, é o default)

```bash
node scripts/publish-npm.mjs            # dry-run de todos os MIT, na ordem de dependência
node scripts/publish-npm.mjs --json     # mesmo, com resumo machine-readable no stdout
```

Saída por pacote: `nome@versão`, nº de arquivos, tamanho do tarball, tamanho desempacotado,
e quaisquer **gaps de prontidão** (README ausente, `publishConfig.access` ausente, etc.).
Dry-run nunca contata o registry pra escrita e nunca move dist-tags.

---

## Publish real (somente founder)

```bash
npm login                                   # se ainda não estiver logado
node scripts/publish-npm.mjs --yes-publish  # publica os MIT, na ordem de dependência
```

Salvaguardas que rodam antes de qualquer publish:

- `--yes-publish` **sem** `npm whoami` logado → **aborta** com instrução (exit 1).
- Qualquer pacote no manifesto com `license` ≠ MIT ou `private:true` → **IP gate aborta** a run.
- Versões prerelease (`-alpha`/`-beta`/`-rc`/`-next`) publicam com `--tag next` (não movem `latest`).
- Os 8 proprietários **nunca** entram na run (não estão no manifesto).

Idempotência: re-rodar é seguro. Versões já publicadas no registry falham no `npm publish`
(o npm recusa sobrescrever uma versão existente) — bumpe a `version` (via changeset) para republicar.

---

## Ordem de dependência (definida no manifesto)

| Level | Pacotes |
|---|---|
| 0 | `core`, `connectors`, `graph`, `gvs`, `memory`, `sign`, `rls` |
| 1 | `audit`, `auth`, `scope`, `transport` |
| 2 | `code`, `aidk` |

Adicionar/remover um pacote público = editar **só** `scripts/npm-publish.config.json`.
O pipeline não tem lista hardcoded.

---

## Decisão do `cli` (a recomendar ao founder)

O `cli` é **proprietário** (`UNLICENSED`), mas é o que habilita
`npx @batiste-aidk/cli node start` — o "qualquer um instala". Há duas saídas:

- **(a)** abrir o `cli` numa licença pública (MIT/Apache) — expõe o CLI pesado e suas deps
  proprietárias (`marketplace`, `connectors`, `gvs`, `code`...) ao público; e
- **(b)** publicar um **launcher público fino** novo (ex. `@batiste-aidk/start`, MIT) que só
  sobe o node usando os pacotes **MIT** já públicos, mantendo o `cli` pesado **privado**.

**Recomendação: (b)** — menor risco de IP. O launcher fino é a única superfície pública,
o IP proprietário (`marketplace`, `atrium`, `parallel`, o `cli` cheio) fica privado, e o
"qualquer um instala" continua funcionando via `npx @batiste-aidk/start`. Abrir o `cli`
inteiro (a) acopla a porta de entrada pública ao IP pesado e é difícil de reverter depois
de publicado. Decisão é do founder; o pipeline não publica `cli` em nenhum dos casos sem
edição explícita do manifesto.

---

## Hardening recomendado (decisão do founder, não aplicado automaticamente)

Gaps de prontidão achados no dry-run (não bloqueiam publish, mas melhoram o pacote):

1. **`publishConfig.access:"public"`** em cada MIT (hoje só `rls` tem). O pipeline já passa
   `--access public` na linha de comando, então é redundância defensiva.
2. **README.md** em: `aidk`, `audit`, `auth`, `code`, `gvs`, `memory`, `scope`, `sign`.
3. **Arquivo `LICENSE`** (MIT) em cada pacote — hoje nenhum tem o arquivo, só o campo
   `license` no `package.json`. npm publica sem ele, mas é boa prática legal.
4. **`"private": true`** em cada proprietário (cinto-e-suspensório do IP gate).

> O script legado `publish-all.sh` (raiz do repo) **inclui `marketplace` e `cli`** na lista
> de publish — isto é um risco de vazamento de IP. Preferir este pipeline; aposentar o
> `publish-all.sh` ou alinhá-lo ao manifesto.
