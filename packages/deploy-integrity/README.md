# deploy-integrity

O guardião que faltava entre "testei" e "está no ar". Três portas, uma por pergunta:

| Comando | Pergunta | Quando |
|---|---|---|
| `status` | O que está **pronto e não foi publicado**, e há quanto tempo? | início de toda sessão (gancho `SessionStart`) |
| `pre <products/x>` | O que foi testado **é** o que vai ao ar? Algum arquivo publicado aponta para arquivo ausente? | antes do deploy (`scripts/deploy-product.sh`) |
| `post <products/x>` | O que está no ar **é** o que subiu? | depois do deploy (`scripts/deploy-product.sh`) |

```bash
node packages/deploy-integrity/deploy-integrity.mjs status [--repo <raiz>] [--max-age-hours 24]
node packages/deploy-integrity/deploy-integrity.mjs pre  products/astrus-front --repo <raiz>
node packages/deploy-integrity/deploy-integrity.mjs post products/astrus-front --repo <raiz> [--host https://…]
npm test        # 14 testes, com teste de mutação (quebrar cada regra de propósito)
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

## Limites honestos

- Referências montadas em tempo de execução (`BASE + 'x' + lang + '.mp4'`) não são resolvíveis: ficam fora da
  verificação de referências. O `post` cobre o arquivo se ele estiver no stage.
- O `status` não vê arquivo **ignorado pelo git** (o `pre` vê, porque compara os stages).
- Só cobre produtos Cloudflare Pages montados pelo `pages-stage`.
