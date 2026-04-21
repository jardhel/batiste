import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadVault, validateVault } from '../index.js';

async function writeNote(dir: string, name: string, frontmatter: Record<string, unknown>, body = '') {
  await fs.mkdir(dir, { recursive: true });
  const lines = ['---'];
  for (const [k, v] of Object.entries(frontmatter)) {
    if (Array.isArray(v)) lines.push(`${k}: [${v.map((x) => JSON.stringify(x)).join(', ')}]`);
    else lines.push(`${k}: ${JSON.stringify(v)}`);
  }
  lines.push('---');
  lines.push(body);
  await fs.writeFile(path.join(dir, name), lines.join('\n'), 'utf8');
}

async function scaffoldMinimalVault(root: string) {
  const home = [
    '---',
    'title: Home',
    'gvs_version: 0.1-draft',
    'axis: policy',
    'updated: 2026-04-21',
    'status: active',
    'tags: []',
    '---',
    '',
    '# Home',
    '',
    '- [[Acme Corp]]',
  ].join('\n');
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, '00 Home.md'), home, 'utf8');

  await writeNote(path.join(root, '01 Identity'), 'Acme Corp.md', {
    title: 'Acme Corp',
    axis: 'identity',
    updated: '2026-04-21',
    status: 'active',
    tags: ['axis/identity'],
  });
  await writeNote(path.join(root, '02 Policy'), 'Operating principles.md', {
    title: 'Operating principles',
    axis: 'policy',
    updated: '2026-04-21',
    status: 'active',
    tags: ['axis/policy'],
  });
  await writeNote(path.join(root, '03 Roles'), 'Jane Doe.md', {
    title: 'Jane Doe',
    axis: 'roles',
    updated: '2026-04-21',
    status: 'active',
    tags: ['axis/roles'],
    principal_type: 'human',
  });
  await writeNote(path.join(root, '04 Decision'), '2026-04-20 — Adopt GVS.md', {
    title: '2026-04-20 — Adopt GVS',
    axis: 'decision',
    updated: '2026-04-20',
    status: 'active',
    tags: ['axis/decision'],
    decided_on: '2026-04-20',
    authority: 'Jane Doe',
  });
  await writeNote(path.join(root, '05 Memory'), 'Q2 fundraise.md', {
    title: 'Q2 fundraise',
    axis: 'memory',
    updated: '2026-04-21',
    status: 'active',
    tags: ['axis/memory'],
  });
  await writeNote(path.join(root, '06 Audit'), '2026-04-20-AC-LEG-2026-001.md', {
    title: '2026-04-20-AC-LEG-2026-001',
    axis: 'audit',
    updated: '2026-04-20',
    status: 'active',
    tags: ['axis/audit'],
    ref: 'AC-LEG-2026-001',
    manifest: 'manifests/AC-LEG-2026-001.json',
    stamp_hash: 'a'.repeat(64),
    stamped_on: '2026-04-20T10:00:00Z',
  });

  const tplDir = path.join(root, '_templates');
  await fs.mkdir(tplDir, { recursive: true });
  for (const name of [
    '00-home.md',
    '01-identity.md',
    '02-policy.md',
    '03-roles.md',
    '04-decision.md',
    '05-memory.md',
    '06-audit.md',
  ]) {
    await fs.writeFile(path.join(tplDir, name), '---\ntitle: "{{title}}"\n---\n', 'utf8');
  }
}

describe('validateVault', () => {
  let tmp: string;

  beforeAll(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'gvs-'));
  });

  afterAll(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('reports a minimal conforming vault as conforming', async () => {
    const root = path.join(tmp, 'ok-vault');
    await scaffoldMinimalVault(root);
    const vault = await loadVault(root);
    const report = await validateVault(vault, { skipCanonical: true });
    expect(report.conforming).toBe(true);
    expect(report.counts.errors).toBe(0);
    expect(report.gvsVersion).toBe('0.1-draft');
    expect(report.counts.byAxis.decision).toBe(1);
    expect(report.counts.byAxis.audit).toBe(1);
  });

  it('catches axis mismatch when frontmatter axis contradicts the folder', async () => {
    const root = path.join(tmp, 'mismatch-vault');
    await scaffoldMinimalVault(root);
    await writeNote(path.join(root, '01 Identity'), 'Misplaced.md', {
      title: 'Misplaced',
      axis: 'policy',
      updated: '2026-04-21',
      status: 'active',
      tags: [],
    });
    const vault = await loadVault(root);
    const report = await validateVault(vault, { skipCanonical: true });
    expect(report.conforming).toBe(false);
    const rule = report.issues.find((i) => i.rule === 'axis-consistency');
    expect(rule).toBeDefined();
    expect(rule?.path).toContain('Misplaced.md');
  });

  it('catches duplicate audit refs', async () => {
    const root = path.join(tmp, 'dup-audit');
    await scaffoldMinimalVault(root);
    await writeNote(path.join(root, '06 Audit'), '2026-04-21-AC-LEG-2026-001.md', {
      title: '2026-04-21-AC-LEG-2026-001',
      axis: 'audit',
      updated: '2026-04-21',
      status: 'active',
      tags: [],
      ref: 'AC-LEG-2026-001',
      manifest: 'manifests/x.json',
      stamp_hash: 'b'.repeat(64),
      stamped_on: '2026-04-21T10:00:00Z',
    });
    const vault = await loadVault(root);
    const report = await validateVault(vault, { skipCanonical: true });
    expect(report.issues.some((i) => i.rule === 'audit-uniqueness')).toBe(true);
  });

  it('flags broken wikilinks as warnings', async () => {
    const root = path.join(tmp, 'broken-links');
    await scaffoldMinimalVault(root);
    await writeNote(
      path.join(root, '05 Memory'),
      'Dangling.md',
      {
        title: 'Dangling',
        axis: 'memory',
        updated: '2026-04-21',
        status: 'active',
        tags: [],
      },
      'see [[Nonexistent Note]]',
    );
    const vault = await loadVault(root);
    const report = await validateVault(vault, { skipCanonical: true });
    expect(report.issues.some((i) => i.rule === 'wikilink-resolution')).toBe(true);
  });

  it('flags missing templates as errors', async () => {
    const root = path.join(tmp, 'no-templates');
    await scaffoldMinimalVault(root);
    await fs.rm(path.join(root, '_templates', '06-audit.md'));
    const vault = await loadVault(root);
    const report = await validateVault(vault, { skipCanonical: true });
    expect(report.issues.some((i) => i.rule === 'templates-catalog')).toBe(true);
    expect(report.conforming).toBe(false);
  });

  it('flags missing gvs_version in home as an error', async () => {
    const root = path.join(tmp, 'no-version');
    await scaffoldMinimalVault(root);
    const homePath = path.join(root, '00 Home.md');
    const source = await fs.readFile(homePath, 'utf8');
    await fs.writeFile(homePath, source.replace(/gvs_version:[^\n]+\n/, ''), 'utf8');
    const vault = await loadVault(root);
    const report = await validateVault(vault, { skipCanonical: true });
    expect(report.issues.some((i) => i.rule === 'home-gvs-version')).toBe(true);
  });

  it('flags missing required fields on an audit note', async () => {
    const root = path.join(tmp, 'bad-audit');
    await scaffoldMinimalVault(root);
    await writeNote(path.join(root, '06 Audit'), '2026-04-22-BAD.md', {
      title: '2026-04-22-BAD',
      axis: 'audit',
      updated: '2026-04-22',
      status: 'active',
      tags: [],
      // missing ref, manifest, stamp_hash, stamped_on
    });
    const vault = await loadVault(root);
    const report = await validateVault(vault, { skipCanonical: true });
    const keys = report.issues
      .filter((i) => i.rule === 'frontmatter-completeness')
      .map((i) => i.message);
    expect(keys.join('\n')).toMatch(/ref|manifest|stamp_hash|stamped_on/);
  });

  it('requires agent_model when principal_type is agent', async () => {
    const root = path.join(tmp, 'agent-role');
    await scaffoldMinimalVault(root);
    await writeNote(path.join(root, '03 Roles'), 'Orchestrator.md', {
      title: 'Orchestrator',
      axis: 'roles',
      updated: '2026-04-21',
      status: 'active',
      tags: [],
      principal_type: 'agent',
    });
    const vault = await loadVault(root);
    const report = await validateVault(vault, { skipCanonical: true });
    expect(
      report.issues.some(
        (i) => i.rule === 'frontmatter-completeness' && /agent_model/.test(i.message),
      ),
    ).toBe(true);
  });
});
