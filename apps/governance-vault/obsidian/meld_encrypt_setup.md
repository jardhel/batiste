# Obsidian + Meld Encrypt — Setup

> **Para a GESTORA primeiro** (chave master). Depois para cada **ANALISTA** (sem chave).
> Tempo: 30 min para a gestora, 10 min por analista.

---

## 1 · Instalar Obsidian (5 min, qualquer pessoa)

- Download: https://obsidian.md (versão grátis basta).
- macOS: arrastar `Obsidian.app` pra `/Applications`.
- Windows: instalador `.exe`.
- Linux: AppImage ou Snap.

Abrir uma vez e fechar. Não criar vault ainda.

---

## 2 · Configurar Drive desktop client (5 min, primeira vez na máquina)

A pasta-vault precisa estar dentro da pasta sincronizada do Drive.

- Download: https://www.google.com/drive/download/
- Login com a conta Workspace da agência (gestora ou analista, conforme o caso).
- Aceite "Stream files" ou "Mirror files":
  - **Stream** (recomendado para analistas): arquivos vivem na nuvem, baixam on-demand. Vault funciona, mas latência um pouco maior.
  - **Mirror** (recomendado para gestora): cópia local completa. Mais rápido, vault funciona offline.

Verifique: a pasta `_Governanca_Obsidian/` aparece sob algo como `~/Library/CloudStorage/GoogleDrive-<email>/My Drive/...`.

---

## 3 · Abrir o vault no Obsidian (3 min)

- Obsidian → "Open another vault" → "Open folder as vault"
- Navegue até a pasta `_Governanca_Obsidian/` no Drive sincronizado
- Confirme. Obsidian indexa em alguns segundos.
- A nota `00 Home.md` deve aparecer.

---

## 4 · Instalar Meld Encrypt (5 min — gestora E analistas)

Meld Encrypt encripta spans dentro de notas markdown. Funciona offline. Algoritmo: AES-256-GCM com chave derivada por PBKDF2.

- Obsidian → Settings → Community plugins → "Browse"
- Pesquise por **Meld Encrypt**
- Install → Enable

Configurações recomendadas:

```
Meld Encrypt → Settings:
  - Encryption algorithm: AES-256-GCM
  - Iterations: 600000  (PBKDF2)
  - Default behavior: Encrypt selection
  - Marker style: %%🔐α ... α🔐%%   (default — não mude)
  - Decryption visibility: in-place (cleartext only on demand, never persisted)
  - Quick keys:
      Encrypt selection:    Cmd+Shift+E   (macOS) / Ctrl+Shift+E (Windows)
      Decrypt in place:     Cmd+Shift+D   (macOS) / Ctrl+Shift+D (Windows)
```

---

## 5 · Configurar a CHAVE MASTER (gestora apenas — 10 min)

Esta é a operação crítica. A gestora gera UMA chave master uma vez, e essa chave permite encriptar/decriptar todos os spans em toda nota PII-RESTRICTED do vault.

### Passo 5.1 · Gerar passphrase forte

- Use um gerador como Diceware (4-6 palavras): https://diceware.dmuth.org
- Ou senha aleatória de 24+ caracteres no 1Password / Bitwarden
- **Anote em papel físico**. Coloque em envelope lacrado em local físico seguro (cofre, gaveta trancada).
- **Adicione no Keychain**: macOS → Keychain Access → File → New Password Item:
  - Keychain Item Name: `Meld Encrypt - Bonita G`
  - Account Name: `<gestora email>`
  - Password: `<passphrase gerada>`
- A chave **NUNCA** vai para o Drive. Nunca para o Obsidian config sincronizado. Apenas Keychain local.

### Passo 5.2 · Configurar Meld Encrypt para usar a chave

- Obsidian → Meld Encrypt → "Set vault password"
- Cole a passphrase. Confirme.
- Meld Encrypt agora vai usar essa key para encrypt/decrypt nesta máquina, neste vault.

### Passo 5.3 · Teste

- Crie nota teste em `05 Memory/` com texto "este é um teste"
- Selecione → Cmd+Shift+E → vê texto virando `%%🔐α ... α🔐%%`
- Cursor sobre o bloco → Cmd+Shift+D → cleartext aparece
- Cmd+Shift+E → re-encrypt
- Salve.
- **DELETE a nota teste**. Não deixe ciphertext de teste no vault.

### Passo 5.4 · Backup da chave (Shamir 3-de-5) — IMPORTANTE

Para que a perda do laptop OU esquecimento da senha não signifique perda permanente das notas, divida a passphrase em 5 partes via Shamir Secret Sharing, das quais 3 reconstituem a chave.

Ferramenta sugerida: [SSSS](http://point-at-infinity.org/ssss/) (CLI) ou plugin do 1Password.

```bash
# Exemplo CLI (instalar via brew install ssss no macOS):
echo "<sua passphrase>" | ssss-split -t 3 -n 5
```

Distribua as 5 partes para 5 lugares distintos:

1. Cofre físico em casa
2. Cofre físico no escritório
3. Envelope lacrado com pessoa de confiança 1 (familiar)
4. Envelope lacrado com Dr. César (counsel da casa)
5. Envelope lacrado com Cachola Tech (advisor) — apenas se houver NDA específica em pé

Recovery: precisa de 3 das 5 → use `ssss-combine -t 3` para recompor.

---

## 6 · Setup para ANALISTA (10 min cada — gestora supervisiona)

Cada analista repete passos 1, 2, 3, 4 acima. **Pula** passos 5 (sem chave master).

Resultado: o analista abre o vault, vê notas, **mas blocos `%%🔐α ... α🔐%%` aparecem como ciphertext**. Não consegue decifrar. Comportamento esperado e correto.

Se o analista precisa de info específica de um bloco, pede pra gestora por canal interno.

---

## 7 · Manutenção contínua

| Cadência | Ação |
|---|---|
| Semanal | Confirmar que o sync Drive está OK na máquina da gestora (verificar timestamp do último sync) |
| Mensal | Confirmar que o Keychain ainda contém a entrada `Meld Encrypt - Bonita G` |
| Trimestral | Rodar `runPermissionsAudit()` no Apps Script (cobre ACLs do Drive E classification das notas PII) |
| Anual | Rotacionar a master key: gerar nova passphrase, decrypt + re-encrypt todas as notas PII-RESTRICTED, gerar nova partição Shamir |

---

## 8 · O que NUNCA fazer

- Compartilhar a master key por e-mail, WhatsApp, Slack, Teams, ou qualquer canal eletrônico.
- Salvar a master key em arquivo no Drive, mesmo encriptado.
- Deixar o Obsidian aberto com cleartext visível em monitor à vista de não-autorizados.
- Confiar em "lembrança" da passphrase — Shamir é o único backup aceitável.
- Usar a mesma master key em outro vault da gestora (segregação por cliente/agência).
