# Batiste no seu Claude Code — guia de 5 minutos

Este guia liga o **Batiste** dentro do seu **Claude Code**. Depois disso, o Claude
ganha ferramentas novas (lista de tarefas, busca de código, índice do projeto, etc.)
que aparecem em **qualquer pasta** que você abrir.

Você **não precisa ser programador**. É copiar e colar 3 comandos.

---

## O que você precisa antes (só uma coisa de verdade)

1. **Node** instalado. É o programa que faz o Batiste rodar — não dá pra remover.
   - Tem? Abra o **Terminal** (no Mac: aperte `Cmd + Espaço`, digite `Terminal`, Enter)
     e digite `node -v`. Se aparecer algo como `v20...` ou `v22...`, está pronto.
   - Não tem? Baixe o instalador em **https://nodejs.org** (botão verde "LTS"),
     instale clicando "next/avançar" até o fim, e feche e abra o Terminal de novo.

2. **Claude Code** instalado (o `claude` que você já usa no Terminal).
   - Tem? Digite `claude --version`. Se aparecer um número, está pronto.
   - Não tem? Digite isto e dê Enter:
     ```
     npm install -g @anthropic-ai/claude-code
     ```

> O `git` também precisa existir pra baixar o Batiste. No Mac, ao digitar `git`
> pela primeira vez, ele se oferece pra instalar — é só aceitar.

---

## Passo a passo (copie e cole, um de cada vez)

**1) Baixe o Batiste** (cria uma pasta `batiste` na sua Home):

```
git clone https://github.com/jardhel/batiste.git ~/batiste
```

**2) Entre na pasta:**

```
cd ~/batiste
```

**3) Rode o instalador:**

```
bash scripts/install-claude-code.sh
```

Esse comando faz tudo sozinho: baixa o que falta, prepara o Batiste, testa, e liga
no seu Claude Code. Na **primeira vez** ele pode demorar alguns minutos — é normal,
deixe rodar até aparecer a mensagem verde **"Pronto!"**.

---

## Pronto. Como usar?

Abra **qualquer** pasta no Terminal e rode `claude` como você já faz. As ferramentas
do Batiste começam com `mcp__batiste__`. Por exemplo, peça pro Claude:

> "Use o batiste pra listar minhas tarefas."

Para conferir que ficou ligado, rode:

```
claude mcp list
```

Você deve ver uma linha **`batiste: ... ✔ Connected`**.

---

## Se algo der errado

- **"command not found: node"** → o Node não está instalado. Volte ao passo do Node acima.
- **"command not found: claude"** → instale o Claude Code (comando `npm install -g ...` acima).
- **O instalador parou com mensagem vermelha** → ele diz o que falta. Geralmente é
  Node desatualizado: baixe a versão **LTS** mais nova em https://nodejs.org e rode
  o passo 3 de novo.
- **Quer desligar o Batiste?** Na pasta `~/batiste`, rode:
  ```
  bash scripts/install-claude-code.sh --remove
  ```

---

## Atualizar para uma versão nova (de vez em quando)

```
cd ~/batiste
git pull
bash scripts/install-claude-code.sh
```

Pronto — sem segredo. Made in Eindhoven.
