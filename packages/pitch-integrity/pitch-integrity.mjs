#!/usr/bin/env node
// =============================================================================
//  Batiste · pitch-integrity gate — fecha a porta pro teatro de demo.
//
//  Doutrina da casa (integridade comercial inegociável): um artefato de
//  pitch/demo só "passa" se as tarefas tocam arquivos REAIS e os números são
//  MEDIDOS/COMPUTADOS — nunca um gerador aleatório, um multiplicador fixo, um
//  `result: 'success'` constante, um sleep "simulate real work", ou um claim
//  "production-ready" sem proveniência. Demo bonito que vende maturidade
//  inexistente queima a confiança no produto (o produto É a disciplina).
//
//  uso:  node pitch-integrity.mjs [path] [--warn-only] [--json]
//        path        dir-alvo (default: cwd). Escaneia artefatos de pitch/demo
//                    git-tracked sob ele (examples/, demos/, e docs marcados).
//        --warn-only nada derruba (exit 0); só reporta.
//        --json      saída estruturada (CI/Batiste).
//
//  NÃO é wired no pre-commit que bloqueie (opt-in / CI), pra não travar commit.
//  Rode no fim da sessão de demo, ou no CI antes de mostrar pra investidor.
//
//  As heurísticas (cada hit = ERRO, salvo nota):
//    1. theater-success   — `result: 'success'` literal constante (nunca medido)
//    2. fake-work-sleep    — sleep/setTimeout com comentário "simulate … work/real"
//    3. random-metric      — literal de métrica (latência/p95/p99) vindo de
//                            Math.random()/jitter (gerador aleatório)
//    4. multiplier-metric  — p95/p99/latência derivado de multiplicador fixo
//                            (ex.: latencyMs * 1.4) em vez de percentil medido
//    5. production-ready   — claim "production-ready"/"prod-ready" sem proveniência
//                            (sem link/teste/commit/medição ao lado)
//    6. ghost-target       — referência a arquivo-alvo (path com extensão) que
//                            o demo "processa" mas que não existe no repo
// =============================================================================
import { execSync } from "node:child_process";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, relative, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";

const IS_MAIN = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

// --- quais arquivos são "artefato de pitch/demo" ------------------------------
// examples/ e demos/ no path; e docs/ explicitamente marcados como demo/pitch.
// Código real fora dessas pastas NÃO é escaneado (este gate é sobre o que o
// investidor VÊ rodar, não sobre a engine).
export function isPitchArtifact(relPath) {
  const p = relPath.replace(/\\/g, "/");
  if (/(^|\/)node_modules\//.test(p)) return false;
  if (/(^|\/)(examples?|demos?)\//.test(p)) return true;
  // docs marcados: nome contém demo|pitch|investor|deck
  if (/(^|\/)docs?\//.test(p) && /(demo|pitch|investor|deck)/i.test(p)) return true;
  return false;
}

// só faz sentido escanear conteúdo de texto/código
export function isScannable(relPath) {
  return /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|md|mdx|txt|json|sh)$/i.test(relPath);
}

// --- proveniência: o claim "production-ready" tem evidência ao lado? ----------
// Aceita se na MESMA linha (ou na seguinte, passada como `next`) houver sinal de
// prova verificável: link http, caminho de teste/spec, hash de commit, ou número
// com unidade de medição real (ms/req medido em benchmark referenciado).
const PROVENANCE_RX = [
  /https?:\/\/\S+/i,
  /\b[a-f0-9]{7,40}\b.*\b(commit|sha|rev)\b|\b(commit|sha|rev)\b.*\b[a-f0-9]{7,40}\b/i,
  /\.(test|spec)\.[a-z]+/i,
  /\bbenchmark(ed|s)?\b|\bmeasured\b|\bmedid[ao]\b/i,
  /\bnpm (run|test)\b|\bnode --test\b|\bvitest\b|\bplaywright\b/i,
];
function hasProvenance(line, next = "") {
  const ctx = `${line}\n${next}`;
  return PROVENANCE_RX.some((rx) => rx.test(ctx));
}

// --- extrai paths-alvo que o demo afirma "processar" --------------------------
// Heurística: string-literal com extensão de arquivo de dado/código que aparece
// como ALVO de trabalho (analyse/extract/query/index/process/parse/run on …),
// ou em campo tipo label/path/file. Devolve [{ ref, line }].
const TARGET_EXT_RX = /\.(ts|tsx|js|jsx|py|csv|pdf|json|xlsx?|sql|parquet|md)\b/i;
const WORK_VERB_RX = /\b(analy[sz]e|extract|query|index|process|parse|summari[sz]e|run\b.*\bon|scan|read|load|ingest|etl)\b/i;
export function extractTargets(text) {
  const out = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // ignora linhas de módulo (import/require/export/from) — especificador de
    // módulo não é "arquivo-alvo de dado" que o demo processa.
    if (/\b(import|export|require)\b/.test(line) && /\bfrom\b|\(/.test(line)) continue;
    if (/^\s*(import|export)\b/.test(line)) continue;
    // só linhas que cheiram a "trabalho sobre um arquivo": verbo de trabalho OU
    // campo label/path/file/source perto de um literal com extensão.
    const isWorky = WORK_VERB_RX.test(line) || /\b(label|path|file|source|target|input)\b\s*[:=]/i.test(line);
    if (!isWorky) continue;
    // descarta o pedaço de path de QUALQUER URL http(s) na linha — o alvo de um
    // demo honesto é arquivo local versionado, não recurso remoto.
    const lineNoUrls = line.replace(/https?:\/\/\S+/gi, " ");
    // extrai TOKENS de caminho (sem espaço/aspas) terminados em extensão de
    // arquivo — mesmo embutidos em prosa entre aspas ("Analyse src/foo.ts").
    const toks = lineNoUrls.match(/[A-Za-z0-9._/\\-]+\.[A-Za-z0-9]{1,6}\b/g) || [];
    for (const tok of toks) {
      const ref = tok.replace(/^["'`/]+|["'`]+$/g, "");  // tira aspas e // de borda
      if (!ref || !TARGET_EXT_RX.test(ref)) continue;
      if (/^https?:/i.test(ref) || ref.startsWith("//")) continue; // URL
      if (/[*?{}]/.test(ref)) continue;          // glob, não alvo concreto
      // descarta "extensões" que são na verdade chamada/propriedade de método
      // (ex.: registry.list, foo.bar) — só conta se parece nome de arquivo:
      // tem separador de path OU a extensão é de dado/código conhecida.
      const looksLikeFile = ref.includes("/") || ref.includes("\\") || TARGET_EXT_RX.test("." + ref.split(".").pop());
      if (!looksLikeFile) continue;
      out.push({ ref, line: i + 1 });
    }
  }
  return out;
}

// --- núcleo puro: escaneia o TEXTO de um artefato -----------------------------
// Devolve findings de conteúdo (1..5). O check 6 (ghost-target) precisa do
// filesystem e roda no CLI usando extractTargets + resolução no repo.
export function scanSource(text, { file = "<mem>" } = {}) {
  const findings = [];
  const add = (check, line, msg) => findings.push({ check, level: "error", file, line, msg });
  const lines = text.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const ln = i + 1;
    const next = lines[i + 1] || "";

    // 1. theater-success — result constante 'success'/'ok'/'pass' como literal.
    //    (medido seria `result: ok ? 'success' : 'fail'` ou vindo de var.)
    //    NÃO acende em: anotação de tipo TS (`'success' | 'error'`), nem em
    //    declaração mutável (`let result: ... = 'success'`) que é reatribuída
    //    do trabalho real — só no EMIT de um literal fixo como resultado.
    const succ = line.match(/\bresult\s*:\s*(['"`])(success|ok|pass(ed)?)\1/i);
    if (succ) {
      const after = line.slice(succ.index + succ[0].length);
      const isTypeUnion = /^\s*\|/.test(after);                 // 'success' | 'error'
      const isMutableDecl = /\b(let|var)\b[^=]*\bresult\b/.test(line); // let result: T = 'success'
      const isTernaryNearby = /\?[^:]*:/.test(line);            // já computa fallback
      if (!isTypeUnion && !isMutableDecl && !isTernaryNearby) {
        add("theater-success", ln,
          `result fixo em literal '${succ[2]}' — resultado de tarefa precisa ser computado do trabalho real, não hard-coded`);
      }
    }

    // 2. fake-work-sleep — sleep/setTimeout com comentário "simulate … work/real"
    if (/\b(sleep|setTimeout|delay|wait)\b/i.test(line) &&
        /\/\/.*\b(simulat\w*|fake|pretend|mock)\b.*\b(work|real|latency|process\w*|delay)\b/i.test(line)) {
      add("fake-work-sleep", ln,
        `sleep/delay marcado como "simulate real work" — demo deve EXECUTAR trabalho real, não dormir fingindo`);
    }
    // variante: comentário "simulate real work" sozinho na linha de um delay
    else if (/\/\/\s*simulate\s+real\s+work/i.test(line)) {
      add("fake-work-sleep", ln,
        `comentário "simulate real work" — trabalho fingido com sleep não é demo honesto`);
    }

    // 3. random-metric — métrica (latência/duração/p95/p99/score) vinda de random
    if (/\b(Math\.random|crypto\.randomInt|faker\.)/i.test(line) &&
        /\b(latency|laten[cs]\w*|ms\b|duration|p50|p95|p99|throughput|score|reliab\w*|metric)\b/i.test(line)) {
      add("random-metric", ln,
        `métrica derivada de gerador aleatório — número de pitch tem que ser MEDIDO, não sorteado`);
    }
    // variante: função "jitter(base,...)" usada como fonte de latência
    if (/\bjitter\s*\(/.test(line) && /\b(latency|laten\w*|ms|delay|duration)\b/i.test(line)) {
      add("random-metric", ln,
        `latência vinda de jitter()/aleatório — substituir por medição real (Date.now() em torno do trabalho)`);
    }
    // a própria DEFINIÇÃO de um jitter de métrica também é tell
    if (/function\s+jitter\b|const\s+jitter\s*=/.test(line) && /random/i.test(text.slice(text.indexOf(line), text.indexOf(line) + 200))) {
      // só sinaliza se o helper é claramente de métrica (usa Math.random)
      add("random-metric", ln,
        `helper jitter() baseado em Math.random — fonte de "latência simulada"; medir, não simular`);
    }

    // 4. multiplier-metric — p95/p99/latência por multiplicador fixo
    //    ex.: latencyMs * 1.4   |   p99 = base * 1.9
    const multm = line.match(/\b(p9[59]|p50|latency\w*|laten\w*|ms)\b[^=\n]*[*]\s*([0-9]+\.[0-9]+)/i)
               || line.match(/[*]\s*([0-9]+\.[0-9]+)\b[^/\n]*\b(p9[59]|latency\w*)/i);
    if (multm) {
      add("multiplier-metric", ln,
        `percentil/latência por multiplicador fixo (× constante) — p95/p99 tem que sair da distribuição medida, não de um fator inventado`);
    }

    // 5. production-ready — claim sem proveniência ao lado.
    //    NÃO acende quando o termo está NEGADO (negação do claim: "there is no
    //    production-ready claim", "não é production-ready"), o que é honestidade,
    //    não teatro.
    const PR_RX = /\b(production[\s-]?ready|prod[\s-]?ready|enterprise[\s-]?grade|battle[\s-]?tested)\b/i;
    if (PR_RX.test(line)) {
      const m = line.match(PR_RX);
      const before = line.slice(0, m.index);
      const negated = /\b(no|not|never|without|n't|sem|n[ãa]o|nunca)\b[^.]*$/i.test(before)
                   || /\bnão é\b|\bisn'?t\b|\baren'?t\b/i.test(line);
      if (!negated && !hasProvenance(line, next)) {
        add("production-ready", ln,
          `claim "production-ready"/equivalente sem proveniência (sem link/teste/commit/medição ao lado) — marcar "no roadmap" ou anexar prova verificável`);
      }
    }
  }
  return findings;
}

// =============================================================================
//  CLI
// =============================================================================
if (IS_MAIN) {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith("--")));
  const target = resolve(args.find((a) => !a.startsWith("--")) || ".");
  const WARN_ONLY = flags.has("--warn-only");
  const JSON_OUT = flags.has("--json");

  const git = (cmd, cwd) =>
    execSync(`git ${cmd}`, { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();

  let root = null;
  try { root = git("rev-parse --show-toplevel", target); } catch { /* */ }

  const findings = [];
  const add = (check, level, file, line, msg) => findings.push({ check, level, file, line, msg });

  if (!root) {
    add("setup", "error", String(target), 0,
      `'${target}' não está em repositório git — pitch-integrity escaneia arquivos git-tracked`);
  } else {
    const relTarget = relative(root, target) || ".";
    const underTarget = (p) => relTarget === "." || p === relTarget || p.startsWith(relTarget + "/");

    let tracked = [];
    try { tracked = git("ls-files", root).split("\n").filter(Boolean).filter(underTarget); } catch { /* */ }

    const artifacts = tracked.filter(isPitchArtifact).filter(isScannable);
    // índice de existência pra resolver ghost-targets. Inclui arquivos
    // git-tracked E untracked-no-disco (fixture recém-criado, ainda não
    // commitado, conta como real — existe no disco). Exclui ignorados de fato
    // (node_modules) via --exclude-standard.
    let onDiskFiles = tracked.slice();
    try {
      const untracked = git("ls-files --others --exclude-standard", root)
        .split("\n").filter(Boolean).filter(underTarget);
      onDiskFiles = onDiskFiles.concat(untracked);
    } catch { /* */ }
    const trackedSet = new Set(onDiskFiles.map((p) => p.replace(/\\/g, "/")));
    const trackedBasenames = new Set(onDiskFiles.map((p) => p.split("/").pop()));

    for (const rel of artifacts) {
      let text = "";
      try { text = readFileSync(join(root, rel), "utf8"); } catch { continue; }

      // checks 1..5 (conteúdo, puros)
      for (const f of scanSource(text, { file: rel })) {
        add(f.check, f.level, f.file, f.line, f.msg);
      }

      // check 6 — ghost-target: alvo "processado" que não existe em lugar nenhum.
      for (const { ref, line } of extractTargets(text)) {
        const norm = ref.replace(/^\.\//, "").replace(/\\/g, "/");
        const base = norm.split("/").pop();
        // variantes de extensão pra fonte TS importada como .js (.js→.ts/.tsx/.mts)
        const variants = [norm];
        if (/\.(m?js|cjs)$/i.test(norm)) variants.push(norm.replace(/\.(m?js|cjs)$/i, ".ts"), norm.replace(/\.(m?js|cjs)$/i, ".tsx"), norm.replace(/\.(m?js|cjs)$/i, ".mts"));
        // existe se: no disco (relativo à raiz OU ao dir do artefato), ou tracked
        // (exato/por basename). Fixtures recém-criados (untracked) contam por disco.
        const onDisk = variants.some((v) =>
          [join(root, v), join(root, rel, "..", v)].some((c) => {
            try { return statSync(c).isFile(); } catch { return false; }
          }));
        const inTracked = variants.some((v) => trackedSet.has(v)) || trackedBasenames.has(base);
        if (!onDisk && !inTracked) {
          add("ghost-target", "error", rel, line,
            `referencia arquivo-alvo inexistente '${ref}' — demo afirma processar um arquivo que não existe no repo (teatro). Use um fixture real e versionado.`);
        }
      }
    }

    if (!artifacts.length) {
      add("info", "warn", relTarget, 0, "nenhum artefato de pitch/demo encontrado sob o alvo (examples/, demos/, docs marcados)");
    }
  }

  // relatório + exit
  const errors = findings.filter((f) => f.level === "error");
  const warns = findings.filter((f) => f.level === "warn");

  if (JSON_OUT) {
    console.log(JSON.stringify({ target, root, pass: errors.length === 0, errors, warns }, null, 2));
  } else {
    const icon = { error: "✗", warn: "⚠" };
    if (!findings.length) {
      console.log("✓ pitch-integrity OK — nenhum teatro de demo detectado");
    } else {
      for (const f of findings) {
        const loc = f.line ? `${f.file}:${f.line}` : f.file;
        console.log(`${icon[f.level]} [${f.check}] ${loc}\n    ${f.msg}`);
      }
      console.log(`\n${errors.length} erro(s), ${warns.length} aviso(s).`);
    }
  }

  try {
    const audit = await import("@batiste-aidk/audit");
    if (audit?.smoke) audit.smoke("pitch-integrity", { errors: errors.length, warns: warns.length });
  } catch { /* opcional */ }

  process.exit(WARN_ONLY ? 0 : errors.length ? 1 : 0);
}
