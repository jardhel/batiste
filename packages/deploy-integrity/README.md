# deploy-integrity

O guardião que faltava entre "testei" e "está no ar". Três portas, uma por pergunta:

| Comando | Pergunta | Quando |
|---|---|---|
| `status` | O que está **pronto e não foi publicado**, e há quanto tempo? | início de toda sessão (gancho `SessionStart`) |
| `pre <products/x>` | O que foi testado **é** o que vai ao ar? Algum arquivo publicado aponta para arquivo ausente? | antes do deploy (`scripts/deploy-product.sh`) |
| `post <products/x>` | O que está no ar **é** o que subiu? | depois do deploy (`scripts/deploy-product.sh`) |
| `prova-no-ar <url>` | Posso dizer "no ar" **desta** URL? | antes de escrever "no ar" em qualquer relato |
| `resolve <products/x>` | Qual projeto Pages e host o DEPLOYMENTS.md registra para o produto? | `scripts/deploy-product.sh` sem `--project-name`/`--host` |

```bash
node packages/deploy-integrity/deploy-integrity.mjs status [--repo <raiz>] [--max-age-hours 24]
node packages/deploy-integrity/deploy-integrity.mjs pre  products/astrus-front --repo <raiz>
node packages/deploy-integrity/deploy-integrity.mjs post products/astrus-front --repo <raiz> [--host https://…]
node packages/deploy-integrity/deploy-integrity.mjs resolve products/urania --repo <raiz>      # projeto<TAB>host, ou exit 2
node packages/deploy-integrity/deploy-integrity.mjs prova-no-ar https://urania.cachola.tech/ [--produto products/urania] [--commit <sha>] [--work] --repo <raiz>
npm test        # 22 testes, com teste de mutação (quebrar cada regra de propósito)
```

Sai `0` (passa), `1` (**bloqueia**) ou `2` (uso).

## Por que existe

Em 2026-10-16 a produção do Astrus estava em versão anterior enquanto 61 arquivos testados esperavam, sem
commit, na pasta de trabalho, e o site ia receber tráfego de um portal. O `deploy-lineage` já barra deploy de
árvore suja, mas ninguém barrava a **espera**. O `repo-hygiene` acusava `git-clean`, só que o gancho de abertura
da sessão cortava a saída com `tail`, então o erro nunca aparecia.

## O que cada porta faz

- **`pre`** monta o stage da pasta de trabalho e o stage do commit (`--from HEAD`) com o `tools/pages-stage` da
  casa e compara arquivo a arquivo (sha256, `public/` e `functions/`). Qualquer diferença bloqueia: o commit é a
  unidade testada e publicada. Depois varre `href`, `src`, `poster`, `url()` e caminhos absolutos em HTML, CSS e JS
  do que vai ao ar; referência a arquivo ausente bloqueia. O `_redirects` com `/* → /index.html` não mascara
  nada. Exceções conhecidas: `.deploy-integrity.json` do produto, `{"ignoreRefs": ["/caminho", "/prefixo/*"]}`.
- **`post`** (HTML: sha256 do corpo normalizado — sem `_di`, beacon/e-mail-decode da Cloudflare, espaço final; divergência = `HTML no ar difere do commit XXXX: <rota>`; opt-out `{"htmlDynamic": ["app/", "x.html"]}` no `.deploy-integrity.json`; gated fica fora) baixa cada arquivo do stage no host vivo (com `?_di=` para furar o cache de borda) e exige: HTTP 200,
  tipo de conteúdo plausível para a extensão e o mesmo sha256. **`text/html` num `.js`, `.css` ou `.mp4` é a
  assinatura do arquivo que não subiu:** o Pages devolve a página inicial com 200 no lugar.
- **`status`** é local e rápido (produto sem mudança no git nem monta stage). Bloqueia quando há arquivo público
  pronto e fora do commit há mais que `--max-age-hours`.

## prova-no-ar: o gate do relato

Use **antes** de dizer "no ar" a alguém. Para UMA url faz o que o `post` faz por arquivo: HTTP 200, `content-type` plausível para a extensão (`text/html` num `.js` é o arquivo que não subiu) e corpo igual ao do stage do commit (HTML normalizado; demais por sha256). Só então imprime `NO AR: <url> (...)` e sai `0`; qualquer divergência imprime `NÃO PROVADO no ar` com o motivo e sai `1`. Produto vem de `--produto` ou do host no DEPLOYMENTS.md; o commit padrão é o HEAD (`--commit <sha>` escolhe outro, `--work` compara com a árvore de trabalho). Caminho gated e HTML `htmlDynamic` não são comparáveis anonimamente: reprovam com a explicação, nunca passam em silêncio. Rota que não existe no stage reprova (o Pages teria devolvido a página inicial com 200).

## resolve: deploy sem adivinhar

`resolve` lê o DEPLOYMENTS.md (`produtosRegistrados`) e devolve projeto e host. Produto não registrado, ou com mais de um projeto/host, sai `2` com a lista do que existe: o `deploy-product.sh` usa isso quando faltam `--project-name`/`--host` e **falha alto** em vez de inferir pelo nome da pasta.

## Limites honestos

- Referências montadas em tempo de execução (`BASE + 'x' + lang + '.mp4'`) não são resolvíveis: ficam fora da
  verificação de referências. O `post` cobre o arquivo se ele estiver no stage.
- O `status` não vê arquivo **ignorado pelo git** (o `pre` vê, porque compara os stages).
- Só cobre produtos Cloudflare Pages montados pelo `pages-stage`.
