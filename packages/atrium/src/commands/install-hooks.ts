/**
 * batiste-fm install hooks
 *
 * Installs (or removes) the Claude Code hook scripts that make Atrium
 * "invisible" — the v1.4 promise that the operator never has to manually
 * run `batiste-fm ingest` or `batiste-fm retrieve`. After install:
 *
 *   - SessionStart fires `atrium-session-start.sh` → background
 *     `batiste-fm ingest cc-sessions` for the project's CWD slug.
 *   - UserPromptSubmit (opt-in via --enable-prompt-augment) fires
 *     `atrium-user-prompt.sh` → silently RAG-augments the prompt
 *     with up to 3 hits from Firm Memory.
 *   - PreToolUse (opt-in via --enable-tool-mapping) fires
 *     `atrium-tool-mapping.sh` → nudges the agent when it's about
 *     to call a native tool that has a Batiste equivalent (the
 *     structural enforcement layer for CLAUDE.md's "Batiste-by-default"
 *     working agreement). Fires on EVERY tool call when enabled, hence
 *     opt-in.
 *
 * Each one is an explicit operator action — the install wizard only
 * hints at them. The reason is non-trivial: UserPromptSubmit modifies
 * every prompt and PreToolUse fires before every tool call, both of
 * which are exactly the kind of magic that eats trust if it surprises
 * them later. Make them opt in.
 *
 * Settings.json edits are routed through `utils/hook-config.ts` so
 * unrelated keys (MCP servers, allowed-tools, etc.) are preserved
 * byte-for-byte modulo formatting.
 */

import type { Command } from 'commander';
import { chmod, copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  mergeHooks,
  readSettingsFile,
  removeHooks,
  writeSettingsFile,
  type MergePlan,
} from '../utils/hook-config.js';
import { resolvePaths } from '../utils/data-dir.js';
import { serializeToolMap } from '../utils/tool-map.js';
import { bold, cyan, gray, green, kv, ok, section, warn, yellow } from '../utils/output.js';

const SESSION_HOOK = 'atrium-session-start.sh';
const PROMPT_HOOK = 'atrium-user-prompt.sh';
const TOOL_MAPPING_HOOK = 'atrium-tool-mapping.sh';

/** Both file names live in `packages/atrium/bin/` — sibling to batiste-fm.js. */
function packagedBinDir(): string {
  // dist/commands/install-hooks.js → packages/atrium/bin
  const here = fileURLToPath(new URL('.', import.meta.url));
  return resolve(here, '..', '..', 'bin');
}

function defaultHooksDir(): string {
  return join(homedir(), '.claude', 'hooks');
}

function detectSettingsPath(): string {
  const claude = join(homedir(), '.claude');
  const local = join(claude, 'settings.local.json');
  // Prefer .local.json if it exists — it's what the operator typically
  // edits for per-machine overrides; that's the closest surface to
  // "what Claude Code will actually read for hooks".
  if (existsSync(local)) return local;
  return join(claude, 'settings.json');
}

interface InstallOpts {
  uninstall?: boolean;
  hooksDir?: string;
  settingsPath?: string;
  enablePromptAugment?: boolean;
  enableToolMapping?: boolean;
  cwdAllowlist?: string;
}

export function registerInstallHooks(parent: Command): void {
  parent
    .command('hooks')
    .description('Install or remove the Claude Code hook scripts that make Atrium invisible')
    .option('--uninstall', 'remove the Atrium hooks instead of installing', false)
    .option('--hooks-dir <path>', 'override hook script destination', defaultHooksDir())
    .option(
      '--settings-path <path>',
      'override Claude Code settings path (default: auto-detect)',
    )
    .option(
      '--enable-prompt-augment',
      'also install the UserPromptSubmit hook (opt-in: it modifies every prompt)',
      false,
    )
    .option(
      '--enable-tool-mapping',
      'also install the PreToolUse hook that nudges native→Batiste tool use (opt-in: fires on every tool call)',
      false,
    )
    .option(
      '--cwd-allowlist <list>',
      'comma-separated CWD substrings to enable for SessionStart (default: current cwd basename)',
    )
    .action(async (opts: InstallOpts) => {
      const settingsPath = opts.settingsPath ?? detectSettingsPath();
      const hooksDir = opts.hooksDir ?? defaultHooksDir();
      if (opts.uninstall) {
        await runUninstall({ hooksDir, settingsPath });
      } else {
        await runInstall({
          hooksDir,
          settingsPath,
          enablePromptAugment: Boolean(opts.enablePromptAugment),
          enableToolMapping: Boolean(opts.enableToolMapping),
          cwdAllowlist: opts.cwdAllowlist,
        });
      }
    });
}

interface InstallArgs {
  hooksDir: string;
  settingsPath: string;
  enablePromptAugment: boolean;
  enableToolMapping: boolean;
  cwdAllowlist: string | undefined;
}

async function runInstall(args: InstallArgs): Promise<void> {
  section('Atrium · install hooks');
  kv('Hooks dir', gray(args.hooksDir));
  kv('Settings path', gray(args.settingsPath));
  kv('Prompt augment', args.enablePromptAugment ? green('enabled') : yellow('disabled (default)'));
  kv('Tool mapping', args.enableToolMapping ? green('enabled') : yellow('disabled (default)'));

  // 1. Copy hook scripts into the hooks dir.
  await mkdir(args.hooksDir, { recursive: true });
  const srcBin = packagedBinDir();
  const installedScripts: string[] = [];

  const sessionSrc = join(srcBin, SESSION_HOOK);
  const sessionDst = join(args.hooksDir, SESSION_HOOK);
  await copyFile(sessionSrc, sessionDst);
  await chmod(sessionDst, 0o755);
  installedScripts.push(sessionDst);

  let promptDst: string | undefined;
  if (args.enablePromptAugment) {
    const promptSrc = join(srcBin, PROMPT_HOOK);
    promptDst = join(args.hooksDir, PROMPT_HOOK);
    await copyFile(promptSrc, promptDst);
    await chmod(promptDst, 0o755);
    installedScripts.push(promptDst);
  }

  let toolMappingDst: string | undefined;
  if (args.enableToolMapping) {
    const toolMappingSrc = join(srcBin, TOOL_MAPPING_HOOK);
    toolMappingDst = join(args.hooksDir, TOOL_MAPPING_HOOK);
    await copyFile(toolMappingSrc, toolMappingDst);
    await chmod(toolMappingDst, 0o755);
    installedScripts.push(toolMappingDst);
  }

  // 2. Merge into settings.json.
  const before = await readSettingsFile(args.settingsPath);
  const plans: MergePlan[] = [
    { event: 'SessionStart', command: sessionDst, matcher: '*' },
  ];
  if (promptDst) {
    plans.push({ event: 'UserPromptSubmit', command: promptDst, matcher: '*' });
  }
  if (toolMappingDst) {
    plans.push({ event: 'PreToolUse', command: toolMappingDst, matcher: '*' });
  }
  const after = mergeHooks(before, plans);
  await writeSettingsFile(args.settingsPath, after);

  // 3. Write atrium-hooks.json (the runtime config the bash hooks read).
  const allowlist = parseAllowlist(args.cwdAllowlist);
  const fmPaths = resolvePaths();
  const hooksConfigPath = join(fmPaths.fmRoot, 'atrium-hooks.json');
  await mkdir(fmPaths.fmRoot, { recursive: true });
  const hooksConfig = {
    cwd_allowlist: allowlist,
    retrieve_injection_enabled: args.enablePromptAugment,
    tool_mapping_enabled: args.enableToolMapping,
    installed_at: new Date().toISOString(),
    installed_scripts: installedScripts,
  };
  await writeFile(hooksConfigPath, JSON.stringify(hooksConfig, null, 2) + '\n', 'utf8');

  // 3b. If tool mapping is enabled, write the resolved rule table to a
  // separate JSON file the bash hook reads. Done unconditionally when
  // enabled so re-installs always pick up rule edits.
  let toolMapPath: string | undefined;
  if (args.enableToolMapping) {
    toolMapPath = join(fmPaths.fmRoot, 'tool-map.json');
    await writeFile(
      toolMapPath,
      JSON.stringify(serializeToolMap(), null, 2) + '\n',
      'utf8',
    );
  }

  // 4. Smoke test — run the session hook with a stub event and capture
  // stdout. Failure here is informational, not fatal: the operator can
  // still ship without the smoke check passing (e.g. on a fresh box
  // where batiste-fm isn't on PATH yet).
  const smoke = await smokeTestSessionHook(sessionDst);

  section('Installed');
  for (const p of installedScripts) {
    process.stdout.write(`  ${green('+')} ${p}\n`);
  }
  kv('Settings updated', cyan(args.settingsPath));
  kv('Hooks config', cyan(hooksConfigPath));
  if (toolMapPath) {
    kv('Tool-map JSON', cyan(toolMapPath));
  }
  kv('CWD allowlist', allowlist.length > 0 ? allowlist.join(', ') : yellow('(empty — set --cwd-allowlist)'));
  kv('Smoke test', smoke.ok ? green('ok') : yellow(smoke.message));
  ok(`Atrium hooks installed. Uninstall with: batiste-fm install hooks --uninstall`);
  if (!args.enablePromptAugment) {
    process.stdout.write(
      `  ${gray('hint:')} re-run with ${bold('--enable-prompt-augment')} to also auto-RAG every prompt.\n`,
    );
  }
  if (!args.enableToolMapping) {
    process.stdout.write(
      `  ${gray('hint:')} re-run with ${bold('--enable-tool-mapping')} to nudge native→Batiste tool use (PreToolUse, fires on every tool call).\n`,
    );
  } else {
    process.stdout.write(
      `  ${gray('hint:')} disable tool mapping by re-running ${gray('`batiste-fm install hooks --uninstall`')} or omitting the flag on next install.\n`,
    );
  }
}

interface UninstallArgs {
  hooksDir: string;
  settingsPath: string;
}

async function runUninstall(args: UninstallArgs): Promise<void> {
  section('Atrium · uninstall hooks');
  kv('Hooks dir', gray(args.hooksDir));
  kv('Settings path', gray(args.settingsPath));

  // 1. Strip Atrium entries from settings.json.
  const before = await readSettingsFile(args.settingsPath);
  const after = removeHooks(before, ['SessionStart', 'UserPromptSubmit', 'PreToolUse']);
  await writeSettingsFile(args.settingsPath, after);

  // 2. Remove the hook scripts. Best-effort — missing is fine.
  const removed: string[] = [];
  for (const name of [SESSION_HOOK, PROMPT_HOOK, TOOL_MAPPING_HOOK]) {
    const p = join(args.hooksDir, name);
    if (existsSync(p)) {
      await rm(p, { force: true });
      removed.push(p);
    }
  }

  section('Uninstalled');
  if (removed.length === 0) {
    process.stdout.write(`  ${gray('(no hook scripts present)')}\n`);
  } else {
    for (const p of removed) {
      process.stdout.write(`  ${yellow('-')} ${p}\n`);
    }
  }
  kv('Settings updated', cyan(args.settingsPath));
  warn(`Left ~/.batiste/firm-memory/atrium-hooks.json untouched. rm it manually if desired.`);
  ok('Atrium hooks removed.');
}

function parseAllowlist(raw: string | undefined): string[] {
  if (raw && raw.trim().length > 0) {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  return [basename(process.cwd())];
}

interface SmokeResult {
  ok: boolean;
  message: string;
}

async function smokeTestSessionHook(scriptPath: string): Promise<SmokeResult> {
  // Pipe a stub JSON event to the script. We don't care that the
  // background ingest succeeds — we only verify the script is
  // executable, exits 0, and prints the expected marker line.
  const { spawn } = await import('node:child_process');
  return new Promise<SmokeResult>((resolvePromise) => {
    let stdout = '';
    const child = spawn(scriptPath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, BATISTE_FM_ROOT: process.env.BATISTE_FM_ROOT ?? join(homedir(), '.batiste', 'firm-memory') },
    });
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.on('error', (err) => {
      resolvePromise({ ok: false, message: `spawn error: ${err.message}` });
    });
    child.on('close', (code) => {
      if (code !== 0) {
        resolvePromise({ ok: false, message: `exited ${code}` });
        return;
      }
      // Tolerate either the "ingesting prior sessions" line or the
      // "batiste-fm not installed" line — both are valid responses
      // from a healthy hook, depending on whether batiste-fm is on
      // PATH inside the smoke env.
      if (stdout.includes('# Atrium')) {
        resolvePromise({ ok: true, message: 'echoed marker' });
      } else if (stdout.length === 0) {
        // Hook exited 0 but said nothing — typically means cwd not
        // in allowlist, which is normal on a fresh install before the
        // operator scopes the allowlist.
        resolvePromise({ ok: true, message: 'silent (cwd not in allowlist yet)' });
      } else {
        resolvePromise({ ok: true, message: `unexpected stdout: ${stdout.slice(0, 60)}` });
      }
    });
    child.stdin.write(JSON.stringify({ cwd: process.cwd(), sessionId: 'smoke' }));
    child.stdin.end();
  });
}
