# Card 1 página · PII Daily · Imprimir e colar no monitor

```
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║          AGÊNCIA <NOME> · GOVERNANCE VAULT · PII CARD         ║
║                                                               ║
╠═══════════════════════════════════════════════════════════════╣
║                                                               ║
║  REGRA-MÃE                                                    ║
║                                                               ║
║  Toda nota com nome de cliente, CNPJ/CPF, e-mail, valor       ║
║  financeiro ou conteúdo de brief vai com:                     ║
║                                                               ║
║      classification: PII-RESTRICTED                           ║
║                                                               ║
║  E todo span sensível dentro dela vai entre:                  ║
║                                                               ║
║      %%🔐α ...ciphertext... α🔐%%                              ║
║                                                               ║
╠═══════════════════════════════════════════════════════════════╣
║                                                               ║
║  COMO ENCRIPTAR (15 segundos)                                 ║
║                                                               ║
║   1. Selecione o texto sensível                               ║
║   2. ⌘-P → "Meld Encrypt: Encrypt selection"                  ║
║   3. Pronto — o texto vira %%🔐α ... α🔐%%                     ║
║                                                               ║
║  COMO LER (10 segundos)                                       ║
║                                                               ║
║   1. Cursor sobre o bloco encrypted                           ║
║   2. ⌘-P → "Meld Encrypt: Decrypt in place"                   ║
║   3. (depois de copiar/citar): ⌘-P → "Encrypt"                ║
║                                                               ║
╠═══════════════════════════════════════════════════════════════╣
║                                                               ║
║  CHECKS DE FIM-DE-DIA (5 minutos)                             ║
║                                                               ║
║   ☐  EOD digest gerado?                                       ║
║   ☐  Notas PII-RESTRICTED criadas hoje têm ciphertext?        ║
║   ☐  Drive sync ON?                                           ║
║   ☐  Laptop com lock screen ativo?                            ║
║                                                               ║
╠═══════════════════════════════════════════════════════════════╣
║                                                               ║
║  EM CASO DE INCIDENTE                                         ║
║                                                               ║
║      1. Pare. Não delete nada.                                ║
║      2. Crie 06 Audit/<data>-INCIDENT-<slug>.md              ║
║      3. WhatsApp gestora + Cachola Tech + Dr. César           ║
║      4. Siga sop/SOP_INCIDENTE.md                             ║
║                                                               ║
╠═══════════════════════════════════════════════════════════════╣
║                                                               ║
║   Cachola Tech advisor:  jardhel@cachola.tech                 ║
║   Counsel da casa:       cesar@cesarfazio.adv.br              ║
║                          +55 (11) 3063-0811                   ║
║                                                               ║
║   Vault root:  ~/Drive/_Governanca_Obsidian/                  ║
║   Apps Script: script.google.com (no favoritos)               ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
```

---

## Como imprimir

1. Cole o bloco acima em qualquer editor monospace (TextEdit em "Plain Text", VS Code, Notepad).
2. Use fonte Menlo ou Consolas, tamanho 9-10pt.
3. Imprima em A5 ou meia A4. Recorte. Cole no monitor da gestora.
4. Quando trocar de Cachola Tech advisor / counsel / vault path, reimprima.

A função desse card é **psicológica** tanto quanto operacional: a gestora vê o card em todo zoom de cliente, e isso reforça que governança não é "só pra contrato grande" — é hábito diário.
