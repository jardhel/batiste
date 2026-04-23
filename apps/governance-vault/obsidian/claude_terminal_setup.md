# Terminal in Obsidian + Claude Code — Cockpit Setup

> **Tempo:** 15 min · **Custo:** zero · **Plataforma:** Obsidian desktop (macOS, Windows, Linux). **NÃO funciona no Obsidian mobile** (sandbox iOS/Android).
> **Pré-requisito:** Obsidian instalado + vault aberto + Claude Code instalado (ou Claude Desktop com CLI exposto).

---

## Por que isto importa

Sem terminal embutido: você alterna entre Obsidian (vault) e Terminal (Claude). Atrito. Operadora-leiga não consegue.

Com terminal embutido: **um único cockpit**. Painel esquerdo navega vault. Painel central escreve notas. Painel direito é terminal vivo rodando Claude Code. Output do Claude renderiza diretamente em notas. Audit emitter dispara após cada operação significativa.

Esta é a UX que viabiliza a tese AgencyOS — **operadora + designer + sistema = agência**. Sem o cockpit unificado, o operador vira engenheiro.

---

## 1 · Instalar o plugin (3 min)

1. Obsidian → Settings (⚙) → Community plugins
2. Se "Restricted mode" estiver ON: clique "Turn on community plugins"
3. Browse → buscar **"Terminal"** (autor: **polyipseity**)
4. Install → Enable

Verificar: barra de comando (Cmd+P) → digitar "Terminal" → comando `Terminal: Open terminal` deve aparecer.

---

## 2 · Configurar (5 min)

Settings → plugin Terminal:

**Profiles:**
- New profile: nome `cachola-tech`
- Type: `Integrated`
- Executable: `/bin/zsh` (macOS/Linux) ou `cmd.exe` (Windows)
- Args: `[]` (vazio)
- Platforms: macOS / Windows / Linux conforme aplicável
- CWD: caminho do vault (ex: `/Users/jardhel/Documents/git/cachola_tech/obs_vault/cachola_tech`)
- Auto-restart: false (você restart manualmente quando quiser limpar)

**Hotkeys:**
- Cmd+Shift+T (macOS) / Ctrl+Shift+T (Win/Linux): `Terminal: Open terminal in new pane`
- Recomendado: dock o pane do terminal à direita para layout estável

**Behavior:**
- "Auto-create on startup": false (controle manual)
- "Confirm exit": true (evita kill acidental de sessão Claude)

---

## 3 · Setar audit-emit alias no shell rc (5 min)

O cockpit só vale se cada operação significativa entra no audit ledger. Adicionar ao `~/.zshrc` (Mac/Linux) ou `~/.bashrc`:

```bash
# Cachola Tech audit emitter — usado dentro do Obsidian terminal
audit-em() {
  cd /Users/jardhel/Documents/git/cachola_tech
  STREAM="${STREAM:-cockpit}" npx tsx tools/audit-emit.ts "$@"
}
export -f audit-em 2>/dev/null || true
```

Depois: `source ~/.zshrc` (ou abrir nova aba do terminal Obsidian).

Validar: dentro do terminal Obsidian, rodar `audit-em test.cockpit '{"note":"setup ok"}'` → checar `tail -1 .audit/document-audit.jsonl`.

---

## 4 · Padrão de uso diário

Layout recomendado do Obsidian:

```
┌─────────────┬──────────────────────────┬──────────────────┐
│ FILE TREE   │ NOTE EDITOR              │ TERMINAL         │
│ (left)      │ (center)                 │ (right, docked)  │
│             │                          │                  │
│ 01 Identity │ # Plano do dia           │ $ claude         │
│ 02 Policy   │                          │ ...Claude prompt │
│ 03 Roles    │ - Stream A: Bonita G     │                  │
│ 04 Decision │ - Stream B: Dr. Dias     │ $ audit-em       │
│ 05 Memory   │                          │   stream.start   │
│ 06 Audit    │ ## prompts               │   '{...}'        │
│             │                          │                  │
└─────────────┴──────────────────────────┴──────────────────┘
```

### Fluxo típico

1. **Abrir vault** (Cmd+O ou só atalho do desktop).
2. **Abrir terminal** (Cmd+Shift+T) — dock à direita.
3. **Setar STREAM** para o trabalho do dia: `export STREAM=bonita-g` (ou outro).
4. **Anotar plano** em `05 Memory/Plano do dia/<data>.md` no painel central.
5. **Rodar Claude Code** no terminal: `claude` (interactive) ou `claude code "prompt aqui"` (one-shot).
6. **Após output significativo** do Claude: `audit-em claude.output '{"thread":"X","summary":"..."}'`
7. **Ao salvar artefato significativo**: `audit-em artifact.created '{"path":"...","sha256":"$(shasum -a 256 X | awk '{print $1}')"}'`
8. **Final do dia**: `python3 brand/eod_digest.py $(date +%Y-%m-%d)` (legacy aceitável transitório; quitação do débito = chamar o eod via Batiste API direto, target v0.2).

---

## 5 · Quick-action commands (cole no `~/.zshrc`)

```bash
# Abre vault Obsidian no Mac
vault() { open -a Obsidian /Users/jardhel/Documents/git/cachola_tech/obs_vault/cachola_tech }

# Stream switcher (avisa o audit emitter qual fluxo está ativo)
stream() { export STREAM="$1"; audit-em stream.switched "{\"to\":\"$1\"}" }

# Quick stamp (PDF) via legacy stamp.py — debt mark explícito
qstamp() {
  python3 /Users/jardhel/Documents/git/cachola_tech/brand/stamp.py "$@"
  echo "⚠ debt: stamp.py legacy. Refactor pra @batiste-aidk/audit em v0.2."
}
```

---

## 6 · Limitações conscientes

- **Mobile:** plugin não funciona em iOS/Android. Pra mobile, vault read-only via iCloud (decisão pendente do fundador) ou Drive web viewer.
- **Múltiplos vaults:** cada vault tem seu próprio profile. Não compartilhe terminal entre vaults — bagunça o STREAM e mistura audit trails.
- **Performance:** terminal embutido consome ~100-200MB RAM extra. Em laptop com <8GB, pode ficar pesado se rodar Claude Code com contexto grande simultaneamente.
- **Crash recovery:** se Obsidian crashar com terminal aberto rodando Claude longo, perde o output em buffer. Recomendado: redirecionar output longo pra arquivo: `claude code "..." | tee 05\ Memory/_logs/$(date +%s).md`

---

## 7 · O que isto desbloqueia (resumo executivo)

- **Cockpit unificado** — operadora-leiga não precisa entender git, npm, ou o que é "terminal".
- **Audit por construção** — cada operação significativa deixa rastro no ledger sem o operador pensar nisso (graças aos aliases).
- **Replicável** — esse setup é a peça que falta pra a tese AgencyOS escalar. Cada nova operadora roda esse setup uma vez (15 min) e está em produção.

---

## 8 · Audit deste próprio doc

Este doc é parte do framework `batiste/apps/governance-vault/obsidian/`. Verificável:

```
ls /Users/jardhel/Documents/git/batiste/apps/governance-vault/obsidian/claude_terminal_setup.md
shasum -a 256 /Users/jardhel/Documents/git/batiste/apps/governance-vault/obsidian/claude_terminal_setup.md
```

Não está stampado (escrito em sessão raw 2026-04-23 noite, débito explícito) — vai ser stampado via Batiste audit-emit em Stream A da próxima sessão.
