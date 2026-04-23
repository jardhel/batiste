# SOP — Incidente

> **Quando aplicar:** suspeita de leak, perda de chave, sync corrompido, acesso não autorizado, e-mail de cliente questionando integridade.
> **Tempo: variável.** Os primeiros 15 minutos são críticos — pare tudo, siga o playbook.

---

## Princípios

1. **Documente em tempo real.** Crie `06 Audit/<data>-INCIDENT-<slug>.md` AGORA, antes de qualquer ação. Cada passo subsequente é um update na nota.
2. **Escale cedo.** Comunique gestora → Cachola Tech (advisor) → Dr. César (counsel) na ordem. WhatsApp ou Teams. Tempo SLA: <30 min.
3. **Não cause novo dano.** Não delete arquivos. Não revogue acessos sem registrar. Não dispare e-mail ao cliente antes do counsel revisar.
4. **Preserve evidência.** Screenshot tudo. Drive activity log. Apps Script log. Mensagens.

---

## Playbook por categoria

### A · Leak suspeito (alguém viu o que não devia)

1. **Identifique** o quê foi visto e por quem (timeline + canal)
2. **Não confronte** o(a) responsável imediatamente — primeiro pondere com a gestora
3. **Audit pull**: rode `runPermissionsAudit()` no Apps Script — sai relatório
4. **Decisão registrada** em `04 Decision/<data>-<slug>-leak-response.md`:
   - Foi acidente? Treinamento + nota.
   - Foi má fé? Counsel.
5. **Comunicação ao cliente afetado** (se aplicável) — Dr. César revisa antes do envio.

### B · Perda de chave Meld Encrypt

1. Tente recovery via Shamir split-keys (ver `obsidian/meld_encrypt_setup.md` §6)
2. Se 3 de 5 partes recuperáveis → restaure
3. Se não → **a perda é permanente**:
   - Notas existentes em PII-RESTRICTED ficam ilegíveis para sempre
   - Solução: re-onboard dos clientes afetados; criar novas notas; ciphertext antigo permanece no Drive como dado opaco
4. **Audit note**: registra a perda, registra quais clientes foram afetados, registra plano de re-onboarding
5. **Counsel + Cachola Tech**: notificação obrigatória dentro de 24h

### C · Drift de permissão crítico (folder com público em "anyone with link")

1. **Imediato**: na UI do Drive, mude pro modo "Restricted"
2. **Ledger**: verifique o ledger pra entender quando aconteceu (`grep "permission.drift" .audit/document-audit.jsonl`)
3. **Severidade**: se a folder afetada tem PII, é **incidente crítico**:
   - Notificar clientes afetados (com Dr. César)
   - Notificar a Cachola Tech como advisor
   - Considerar notificação à ANPD (LGPD art. 48 — se os dados pessoais foram acessados por não-autorizados)
4. **Lições**: um update no `02 Policy/permissions_policy.md` evitando recorrência

### D · Apps Script comprometido (alguém editou sem autorização)

1. **Pausar imediatamente**: `uninstallAuditTriggers()` (se você ainda tem acesso)
2. **Comparar** com a versão canônica no repo `batiste/apps/governance-vault/apps_script/`
3. **Restaurar** copiando os arquivos canônicos por cima (e re-fillando 00_config.gs)
4. **Reinstalar triggers**: `installAuditTriggers()`
5. **Audit**: rode `runPermissionsAudit()` — vai mostrar quem editou recentemente (Drive activity log do Apps Script project)

### E · E-mail de cliente questionando integridade ("este post foi alterado depois?")

1. **Não responda imediatamente** — primeiro busque a evidência:
   - Procure o arquivo no vault → leia o `manifest.json` ao lado
   - Compare a SHA do arquivo entregue ao cliente com a do `manifest.json`
   - Se baterem → você tem prova: `shasum -a 256 <arquivo>` reproduz a SHA do manifest
2. **Resposta padrão** (após verificar):
   - "Verificamos. SHA-256 do arquivo bate com o manifest emitido em <data>. Anexamos o manifest e o resultado da verificação."
3. **Se não baterem** → é incidente real. Vai pra A (leak) ou C (drift) acima.

### F · Cliente offboarding (saída programada)

1. Decisão registrada em `04 Decision/<data>-offboard-<slug>.md`
2. **Preserve audit history**: NUNCA delete `06 Audit/<*>` referente ao cliente
3. Mova `05 Memory/<slug>/` → `05 Memory/_archived/<slug>_<data-saida>/`
4. Revogue IAM (Drive UI)
5. Final: Audit note `06 Audit/<data>-CLIENT-OFFBOARD-<slug>.md` registrando

---

## SLA de comunicação

| Severidade | Comunicação interna | Cliente afetado | ANPD (LGPD) |
|---|---|---|---|
| **Crítica** (leak confirmado, key perdida) | <30 min | <2h após Counsel autorizar | <72h se aplicável |
| **Alta** (drift público, audit failing) | <2h | só se confirmado leak | só se confirmado |
| **Média** (drift interno, mis-classification) | <24h | não | não |
| **Baixa** (audit passing, anomalia menor) | EOD | não | não |

## Templates de comunicação

Em `_templates/incident_email_<categoria>.md` (a criar conforme cada categoria for usada pela primeira vez). Manter como histórico para padronizar futuras respostas.
