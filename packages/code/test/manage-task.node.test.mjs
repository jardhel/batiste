// Testes de ponta a ponta do contrato de manage_task via CLI real (dist/direct-cli.js).
// node --test packages/code/test/   (exige `pnpm --filter @batiste-aidk/code build` antes)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'direct-cli.js');
const sandbox = () => mkdtempSync(join(tmpdir(), 'bt-mt-'));

function run(root, ...argv) {
  const r = spawnSync(process.execPath, [CLI, ...argv], {
    cwd: root, encoding: 'utf8', env: { ...process.env, PROJECT_ROOT: root, DATA_DIR: join(root, '.batiste') },
  });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { /* texto */ }
  return { code: r.status, out: r.stdout, err: r.stderr, json };
}
const mt = (root, obj) => run(root, 'manage_task', JSON.stringify(obj));
const create = (root, label, extra = {}) => mt(root, { action: 'create', label, ...extra }).json.task;
const age = (root, id, seconds, status) => {
  const db = new DatabaseSync(join(root, '.batiste', 'tasks.db'));
  db.prepare("UPDATE tasks SET updatedAt = strftime('%s','now') - ?, createdAt = strftime('%s','now') - ? WHERE id = ?").run(seconds, seconds, id);
  if (status) db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run(status, id);
  db.close();
};

test('id e aceito como alias de taskId, com aviso', () => {
  const root = sandbox();
  const t = create(root, 'alias');
  const r = mt(root, { action: 'update', id: t.id, status: 'running' });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.task.status, 'running');
  assert.match(r.json.warnings[0], /alias de 'taskId'/);
});

test('taskId ausente: erro diz o campo certo e da exemplo copiavel (nunca "Task not found: undefined")', () => {
  const root = sandbox();
  for (const action of ['update', 'get', 'close', 'archive', 'renew']) {
    const r = mt(root, { action });
    assert.equal(r.code, 1);
    assert.match(r.err, /campo obrigatorio 'taskId' ausente/);
    assert.match(r.err, /Exemplo: \{"action"/);
    assert.doesNotMatch(r.err, /undefined/);
  }
  assert.doesNotMatch(mt(root, { action: 'create' }).err, /SQLite|NOT NULL/);
  assert.match(mt(root, { action: 'create' }).err, /'label' ausente/);
});

test('chave desconhecida e erro com "voce quis dizer"; update vazio e erro; get inexistente e exit 1', () => {
  const root = sandbox();
  const t = create(root, 'x');
  assert.match(mt(root, { action: 'update', taskId: t.id, staus: 'running' }).err, /voce quis dizer 'status'/);
  assert.match(mt(root, { action: 'update', taskId: t.id }).err, /nada para mudar/);
  const g = mt(root, { action: 'get', taskId: 'nao-existe' });
  assert.equal(g.code, 1);
  assert.match(g.err, /tarefa nao encontrada/);
});

test('toolOutput.toolName e opcional (padrao manual)', () => {
  const root = sandbox();
  const t = create(root, 'cache');
  const r = mt(root, { action: 'update', taskId: t.id, toolOutput: { output: { ok: 1 } } });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(Object.keys(r.json.task.context.toolOutputs), ['manual']);
});

test('--help real: por ferramenta e por acao; JSON invalido da erro legivel', () => {
  const root = sandbox();
  const h = run(root, 'manage_task', '--help');
  assert.equal(h.code, 0);
  for (const a of ['close', 'archive', 'renew', 'triage']) assert.match(h.out, new RegExp(a));
  const c = run(root, 'manage_task', 'close', '--help');
  assert.equal(c.code, 0);
  assert.match(c.out, /obrigatorios: taskId, proof/);
  const bad = run(root, 'manage_task', '{action:');
  assert.equal(bad.code, 1);
  assert.match(bad.err, /JSON invalido em manage_task/);
  assert.match(run(root, 'schema', 'manage_task').out, /"proof"/);
});

test('close exige proof, grava prova e fecha; completed via update exige proof/reason', () => {
  const root = sandbox();
  const t = create(root, 'fechar');
  assert.match(mt(root, { action: 'close', taskId: t.id }).err, /'proof' ausente/);
  assert.match(mt(root, { action: 'update', taskId: t.id, status: 'completed' }).err, /completed exige proof ou reason/);
  const r = mt(root, { action: 'close', taskId: t.id, proof: 'commit abc1234', links: { commit: 'abc1234' } });
  assert.equal(r.json.closed, true);
  assert.equal(r.json.task.status, 'completed');
  assert.equal(r.json.task.context.metadata.closed.proof, 'commit abc1234');
  assert.equal(r.json.task.context.metadata.links.commit, 'abc1234');
});

test('completed e terminal: sair exige reopen:true + reason', () => {
  const root = sandbox();
  const t = create(root, 'terminal');
  mt(root, { action: 'close', taskId: t.id, proof: 'p' });
  const bad = mt(root, { action: 'update', taskId: t.id, status: 'pending' });
  assert.equal(bad.code, 1);
  assert.match(bad.err, /terminal/);
  const ok = mt(root, { action: 'update', taskId: t.id, status: 'pending', reopen: true, reason: 'regrediu' });
  assert.equal(ok.json.task.status, 'pending');
});

test('archive exige reason, marca obsolete e status failed', () => {
  const root = sandbox();
  const t = create(root, 'velha');
  assert.match(mt(root, { action: 'archive', taskId: t.id }).err, /'reason' ausente/);
  const r = mt(root, { action: 'archive', taskId: t.id, reason: 'plano fora do ar' });
  assert.equal(r.json.task.status, 'failed');
  assert.equal(r.json.task.context.metadata.obsolete.reason, 'plano fora do ar');
});

test('renew grava renewedUntil com motivo e aceita +Nd', () => {
  const root = sandbox();
  const t = create(root, 'renovar');
  assert.match(mt(root, { action: 'renew', taskId: t.id, until: 'amanha', reason: 'x' }).err, /until invalido/);
  const r = mt(root, { action: 'renew', taskId: t.id, until: '+14d', reason: 'aguardando cliente' });
  assert.match(r.json.task.context.metadata.renewedUntil.until, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(r.json.task.context.metadata.renewedUntil.reason, 'aguardando cliente');
});

test('renew: teto de 45 dias, motivo >= 15 caracteres, contagem e aviso na 3a', () => {
  const root = sandbox();
  const t = create(root, 'burla');
  assert.match(mt(root, { action: 'renew', taskId: t.id, until: '2099-01-01', reason: 'um motivo longo o bastante' }).err, /teto do renew/);
  assert.match(mt(root, { action: 'renew', taskId: t.id, until: '+90d', reason: 'um motivo longo o bastante' }).err, /teto do renew/);
  assert.match(mt(root, { action: 'renew', taskId: t.id, until: '+10d', reason: 'curto' }).err, /ao menos 15/);
  const r1 = mt(root, { action: 'renew', taskId: t.id, until: '+45d', reason: 'aguardando resposta do cliente' });
  assert.equal(r1.json.task.context.metadata.renewedUntil.count, 1);
  mt(root, { action: 'renew', taskId: t.id, until: '+30d', reason: 'aguardando resposta do cliente' });
  const r3 = mt(root, { action: 'renew', taskId: t.id, until: '+30d', reason: 'aguardando resposta do cliente' });
  assert.equal(r3.json.task.context.metadata.renewedUntil.count, 3);
  assert.match(JSON.stringify(r3.json.warnings), /renovacao #3/);
});

test('progressAt: avanco de fase/status registra; nota nao', () => {
  const root = sandbox();
  const t = create(root, 'progresso');
  const n = mt(root, { action: 'update', taskId: t.id, note: 'so uma nota' });
  assert.equal(n.json.task.context.metadata.progressAt, undefined);
  const p = mt(root, { action: 'update', taskId: t.id, phase: 'built' });
  assert.ok(p.json.task.context.metadata.progressAt > 0);
});

test('links: string vazia remove a chave (corrige vinculo enganoso) e preserva as demais', () => {
  const root = sandbox();
  const t = create(root, 'vinculo errado', { links: { commit: 'abc1234', deploy: 'd1' } });
  const r = mt(root, { action: 'update', taskId: t.id, links: { commit: '' }, note: 'commit nao identificado' });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json.task.context.metadata.links, { deploy: 'd1' });
});

test('estado estruturado: state/links/phase/note (append-only) fora do label', () => {
  const root = sandbox();
  const t = create(root, 'estruturada', { state: { next: 'deploy', gate: 'prova-no-ar' }, phase: 'built' });
  assert.equal(t.context.metadata.state.next, 'deploy');
  mt(root, { action: 'update', taskId: t.id, note: 'um' });
  const r = mt(root, { action: 'update', taskId: t.id, note: 'dois', links: { deploy: 'edfd5d26' } });
  assert.deepEqual(r.json.task.context.metadata.notes.map((n) => n.text), ['um', 'dois']);
  assert.equal(r.json.task.context.metadata.links.deploy, 'edfd5d26');
  assert.equal(r.json.task.context.metadata.state.gate, 'prova-no-ar');
  const long = mt(root, { action: 'create', label: 'x'.repeat(130) });
  assert.equal(long.code, 1);
  assert.match(long.err, /limite 120/);
});

test('dedupeKey: segunda criacao em aberto devolve a existente', () => {
  const root = sandbox();
  const a = create(root, 'proposta-x', { dedupeKey: 'k1' });
  const b = mt(root, { action: 'create', label: 'proposta-x-bis', dedupeKey: 'k1' });
  assert.equal(b.json.created, false);
  assert.equal(b.json.task.id, a.id);
  assert.equal(JSON.parse(run(root, 'manage_task', '{"action":"list","compact":true}').out).total, 1);
});

test('list: filtros e modo compacto', () => {
  const root = sandbox();
  const a = create(root, 'proposta-gerada-a');
  create(root, 'hefesto-b');
  age(root, a.id, 70 * 86400);
  const r = mt(root, { action: 'list', labelPrefix: 'proposta', olderThanDays: 60, compact: true });
  assert.equal(r.json.matched, 1);
  assert.equal(r.json.total, 2);
  assert.equal(r.json.tasks[0].context, undefined);
});

test('clear exige "APAGAR N TAREFAS", faz backup e grava evento', () => {
  const root = sandbox();
  create(root, 'a'); create(root, 'b');
  const bad = mt(root, { action: 'clear' });
  assert.equal(bad.code, 1);
  assert.match(bad.err, /APAGAR 2 TAREFAS/);
  assert.match(mt(root, { action: 'clear', confirm: 'APAGAR 5 TAREFAS' }).err, /APAGAR 2 TAREFAS/);
  const ok = mt(root, { action: 'clear', confirm: 'APAGAR 2 TAREFAS' });
  assert.equal(ok.json.deletedCount, 2);
  assert.ok(existsSync(ok.json.backup));
  const bk = new DatabaseSync(ok.json.backup);
  assert.equal(bk.prepare('SELECT COUNT(*) n FROM tasks').get().n, 2);
  bk.close();
  assert.equal(JSON.parse(run(root, 'manage_task', '{"action":"list","compact":true}').out).total, 0);
});

test('toda mutacao deixa evento no audit.db (create/update/close/archive/clear)', () => {
  const root = sandbox();
  const t = create(root, 'auditada');
  mt(root, { action: 'update', taskId: t.id, status: 'running' });
  mt(root, { action: 'close', taskId: t.id, proof: 'p' });
  const u = create(root, 'outra');
  mt(root, { action: 'archive', taskId: u.id, reason: 'r' });
  const db = new DatabaseSync(join(root, '.batiste', 'audit.db'));
  const evs = db.prepare('SELECT event FROM event_log').all().map((r) => r.event);
  db.close();
  for (const e of ['task.created', 'task.updated', 'task.closed', 'task.archived']) assert.ok(evs.includes(e), `${e} em ${evs}`);
});

test('stale cobre running (48 h) alem de pending', () => {
  const root = sandbox();
  const r1 = create(root, 'rodando');
  const p1 = create(root, 'pendente');
  age(root, r1.id, 3 * 86400, 'running');
  age(root, p1.id, 1 * 86400);
  const r = mt(root, { action: 'stale', staleDays: 14 });
  assert.deepEqual(r.json.stale.map((s) => s.label), ['rodando']);
  assert.equal(r.json.stale[0].status, 'running');
});

test('triage e dry-run por padrao; apply exige confirm, arquiva e MESCLA as correlatas', () => {
  const root = sandbox();
  const ids = [];
  for (let i = 0; i < 5; i++) { const t = create(root, `proposta-gerada-x${i}`); age(root, t.id, 90 * 86400); ids.push(t.id); }
  const obs = create(root, 'plano fora do ar de teste');
  const dup1 = create(root, 'dup'); const dup2 = create(root, 'dup', { allowDuplicate: true });
  const dry = mt(root, { action: 'triage' });
  assert.equal(dry.json.dryRun, true);
  assert.ok(dry.json.items.some((i) => i.taskId === obs.id && i.kind === 'archive'));
  assert.ok(dry.json.items.some((i) => i.kind === 'merge' && i.mergeInto));
  assert.equal(ids.filter((id) => dry.json.items.some((i) => i.taskId === id)).length, 5);
  assert.equal(JSON.parse(run(root, 'manage_task', '{"action":"list","status":"failed","compact":true}').out).matched, 0);
  assert.match(mt(root, { action: 'triage', apply: true }).err, /confirm "TRIAGE"/);
  const ap = mt(root, { action: 'triage', apply: true, confirm: 'TRIAGE' });
  assert.equal(ap.json.dryRun, false);
  assert.equal(ap.json.archived, 6);
  assert.equal(ap.json.merged, 1);
  assert.equal(ap.json.ids.length, 7);
  assert.equal(mt(root, { action: 'get', taskId: dup1.id }).json.task.status === 'failed' || mt(root, { action: 'get', taskId: dup2.id }).json.task.status === 'failed', true);
});

test('report: burn-down com criadas/concluidas, idade e prefixos', () => {
  const root = sandbox();
  const a = create(root, 'proposta-gerada-1');
  create(root, 'proposta-gerada-2');
  mt(root, { action: 'close', taskId: a.id, proof: 'p' });
  const r = mt(root, { action: 'report' }).json;
  assert.equal(r.total, 2);
  assert.equal(r.open, 1);
  assert.equal(r.completedWithProofPct, 100);
  assert.equal(r.topPrefixes[0].prefix, 'proposta-gerada');
  const month = new Date().toISOString().slice(0, 7);
  assert.equal(r.byMonth[month].created, 2);
  assert.equal(r.byMonth[month].completed, 1);
});

test('reconcile: trailer ambiguo (labels duplicados) NAO fecha o primeiro; id curto casa', () => {
  const root = sandbox();
  const g = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' });
  g('init', '-q'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  const d1 = create(root, 'dupla'); create(root, 'dupla', { allowDuplicate: true });
  const solo = create(root, 'solo');
  g('commit', '--allow-empty', '-qm', 'a\n\nTask-done: dupla');
  g('commit', '--allow-empty', '-qm', `b\n\nTask-done: ${solo.id.slice(0, 8)}`);
  const r = mt(root, { action: 'reconcile' }).json;
  assert.equal(r.ambiguous.length, 1);
  assert.equal(r.ambiguous[0].candidates.length, 2);
  assert.deepEqual(r.closed.map((c) => c.taskId), [solo.id]);
  assert.equal(mt(root, { action: 'get', taskId: d1.id }).json.task.status, 'pending');
});

test('reconcile avisa quando o marcador some e cai na janela', () => {
  const root = sandbox();
  const g = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' });
  g('init', '-q'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  g('commit', '--allow-empty', '-qm', 'a');
  const r = mt(root, { action: 'reconcile', since: 'deadbeefdeadbeef' }).json;
  assert.match(r.warnings[0], /not reachable|scanned the last/);
});

test('doctor: build, DATA_DIR, tasks.db e ping MCP; o servidor deixa mcp-boot.log', () => {
  const root = sandbox();
  create(root, 'x');
  const r = run(root, 'doctor');
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /tasks.db legivel: 1 tarefas/);
  assert.match(r.out, /MCP ping: initialize respondeu/);
  const log = readFileSync(join(root, '.batiste', 'mcp-boot.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(log.some((l) => l.event === 'boot'));
  assert.ok(log.some((l) => l.event === 'listening'));
  assert.match(run(root, '--version').out, /^batiste-direct \d/);
});

test('create: label aberto repetido (trim/minusculas) devolve a existente com deduped:true; allowDuplicate libera', () => {
  const root = sandbox();
  const a = create(root, 'Proposta-Gerada-CT-X');
  const b = mt(root, { action: 'create', label: '  proposta-gerada-ct-x ' });
  assert.equal(b.code, 0, b.err);
  assert.equal(b.json.deduped, true);
  assert.equal(b.json.created, false);
  assert.equal(b.json.taskId, a.id);
  assert.match(b.json.reason, new RegExp(a.id));
  assert.equal(JSON.parse(run(root, 'manage_task', '{"action":"list","compact":true}').out).total, 1);
  const c = mt(root, { action: 'create', label: 'proposta-gerada-ct-x', allowDuplicate: true });
  assert.equal(c.json.created, true);
  assert.notEqual(c.json.task.id, a.id);
  assert.equal(JSON.parse(run(root, 'manage_task', '{"action":"list","compact":true}').out).total, 2);
});

test('create: tarefa fechada nao bloqueia label repetido', () => {
  const root = sandbox();
  const a = create(root, 'ciclo-x');
  assert.equal(mt(root, { action: 'close', taskId: a.id, proof: 'commit abc1234' }).code, 0);
  const b = mt(root, { action: 'create', label: 'ciclo-x' });
  assert.equal(b.json.created, true);
});

test('merge via CLI: --help, mescla, origem arquivada, idempotente, evento task.merged no audit.db', () => {
  const root = sandbox();
  assert.match(run(root, 'manage_task', 'merge', '--help').out, /sourceId, targetId/);
  const a = create(root, 'alvo-x tarefa principal', { note: 'nota do alvo' });
  const b = create(root, 'origem-y coisa diferente', { note: 'saber da origem', tags: ['t2'] });
  const m = mt(root, { action: 'merge', sourceId: b.id, targetId: a.id, reason: 'mesma entrega' });
  assert.equal(m.code, 0, m.err);
  assert.equal(m.json.merged, true);
  const src = mt(root, { action: 'get', taskId: b.id }).json.task;
  assert.equal(src.status, 'failed');
  assert.equal(src.context.metadata.obsolete.reason, `mesclada em ${a.id}`);
  const tgt = mt(root, { action: 'get', taskId: a.id }).json.task;
  assert.ok(tgt.context.metadata.notes.some((n) => /saber da origem/.test(n.text)));
  assert.equal(tgt.context.metadata.mergedFrom[0].id, b.id);
  assert.equal(mt(root, { action: 'merge', sourceId: b.id, targetId: a.id }).json.alreadyMerged, true);
  assert.notEqual(mt(root, { action: 'merge', sourceId: a.id, targetId: a.id }).code, 0);
  const db = new DatabaseSync(join(root, '.batiste', 'audit.db'));
  const ev = db.prepare("SELECT event FROM event_log WHERE event = 'task.merged'").all();
  db.close();
  assert.equal(ev.length, 1);
});

test('create correlato via CLI: >= 0.80 devolve a existente (merged:true) e anexa note; 0.50-0.79 devolve related[]', () => {
  const root = sandbox();
  const a = create(root, 'site-a: publicar pagina de precos em producao');
  const r = mt(root, { action: 'create', label: 'site-a: deploy da pagina de precos em producao', note: 'trocar og:image' });
  assert.equal(r.json.merged, true);
  assert.equal(r.json.taskId, a.id);
  assert.ok(r.json.score >= 0.8);
  assert.match(mt(root, { action: 'get', taskId: a.id }).json.task.context.metadata.notes[0].text, /trocar og:image/);
  const rel = mt(root, { action: 'create', label: 'site-a: conferir cache da pagina de precos em producao' });
  assert.equal(rel.json.created, true);
  assert.equal(rel.json.related[0].taskId, a.id);
  assert.match(rel.json.related[0].merge, /"action":"merge"/);
});
