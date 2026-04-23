# Permissions Matrix — IAM Overlay

> **Princípio:** menor privilégio. Toda exceção é registrada em `04 Decision/<data>-iam-exception-<slug>.md` com prazo de validade.

---

## 1 · Matriz canônica

| Recurso | Gestora | Analyst | Designer | External (cliente / advisor / counsel) |
|---|---|---|---|---|
| **Estate existente** (pastas pré-existentes) | (mantém) | (mantém) | (mantém) | (mantém) |
| `_Governanca_Obsidian/` | Editor (Owner) | Reader | Reader | **Sem acesso** |
| `_Governanca_Obsidian/00 Home.md` | Editor | Reader | Reader | — |
| `_Governanca_Obsidian/01 Identity/` | Editor | Reader | Reader | — |
| `_Governanca_Obsidian/02 Policy/` | Editor | Reader | Reader | — |
| `_Governanca_Obsidian/03 Roles/` | Editor | Reader | — | — |
| `_Governanca_Obsidian/04 Decision/` | Editor | Reader | — | — |
| `_Governanca_Obsidian/05 Memory/` | Editor | Editor (criar/editar suas notas) | Reader | — |
| `_Governanca_Obsidian/05 Memory/<Cliente>/` (PII-RESTRICTED) | Editor | Reader (vê ciphertext) | Reader (vê ciphertext) | — |
| `_Governanca_Obsidian/06 Audit/` | Editor (mas só script escreve) | Reader | — | — |
| `_Governanca_Obsidian/_attachments/` | Editor | Editor | Editor | — |
| `_Governanca_Obsidian/_templates/` | Editor | Reader | Reader | — |
| `_Governanca_Obsidian/_governance/` | **Editor (sole)** | — | — | — |
| `_Governanca_Obsidian/_keys/` | **Editor (sole)** | — | — | — |
| `_Governanca_Obsidian/.audit/` | Editor (script-write) | Reader | — | — |
| `Apps Script project` | Editor (Owner) | — | — | — |
| `Drive activity log` | Reader (auto, by Workspace) | Reader (limited) | — | — |
| **OS Keychain entry "Meld Encrypt — <agency>"** | **Sole** | — | — | — |

---

## 2 · Por que cada granularidade

### Por que analyst NÃO tem leitura de `03 Roles/`?

Roles inclui dados pessoais dos próprios analystas (e-mail privado, contato emergência, base salarial em alguns templates). Reduzir vazamento horizontal.

### Por que analyst PODE editar em `05 Memory/`?

O analyst contribui ativamente para a memória de campanhas. Sem isso, o vault decai. **Mas:** o analyst NÃO classifica as notas como PII-RESTRICTED (só a gestora) e não pode encriptar (só a gestora tem a chave).

### Por que designer NÃO tem leitura de `04 Decision/`?

Decisões de contrato/financeiro/cliente não fazem parte do escopo do designer. Princípio de need-to-know.

### Por que ninguém além da gestora tem acesso a `_keys/`?

Mesmo `_keys/` contém apenas hints (não a chave em si), o conhecimento de **que existe** uma estrutura de Shamir é ele mesmo informação tática. Manter mínimo.

### Por que Cachola Tech (advisor) tem **zero acesso**?

- **Confidencialidade**: o advisor entrega disciplina, não consome dado.
- **Reputacional**: se a Cachola Tech tivesse acesso e algo vazasse, a Cachola Tech seria suspeita. Removendo o vetor, eliminamos a suspeita.
- **Contratual**: se em algum momento a relação Cachola Tech ↔ Bonita G acabar, não há revogação cara a fazer — só nada para revogar.
- **Legal**: a LGPD considera o advisor como "operador" se houver acesso a dado pessoal. Sem acesso, sem obrigação solidária.

### Quando Dr. César (counsel) precisa de acesso?

**Apenas em incidente.** Em condição normal, zero. Em incidente, a gestora cria janela temporária de acesso (Reader na folder específica) com prazo definido na nota `04 Decision/<data>-counsel-temporary-access.md`.

---

## 3 · Procedimento de mudança de IAM

Toda mudança em IAM segue este fluxo:

1. **Justificativa registrada** em `04 Decision/<data>-iam-change-<slug>.md`. Inclui:
   - Quem ganha/perde acesso
   - Folder afetada
   - Razão de negócio
   - Prazo (mudança permanente ou temporária com data de revisão)
2. **Aplicação** via UI do Drive ou via Apps Script (não via gestora apenas; pode delegar a gestora-substituta com auditoria)
3. **Audit note** em `06 Audit/<data>-IAM-CHANGE-<slug>.md` (auto se via Apps Script; manual se via UI)
4. **Confirmação no próximo `runPermissionsAudit()`** — a mudança aparece no relatório quartely

---

## 4 · Auditoria de IAM (cadência)

| Cadência | Ação | Responsável |
|---|---|---|
| Semanal | `02_audit_emitter.gs` checa permission drift automaticamente | Apps Script |
| Trimestral | `runPermissionsAudit()` produz relatório completo | Gestora (manual) |
| Anual | Revisão de todas as notas `04 Decision/iam-*` — ainda válidas? Justificativas ainda fazem sentido? | Gestora + Cachola Tech advisor (debrief mensal) |
| Eventual (cliente compliance review) | `runPermissionsAudit()` on-demand antes da entrega do relatório ao cliente | Gestora |

---

## 5 · Onboarding / offboarding de pessoa

### Onboarding analista

1. E-mail Workspace criado pela gestora (procedimento normal de Workspace admin)
2. Adicionar e-mail no `00_config.gs` → `ANALYST_EMAILS`
3. Re-rodar `setupOverlay()` (idempotente, só aplica permissões novas)
4. Treinamento de 30 min: SOP_ANALISTA_diario.md + esta matriz
5. Audit note: `06 Audit/<data>-ONBOARD-<analyst-slug>.md`

### Offboarding (saída do analista)

1. Decisão registrada em `04 Decision/<data>-offboard-<slug>.md`
2. Remover e-mail de `00_config.gs` → `ANALYST_EMAILS`
3. Re-rodar `setupOverlay()` — não revoga sozinho (apenas adiciona). Vai pra UI do Drive e revoga acesso manual.
4. Workspace admin: desativar conta (perde sync, perde Drive, perde tudo).
5. Audit note: `06 Audit/<data>-OFFBOARD-<slug>.md`
6. Próximo `runPermissionsAudit()` confirma revogação completa
