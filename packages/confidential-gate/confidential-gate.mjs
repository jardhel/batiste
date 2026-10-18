#!/usr/bin/env node
// (pacote do Batiste desde 2026-10-18; antes em cachola_tech/tools)
// confidential-gate · prova que PDF interno sai carimbado e que peça de cliente sai limpa.
//
//   node confidential-gate.mjs <arquivo.pdf|pasta> [...mais]
//
// O que ele prova (exit 1 quando falha):
//   a) PDF interno (manifest `classificacao: "interna"`, ou INDEX.md da pasta com
//      "Classificação: interna", ou texto com credencial) tem a marca d'água
//      "CONFIDENCIAL · USO INTERNO" extraível via pdftotext em TODA página.
//   b) PDF de cliente (`classificacao: "cliente"`, ou sem declaração de interna)
//      não carrega senha, credencial nem URL de sala com token — e também não
//      carrega a marca d'água CONFIDENCIAL (incoerência: o cliente leria "interno").
//   c) Manifest `.manifest.json` ao lado do PDF precisa do campo `classificacao`
//      ("interna" | "cliente"); aceita o legado `classification: internal`.
//
// Precisa do pdftotext (poppler). Credencial = /senha/i na mesma página de um valor
// com cara de segredo, `pass=`, `AUTH_SECRET` ou token `?t=`/`&token=` em URL.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const alvos = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!alvos.length) { console.error('uso: node confidential-gate.mjs <arquivo.pdf|pasta> [...mais]'); process.exit(2); }
if (spawnSync('pdftotext', ['-v']).error) { console.error('pdftotext (poppler) não encontrado no PATH'); process.exit(2); }

const WM = /CONFIDENCIAL[·.\-–—]*USOINTERNO/i; // comparado com o texto sem espaços
// valor com cara de segredo: 8+ caracteres contíguos com letra E (dígito ou símbolo)
const TOKEN = /(?=\S{8,})(?=\S*[A-Za-z])(?=\S*[\d@#!$%*])[A-Za-z0-9@#!$%*_-]{8,}/;
// "senha" e um valor com cara de segredo na MESMA página (a diagramação separa rótulo e valor)
function credenciais(pags) {
  const achou = new Set();
  for (const p of pags) {
    if (/\bsenha\b/i.test(p) && TOKEN.test(p)) achou.add('senha com valor');
    if (/\bpass=/.test(p)) achou.add('pass=');
    if (/AUTH_SECRET/.test(p)) achou.add('AUTH_SECRET');
    if (/[?&](t|token)=[A-Za-z0-9._-]{10,}/.test(p)) achou.add('token em URL');
  }
  return [...achou];
}

function pdfs(alvo) {
  const st = fs.statSync(alvo);
  if (st.isFile()) return alvo.endsWith('.pdf') ? [alvo] : [];
  return fs.readdirSync(alvo, { recursive: true })
    .map((f) => path.join(alvo, String(f))).filter((f) => f.endsWith('.pdf') && fs.statSync(f).isFile());
}

function paginas(pdf) {
  const r = spawnSync('pdftotext', ['-raw', pdf, '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) return null;
  return r.stdout.split('\f').filter((p) => p.trim());
}

function classificacaoDe(pdf) {
  const man = `${pdf}.manifest.json`;
  if (fs.existsSync(man)) {
    const m = JSON.parse(fs.readFileSync(man, 'utf8'));
    const c = m.classificacao || ({ internal: 'interna', interna: 'interna', client: 'cliente', customer: 'cliente', cliente: 'cliente' })[m.classification];
    return { origem: 'manifest', valor: c || null, temManifest: true };
  }
  const index = path.join(path.dirname(pdf), 'INDEX.md');
  if (fs.existsSync(index) && /Classificação:\s*interna/i.test(fs.readFileSync(index, 'utf8'))) {
    return { origem: 'INDEX.md', valor: 'interna', temManifest: false };
  }
  return { origem: 'heurística', valor: null, temManifest: false };
}

let falhas = 0;
const falha = (pdf, msg) => { falhas++; console.error(`✗ ${pdf}: ${msg}`); };

for (const alvo of alvos) for (const pdf of pdfs(alvo)) {
  const pags = paginas(pdf);
  if (!pags) { falha(pdf, 'pdftotext não conseguiu ler'); continue; }
  const creds = credenciais(pags);
  const cls = classificacaoDe(pdf);
  const semMarca = pags.map((p, i) => (WM.test(p.replace(/\s+/g, '')) ? null : i + 1)).filter(Boolean);

  if (cls.temManifest && !cls.valor) { falha(pdf, 'manifest sem campo classificacao ("interna" | "cliente")'); continue; }

  if (cls.valor === 'cliente') {
    if (creds.length) falha(pdf, `peça de cliente com credencial no texto (${creds.join(', ')})`);
    if (semMarca.length < pags.length) falha(pdf, 'peça de cliente com marca d\'água CONFIDENCIAL (incoerente com a classificação)');
    if (!creds.length && semMarca.length === pags.length) console.log(`✓ ${pdf} (cliente via ${cls.origem}: sem credencial, sem marca interna)`);
    continue;
  }

  const interna = cls.valor === 'interna' || creds.length > 0;
  if (interna) {
    if (semMarca.length) falha(pdf, `interna (via ${cls.origem}${creds.length ? `; credencial: ${creds.join(', ')}` : ''}) sem a marca "CONFIDENCIAL · USO INTERNO" na(s) página(s) ${semMarca.join(', ')} de ${pags.length}`);
    else console.log(`✓ ${pdf} (interna via ${creds.length && !cls.valor ? 'credencial no texto' : cls.origem}: marca d'água nas ${pags.length} páginas)`);
  } else {
    console.log(`· ${pdf} sem classificação declarada e sem credencial: fora do escopo do gate`);
  }
}

console.log(falhas ? `\n${falhas} falha(s)` : '\nverde: tudo coerente');
process.exit(falhas ? 1 : 0);
