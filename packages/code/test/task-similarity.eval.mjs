#!/usr/bin/env node
// Mede precisao/recall dos limiares de similaridade contra pares rotulados a mao do TaskLog real.
//   batiste-direct manage_task '{"action":"list"}' > /tmp/tl.json
//   node packages/code/test/task-similarity.eval.mjs /tmp/tl.json [--list]
// Rotulos: test/fixtures/tasklog-labeled-pairs.json (prefixos de id). Pares nao rotulados = distintos (D).
// Labels identicos sao colapsados num representante (senao 11 copias de 'proposta-gerada-...' inflam a metrica).
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as S from '../src/mcp/task-similarity.ts';

const file = process.argv[2];
if (!file) { console.error('uso: task-similarity.eval.mjs <tasklog.json> [--list]'); process.exit(2); }
const tasks = JSON.parse(fs.readFileSync(file, 'utf8')).tasks;
const labels = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/tasklog-labeled-pairs.json'), 'utf8'));
const norm = (l) => String(l).trim().toLowerCase();
const rep = new Map(); const repOf = new Map();
for (const t of tasks) { const k = norm(t.label); if (!rep.has(k)) rep.set(k, t.id); repOf.set(t.id, rep.get(k)); }
const byPrefix = (p) => tasks.find((t) => t.id.startsWith(p));
const key = (a, b) => [a, b].sort().join('|');
const gold = new Map();
const add = (arr, cls) => { for (const [a, b] of arr) { const A = repOf.get(byPrefix(a).id), B = repOf.get(byPrefix(b).id); if (A !== B) gold.set(key(A, B), cls); } };
add(labels.related, 'R'); add(labels.same, 'S');
const reps = [...new Set(repOf.values())].map((id) => tasks.find((t) => t.id === id));
const ix = S.buildIndex(tasks);
const rows = [];
for (let i = 0; i < reps.length; i++) for (let j = i + 1; j < reps.length; j++) {
  const r = S.scoreIndexed(ix, reps[i].id, reps[j].id);
  rows.push({ a: reps[i], b: reps[j], score: r.score, cls: gold.get(key(reps[i].id, reps[j].id)) ?? 'D' });
}
const pm = (pred, pos) => {
  const tp = rows.filter((r) => pred(r) && pos(r)).length, fp = rows.filter((r) => pred(r) && !pos(r)).length, fn = rows.filter((r) => !pred(r) && pos(r)).length;
  return { tp, fp, fn, precision: tp + fp ? +(tp / (tp + fp)).toFixed(3) : null, recall: tp + fn ? +(tp / (tp + fn)).toFixed(3) : null };
};
const identicalGroups = [...rep.keys()].filter((k) => tasks.filter((t) => norm(t.label) === k).length > 1).length;
const out = {
  tarefas: tasks.length, representantes: reps.length, paresAvaliados: rows.length,
  rotulados: { S: [...gold.values()].filter((x) => x === 'S').length, R: [...gold.values()].filter((x) => x === 'R').length },
  gruposDeLabelIdentico: identicalGroups,
  mesclar_ge_0_80_vs_S: pm((r) => r.score >= S.THRESHOLD_SAME, (r) => r.cls === 'S'),
  correlata_ge_0_50_vs_SouR: pm((r) => r.score >= S.THRESHOLD_RELATED, (r) => r.cls === 'S' || r.cls === 'R'),
  faixaCorrelata_0_50_a_0_79: rows.filter((r) => r.score >= 0.5 && r.score < 0.8).length,
  distintasNaFaixaMesclar: rows.filter((r) => r.score >= 0.8 && r.cls === 'D').length,
};
console.log(JSON.stringify(out, null, 1));
if (process.argv.includes('--list')) for (const r of rows.filter((r) => r.score >= 0.4 || r.cls !== 'D').sort((x, y) => y.score - x.score)) console.log(r.score.toFixed(2), r.cls, '|', r.a.label.slice(0, 50), '|', r.b.label.slice(0, 50));
