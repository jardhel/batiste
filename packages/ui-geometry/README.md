# ui-geometry

Gate de geometria de UI: prova por `getBoundingClientRect`/`elementFromPoint` que um overlay ou painel **não cobre** o elemento principal e que o elemento é **alcançável por rolagem**, em 320x568, 360x640 e 390x844. Nasceu do painel de vinheta da Urania que, no celular, cobria o formulário e o mapa (`products/urania/qa/vinhetas.spec.mjs`, 2026-10-17).

Pacote próprio (e não dentro do `ui-consistency`): o `ui-consistency` compara fontes e paridade de runtime; este mede posição e cobertura, serve a qualquer página e tem CLI e API próprias.

```bash
node packages/ui-geometry/ui-geometry.mjs <url> --target "<seletor>" [--overlay "<seletor>"] \
     [--action "click:<seletor>" | "eval:<js>"] [--end "<seletor do fim da página>"] \
     [--viewports 320x568,360x640,390x844] [--wait-ms 800]
npm test      # 4 testes: fixture que reprova (painel fixo sem espaço reservado) e fixture que passa
```

API: `checkGeometry({ url | page, target, overlay, end, action, viewports })` devolve `{ ok, falhas }`; `checarViewport(page, vp, opts)` roda um viewport numa página já aberta (para reusar dentro de um spec Playwright).

## O que afirma, por viewport

1. o alvo existe e tem área;
2. sem overflow horizontal;
3. nada cobre o topo do alvo (`elementFromPoint`);
4. rolando até o fim da página, o alvo (ou `--end`) não fica sob o overlay: alcançável. Sem `padding-bottom` reservando o espaço do painel, o fim da página nunca sai de baixo dele, e é isso que reprova.

Sai `0` (passa), `1` (reprova) ou `2` (uso). Playwright é peer: procurado em `$PLAYWRIGHT_MODULE`, `playwright`, `@playwright/test`, `$NODE_PATH` e no `ui-consistency` do monorepo. Os testes são pulados com aviso se não houver Chromium.

## Limites honestos

- Mede a posição estática do overlay depois da `--action`; overlay que se anima por mais de `--wait-ms` precisa de espera maior.
- Não substitui o click-test do produto: cobre só a geometria.

## Licença (proposta)

`UNLICENSED` + `private: true`, o padrão dos gates irmãos. A licença final é do founder.
