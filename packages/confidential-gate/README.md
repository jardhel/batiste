# confidential-gate

Gate de confidencialidade de PDF: prova por shell que peça interna sai carimbada e que peça de cliente sai limpa. Nasceu no kit da reunião do Hefesto (releases/2026-10-18-hefesto-kit-reuniao-v3), quando a senha da sala de demonstração passou a viver em papel impresso.

```bash
node packages/confidential-gate/confidential-gate.mjs <arquivo.pdf|pasta> [...mais]
```

O que ele prova (exit 1 quando falha):

1. PDF interno precisa da marca d'água "CONFIDENCIAL · USO INTERNO" extraível via pdftotext em toda página. Conta como interno quem tem `classificacao: "interna"` no `.manifest.json` ao lado, ou `Classificação: interna` no INDEX.md da pasta, ou credencial no próprio texto (`senha` na mesma página de um valor com cara de segredo, `pass=`, `AUTH_SECRET`, token `?t=` em URL).
2. PDF de cliente (`classificacao: "cliente"`) não pode carregar credencial nem a marca CONFIDENCIAL (o cliente leria "uso interno" numa peça feita para ele).
3. Manifest presente precisa do campo `classificacao` (`"interna"` ou `"cliente"`); o legado `classification: internal` do docgen é aceito.

PDF sem manifest, sem INDEX interno e sem credencial fica fora do escopo e é só listado. Precisa do pdftotext (poppler, `brew install poppler`). A comparação da marca remove os espaços antes do regex, porque texto girado sai fatiado do pdftotext.


Testes: `npm test` (6 casos, PDFs mínimos gerados na hora pelo próprio teste; pulados com aviso se o `pdftotext` faltar).

## Licença (proposta)

`UNLICENSED` + `private: true`, o mesmo padrão dos gates irmãos (`repo-hygiene`, `credential-preflight`, `ui-consistency`). Proposta: a licença final é do founder.
