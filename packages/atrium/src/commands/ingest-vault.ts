/**
 * batiste-fm ingest vault
 *
 * Indexa as notas curadas do vault (05 Memory = fichas, 04 Decision, 02 Policy)
 * no Firm Memory como fatos. Fonte padrao: o vault do repo da casa (fonte da
 * verdade, git), nao o espelho no iCloud. Idempotente por hash do arquivo:
 * nota igual = skip; nota alterada = substitui o fato (mesmo id); `--prune`
 * remove fatos de notas que sairam do vault.
 *
 * Falhas de leitura (ex.: arquivo iCloud 'dataless' que nao baixa a tempo)
 * sao contadas e reportadas, e o comando sai com codigo 1: nada falha em silencio.
 */

import type { Command } from 'commander';
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { openFirmMemory } from '@batiste-aidk/memory';
import { AuditLedger } from '@batiste-aidk/audit';
import { ensureFmRoot, resolvePaths } from '../utils/data-dir.js';
import { withAudit } from '../audit-wrap.js';
import {
  VAULT_SOURCES, VAULT_SOURCE_TAG, decideAction, noteToFact, type VaultNote,
} from '../utils/vault-notes.js';
import { cyan, gray, green, kv, ok, section, warn, yellow } from '../utils/output.js';

export const DEFAULT_VAULT = process.env.BATISTE_VAULT
  ?? join(homedir(), 'Documents', 'git', 'cachola_tech', 'obs_vault', 'cachola_tech');

const READ_TIMEOUT_MS = 60_000;

async function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, rej) => {
    t = setTimeout(() => rej(new Error(`timeout (${ms}ms) lendo ${what}`)), ms);
  });
  try { return await Promise.race([p, timeout]); } finally { if (t) clearTimeout(t); }
}

/** Lista .md recursivamente, ignorando pastas iniciadas por '_' (_persons, _templates, _attachments). */
async function walk(root: string, rel: string, out: string[]): Promise<void> {
  const entries = await readdir(join(root, rel), { withFileTypes: true });
  for (const e of entries) {
    if (e.name.startsWith('_') || e.name.startsWith('.')) continue;
    const r = `${rel}/${e.name}`;
    if (e.isDirectory()) await walk(root, r, out);
    else if (e.isFile() && e.name.endsWith('.md')) out.push(r);
  }
}

export async function discoverVaultFiles(vault: string): Promise<string[]> {
  const out: string[] = [];
  for (const s of VAULT_SOURCES) {
    if (existsSync(join(vault, s.dir))) await walk(vault, s.dir, out);
  }
  return out.sort();
}

export function registerIngestVault(parent: Command): void {
  parent
    .command('vault')
    .description('Indexa 05 Memory (fichas), 04 Decision e 02 Policy do vault no FM (idempotente por hash)')
    .option('--vault <path>', 'caminho do vault (default: repo da casa, ou $BATISTE_VAULT)', DEFAULT_VAULT)
    .option('--dry-run', 'lista o que seria feito, sem escrever', false)
    .option('--prune', 'remove do FM os fatos de notas que nao existem mais no vault', false)
    .action(async (opts: { vault: string; dryRun: boolean; prune: boolean }) => {
      const paths = resolvePaths();
      await ensureFmRoot(paths);
      section('Atrium · ingest vault');
      kv('Vault', gray(opts.vault));
      kv('FM root', gray(paths.fmRoot));
      kv('Namespace', cyan(paths.namespace));

      if (!existsSync(opts.vault)) {
        process.stderr.write(`vault nao encontrado: ${opts.vault}\n`);
        process.exitCode = 1;
        return;
      }
      const files = await discoverVaultFiles(opts.vault);
      kv('Notas', String(files.length));

      const fm = await openFirmMemory({ dataDir: paths.dataDir, namespace: paths.namespace });
      const ledger = opts.dryRun ? undefined : new AuditLedger(paths.auditDbPath);
      const ctx = ledger ? { ledger, sessionId: `atrium-vault-${Date.now()}`, agentId: 'batiste-fm' } : undefined;
      let inserted = 0, updated = 0, skipped = 0, failed = 0, pruned = 0;
      const seen = new Set<string>();
      try {
        for (const relPath of files) {
          let note: VaultNote;
          try {
            const raw = await withTimeout(readFile(join(opts.vault, relPath), 'utf8'), READ_TIMEOUT_MS, relPath);
            note = { relPath, raw };
          } catch (err) {
            failed++;
            warn(`falha ao ler ${relPath}: ${err instanceof Error ? err.message : String(err)}`);
            continue;
          }
          const fact = noteToFact(note);
          if (!fact) continue;
          seen.add(fact.id);
          const action = decideAction(await fm.facts.get(fact.id), fact);
          if (action === 'skip') { skipped++; continue; }
          if (action === 'insert') inserted++; else updated++;
          if (opts.dryRun) {
            process.stdout.write(`  ${gray(`would ${action}:`)} ${relPath} ${gray(`[${fact.kind}/${fact.sensitivity}/${fact.workstream}]`)}\n`);
            continue;
          }
          await withAudit(ctx!, 'fm.facts.put', { id: fact.id, source: 'vault', file: relPath, action }, async () => {
            await fm.facts.put(fact);
          });
        }

        if (opts.prune) {
          for (const kind of ['precedent', 'decision'] as const) {
            const stale = (await fm.facts.list({ kind, tags: [VAULT_SOURCE_TAG], limit: 100_000 }))
              .filter((e) => e.tags.includes(VAULT_SOURCE_TAG) && !seen.has(e.id));
            for (const e of stale) {
              pruned++;
              if (opts.dryRun) { process.stdout.write(`  ${gray('would prune:')} ${e.vault_ref ?? e.id}\n`); continue; }
              await withAudit(ctx!, 'fm.facts.delete', { id: e.id, source: 'vault', file: e.vault_ref }, async () => {
                await fm.facts.delete(e.id);
              });
            }
          }
        }
      } finally {
        await fm.close();
      }

      section('Resumo');
      kv('Inseridas', green(String(inserted)));
      kv('Atualizadas', yellow(String(updated)));
      kv('Sem mudanca (idempotente)', String(skipped));
      kv('Removidas (--prune)', String(pruned));
      kv('Falhas de leitura', failed > 0 ? yellow(String(failed)) : '0');
      if (failed > 0) { process.exitCode = 1; warn('houve falhas de leitura: reexecute (iCloud dataless?)'); }
      else ok(opts.dryRun ? 'Dry-run completo, nada escrito.' : 'Vault indexado.');
    });
}
