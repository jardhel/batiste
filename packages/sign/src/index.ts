/**
 * @batiste-aidk/sign
 *
 * TypeScript wrapper around the Cachola Tech Python signing CLI
 * (/Users/jardhel/Documents/git/cachola_tech/sign/cli.py).
 *
 * The Python side owns pyHanko, 1Password CLI integration, and ICP-Brasil
 * timestamping. This package gives Batiste agents a typed async surface.
 *
 * Override the Python binary / CLI path via env:
 *   CACHOLA_SIGN_PYTHON=/usr/local/bin/python3.12
 *   CACHOLA_SIGN_CLI=/path/to/cachola_tech
 * (or pass them per-call).
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_PYTHON = process.env["CACHOLA_SIGN_PYTHON"] ?? "python3";
const DEFAULT_CACHOLA_ROOT =
  process.env["CACHOLA_SIGN_ROOT"] ??
  "/Users/jardhel/Documents/git/cachola_tech";

export interface InvokeOptions {
  pythonBinary?: string;
  cacholaRoot?: string;
}

export interface InvokeResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface SignOptions extends InvokeOptions {
  pdfPath: string;
  reason?: string;
  noTsa?: boolean;
  dryRun?: boolean;
  inPlace?: boolean;
  outPath?: string;
}

export interface PlanOptions extends InvokeOptions {
  pdfPath: string;
}

async function invoke(
  args: string[],
  opts: InvokeOptions,
): Promise<InvokeResult> {
  const python = opts.pythonBinary ?? DEFAULT_PYTHON;
  const cwd = opts.cacholaRoot ?? DEFAULT_CACHOLA_ROOT;
  if (!existsSync(resolve(cwd, "sign/cli.py"))) {
    return {
      ok: false,
      stdout: "",
      stderr: `sign/cli.py not found under ${cwd}. Set CACHOLA_SIGN_ROOT or pass cacholaRoot.`,
      exitCode: -1,
    };
  }
  return new Promise((resolveP) => {
    const proc = spawn(python, ["-m", "sign.cli", ...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });
    proc.on("close", (code) => {
      resolveP({
        ok: code === 0,
        stdout,
        stderr,
        exitCode: code ?? -1,
      });
    });
  });
}

export async function check(opts: InvokeOptions = {}): Promise<InvokeResult> {
  return invoke(["check"], opts);
}

export async function plan(opts: PlanOptions): Promise<InvokeResult> {
  return invoke(["plan", opts.pdfPath], opts);
}

export async function sign(opts: SignOptions): Promise<InvokeResult> {
  const args = ["sign", opts.pdfPath];
  if (opts.reason) {
    args.push("--reason", opts.reason);
  }
  if (opts.noTsa) {
    args.push("--no-tsa");
  }
  if (opts.dryRun) {
    args.push("--dry-run");
  }
  if (opts.inPlace) {
    args.push("--in-place");
  }
  if (opts.outPath) {
    args.push("--out", opts.outPath);
  }
  return invoke(args, opts);
}

export const defaults = {
  python: DEFAULT_PYTHON,
  cacholaRoot: DEFAULT_CACHOLA_ROOT,
};
