# Obsidian mobile — setup e UX

> **Backstory:** Esta doc nasceu de gap descoberto em dogfooding interno da Cachola Tech em 2026-04-23 — o fundador tentou abrir o vault no celular e não conseguiu. A causa é estrutural (sandbox iOS/Android + limitação dos clients Drive móveis), não bug. Esta doc é a resposta canônica que vale tanto para Cachola Tech quanto para Bonita G e para qualquer agência futura.

---

## 0 · A pergunta que você vai escutar

> *"Como abro o vault no meu celular?"*

A gestora vai perguntar. A analista vai perguntar. O cliente curioso (depois de ver a peça) vai perguntar. Esta doc é o roteiro.

---

## 1 · Por que mobile não funciona out-of-the-box

Obsidian mobile (iOS e Android) opera **dentro de sandbox** — só lê arquivos que estejam em locations explicitamente expostos ao app:

- `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/<vault>/` (iOS · iCloud)
- `Internal Storage/Documents/<vault>/` (Android · armazenamento local)
- `~/Documents/<vault>/` (iOS · "On My iPhone")
- Vault sincronizado via **Obsidian Sync** (gerenciado pelo próprio app)
- Pastas explicitamente compartilhadas via Files Provider (raro)

**Não funciona:**

- Pasta dentro de `Google Drive` mobile client — o Drive iOS/Android não expõe arquivos via Files API persistente. Obsidian abre, edita, mas o arquivo editado não persiste de volta no Drive (sync round-trip quebra ou conflita).
- Pasta sincronizada por OneDrive/Dropbox móvel — mesma limitação que Drive na maioria dos casos.
- Pasta em servidor/NAS via SMB/NFS — não suportado.

A causa é Apple/Google sandboxing por design — não é bug do Obsidian, não vai mudar. A solução é usar uma das cinco opções abaixo.

---

## 2 · Cinco opções, ranqueadas por UX × custo

| # | Opção | UX mobile | Custo | Setup | Quando usar |
|---|---|---|---|---|---|
| **A** | **Obsidian Sync** (oficial) | ⭐⭐⭐ Excelente | $4/mês/usuário | 5 min | **Padrão recomendado** — gestora, founder Cachola Tech |
| **B** | iCloud Drive (iOS only) | ⭐⭐ Boa em iOS | Grátis (5GB) | 10 min + mover vault | Solo iOS, vault pequeno |
| **C** | GitHub + Working Copy (iOS) ou Termux (Android) | ⭐⭐ Boa, sync manual | Grátis | ~30 min | Power users que já usam git |
| **D** | Drive web viewer (read-only mobile) | ⭐ Apenas leitura | Grátis | 0 min | Acesso emergencial; analista que só consulta |
| **E** | FolderSync (Android only) + Obsidian Android | ⭐⭐ Boa em Android | Grátis (free tier) ou $3 (Pro) | ~20 min | Analistas Android que precisam editar |

---

## 3 · Opção A · Obsidian Sync (recomendada)

### O que é

Sync proprietário do Obsidian, end-to-end encrypted (passphrase opcional além da conta), funciona em desktop + iOS + Android com latência de segundos. Usa servidores próprios (não AWS, não Google) — o vault sincronizado nunca sai do controle do Obsidian.

### Custo

$4/mês ou $48/ano por usuário. Cada principal (gestora, analista que precisa de mobile) tem sua própria conta.

### Setup desktop (5 min, uma vez)

1. Obsidian desktop → Settings → Account → Sign in (ou sign up — Obsidian Free serve, não precisa pagar plano)
2. Settings → Account → Manage Sync → escolha o plano (Standard $4/mo basta para vaults <10GB)
3. Settings → Core plugins → **Sync** → Enable
4. Sync settings:
   - **Remote vault:** "Choose remote vault" → "Create new vault on remote" → nome (ex: `cachola-tech` ou `bonita-g`)
   - **End-to-end encryption:** **ATIVAR** — escolha passphrase forte (Diceware 4-6 palavras), salve no Keychain (entry separada da Meld Encrypt — é outra chave)
   - **Sync settings:** Sync everything (incluindo `.obsidian/` config) — assim o mobile herda mesmas configurações de plugin
   - **Conflict resolution:** "Keep newer" (default)
5. Wait — primeiro upload (~1-5 min para vault de poucos MB)

### Setup mobile (3 min, uma vez)

1. Instale Obsidian (App Store / Play Store) — grátis
2. Abra → Sign in (mesma conta do desktop)
3. "Open another vault" → "Sync from remote" → escolha o vault que você criou no desktop
4. Cole a passphrase end-to-end
5. Wait — primeiro download (~1-3 min)

Pronto. A partir daí, edite em qualquer lugar, sync em segundos.

### Meld Encrypt no mobile

Ele sincroniza automaticamente com o vault (porque está em `.obsidian/plugins/meld-encrypt/`). Para funcionar:

1. Mobile → Settings → Community plugins → Enable (precisa ativar uma vez)
2. Vai pedir a passphrase de Meld Encrypt — **mesma** que está no Keychain do desktop. Cole.
3. Encrypt/decrypt no mobile funciona idêntico ao desktop.

**Atenção:** a passphrase de Meld Encrypt é DIFERENTE da passphrase de Obsidian Sync. Você tem duas chaves no Keychain agora:

- `Meld Encrypt - <vault>` — encripta spans dentro de notas
- `Obsidian Sync - <vault>` — encripta o transit e o storage no servidor Obsidian

Ambas precisam estar bem guardadas. Ambas devem estar no Shamir 3-de-5.

---

## 4 · Opção B · iCloud Drive (iOS only)

### Quando faz sentido

- Founder solo, único principal
- Já usa Mac + iPhone, conta Apple sólida
- Vault pequeno (cabe em 5GB grátis ou em iCloud+ pago)
- Não precisa de Android nem cross-org

### Setup

1. Mac: mova o vault para `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/<vault>/`
   ```bash
   mkdir -p ~/Library/Mobile\ Documents/iCloud~md~obsidian/Documents/
   mv /caminho/atual/vault/ ~/Library/Mobile\ Documents/iCloud~md~obsidian/Documents/<vault-name>/
   ```
2. Mac Obsidian → fechar todos vaults → "Open another vault" → navegar até o novo path
3. iPhone: instale Obsidian → abrir → vault aparece automaticamente em "iCloud" provider
4. Aguarde sync iCloud (alguns minutos para vault de poucos MB)

### Limitações

- Cross-platform ruim (iOS ↔ Mac OK, Android não)
- Conflict resolution menos refinado que Obsidian Sync
- iCloud sync às vezes trava (especialmente em vaults grandes >100MB) — se acontecer, acionar "Optimize Storage" off
- Difícil de usar em multi-principal (cada conta Apple é independente)

---

## 5 · Opção C · GitHub + Working Copy (iOS) / Termux (Android)

### Quando faz sentido

- Você quer histórico git do vault
- Power user, não tem problema com `git pull` / `git push` manual
- Não quer pagar Obsidian Sync mas quer mobile sólido
- Already paying GitHub Pro ou tem private repo grátis

### Setup iOS · Working Copy

1. App Store → instale Working Copy (free para repos públicos; $20 one-time pra Pro com privados)
2. Crie private repo em GitHub: `<seu-usuario>/<vault-name>`
3. Mac terminal:
   ```bash
   cd /caminho/do/vault
   git init
   git add .
   git commit -m "initial vault commit"
   git remote add origin git@github.com:<usuario>/<vault-name>.git
   git push -u origin main
   ```
4. iPhone Working Copy → Clone repository → URL `git@github.com:<usuario>/<vault-name>.git`
5. Working Copy → "Setup repository" → "Move to On My iPhone/Files" → confirme
6. iPhone Obsidian → "Open another vault" → "On My iPhone" → escolha a pasta clonada
7. Workflow:
   - Editou no celular? Working Copy → Commit → Push
   - Editou no desktop? `git push` no terminal (ou interface GitHub Desktop) → no mobile: Working Copy → Pull

### Setup Android · Termux

Similar, mas sem GUI. Termux + git CLI + Obsidian Android. Funciona, é menos elegante que Working Copy.

### Limitações

- Sync NÃO é automático — você precisa pull/push manualmente. UX inferior a A.
- Conflitos git em markdown podem ser irritantes (line-by-line merges).
- Bom para auditoria (git log dá histórico completo); não bom para fluência mobile.

---

## 6 · Opção D · Drive web viewer (read-only mobile)

### Quando faz sentido

- Analista que só precisa CONSULTAR notas no celular (não editar)
- Acesso emergencial (laptop quebrou, precisa ler `06 Audit/<incidente>.md`)
- Cliente curioso querendo ver superficialmente

### Como usar

- iPhone/Android → Drive app → navegue até o vault → toque em qualquer `.md`
- Drive renderiza markdown como texto plano (sem links, sem frontmatter formatado, sem plugin features)
- Read-only — qualquer "Edit" abre Google Docs, que **NÃO** é compatível com o vault (gera arquivo .docx separado)

### Limitações

- Sem decryption de Meld Encrypt spans
- Sem grafo, sem backlinks, sem search
- Texto vai aparecer como markdown bruto
- Frontmatter aparece como YAML literal

Para acesso real, vá pra A, B, ou C.

---

## 7 · Opção E · FolderSync (Android only)

### Quando faz sentido

- Time da Bonita G com analistas Android
- Não querem pagar Obsidian Sync
- OK com sync configurável mas não-instantâneo

### Setup

1. Play Store → instale FolderSync (free) ou FolderSync Pro ($3 one-time)
2. Conecte ao Google Drive em FolderSync
3. Crie folderpair: remote `_Governanca_Obsidian/` ↔ local `/storage/emulated/0/Documents/_Governanca_Obsidian/`
4. Configurar sync: bidirectional, intervalo de 5-15 min ou "on file change"
5. Android Obsidian → "Open another vault" → escolha a pasta local sincronizada
6. Pronto

### Limitações

- Android only (não tem iOS equivalente decente)
- Conflitos podem aparecer se o desktop e o mobile editarem a mesma nota simultaneamente
- Sync delay de 5-15 min (configurável, mas mais frequente = mais bateria)

---

## 8 · Recomendação por perfil

| Perfil | Opção primária | Opção fallback |
|---|---|---|
| Cachola Tech founder (solo, Mac + iPhone) | **A · Obsidian Sync $4/mo** | B · iCloud Drive |
| Bonita G gestora (multi-cliente, mobile diário) | **A · Obsidian Sync $4/mo** | D · Drive web viewer |
| Bonita G analista (consulta esporádica) | **D · Drive web viewer** (grátis) | A · Obsidian Sync se a agência pagar pro time |
| Bonita G analista (Android, edição frequente) | **E · FolderSync Pro $3** | A · Obsidian Sync |
| Power user com git | **C · GitHub + Working Copy** | A · Obsidian Sync |

**Por que A é o default:** UX próximo de "magic", end-to-end encrypted, mantém Meld Encrypt funcionando, cross-platform sólido. Os $4/mês são desprezíveis vs custo de tempo perdido com soluções híbridas.

---

## 9 · Implicações de governança

A escolha de método de sync mobile NÃO afeta a IAM matrix (`permissions/permissions_matrix.md`). O ledger continua append-only, audit notes continuam sendo emitidas pelo Apps Script no Drive. Mobile sync é **camada paralela de leitura/edição** — não substitui o motor primário (Drive + Apps Script).

**Risco específico de A (Obsidian Sync):** o vault completo passa pelos servidores Obsidian (mesmo end-to-end encrypted, é tráfego cross-border, com Obsidian em UK). Para vaults com classification `CONFIDENTIAL` ou `SECRET` em volume significativo, fazer ADR antes de adotar A — registrar a decisão de cross-border no `04 Decision/`.

Para Bonita G hoje (PII-RESTRICTED criptografado por Meld Encrypt **antes** de chegar no servidor Obsidian), o risco é minimal — o servidor Obsidian recebe ciphertext duplo (Meld dentro de Sync). ADR ainda é boa prática mas não bloqueante.

---

## 10 · Política da Cachola Tech

A Cachola Tech adota **opção A (Obsidian Sync)** para o vault `obs_vault/cachola_tech/` a partir de 2026-04-23 (após o gap descoberto pelo founder). Custo $48/ano absorvido. Decisão registrada em `obs_vault/cachola_tech/04 Decision/2026-04-23-adopt-obsidian-sync.md` (a criar).

Para o framework Bonita G, a recomendação default no `SOP_NOVO_CLIENTE.md` deve mencionar Obsidian Sync como item opcional no setup inicial, com call-out: *"se a gestora vai usar mobile, ative na mesma sessão de instalação (5 min adicional)"*.
