// Dogfood: renderiza os STLs da MAJU em PARALELO via @batiste-aidk/parallel
// (Plan/Executor, concorrência auto = cpu/2), auditado via @batiste-aidk/audit
// (onLineage). Responde "dá pra paralelizar usando o batiste?" — dá, e é o primitivo.
import { Plan, Executor } from "/Users/jardhel/Documents/git/batiste/packages/parallel/dist/index.js";
import * as audit from "@batiste-aidk/audit";
import { exec } from "node:child_process";
import { promisify } from "node:util";
const sh = promisify(exec);

const OSC = "/opt/homebrew/bin/openscad";
const ENC = "/Users/jardhel/Documents/git/maju-1/hardware/enclosure";
const ASM = "/Users/jardhel/Documents/git/maju-1/hardware/assembly";
const R   = "/Users/jardhel/Documents/git/maju-1/render/stl";
const V   = "/Users/jardhel/Documents/git/cachola_tech/products/maju-landing/viewer";

const JOBS = [
  // família enclosure (geometria afinada + watermarks)
  ["maju-1",      `${OSC} -D 'render_part="closed"' -o ${V}/maju-1.stl ${ENC}/maju.scad`],
  ["maju-1-body", `${OSC} -D 'render_part="body"'   -o ${V}/maju-1-body.stl ${ENC}/maju.scad`],
  ["maju-1-lid",  `${OSC} -D 'render_part="base"'   -o ${V}/maju-1-lid.stl ${ENC}/maju.scad`],
  ["maju-15",     `${OSC} -D 'render_part="closed"' -D 'serial="MJ1S-EHV-0001"' -o ${V}/maju-15.stl ${ENC}/maju.scad`],
  ["maju-2",      `${OSC} -D 'render_part="closed"' -D 'serial="MJ2-EHV-0001"'  -o ${V}/maju-2.stl ${ENC}/maju.scad`],
  // MAJU-R assembled (janela integrada) + eletrônica
  ["maju-r",      `${OSC} -D 'render_part="closed"' -D 'radome_separate=false' -o ${V}/maju-r.stl ${ENC}/maju-R.scad`],
  ["iwr6843",     `${OSC} -D 'PART="radar"' -o ${V}/iwr6843.stl ${ENC}/maju-R-components.scad`],
  ["esp32s3",     `${OSC} -D 'PART="mcu"'   -o ${V}/esp32s3.stl ${ENC}/maju-R-components.scad`],
  ["psu",         `${OSC} -D 'PART="psu"'   -o ${V}/psu.stl ${ENC}/maju-R-components.scad`],
  // componentes MAJU-1
  ["esp32",       `${OSC} -D 'EXPORT_PART="esp"'   -o ${V}/esp32.stl ${ASM}/assembly.scad`],
  ["bme280",      `${OSC} -D 'EXPORT_PART="bme"'   -o ${V}/bme280.stl ${ASM}/assembly.scad`],
  ["yl83",        `${OSC} -D 'EXPORT_PART="yl"'    -o ${V}/yl83.stl ${ASM}/assembly.scad`],
  ["cable",       `${OSC} -D 'EXPORT_PART="cable"' -o ${V}/cable.stl ${ASM}/assembly.scad`],
  // canônicos (print) que mudaram
  ["majuR_lid",   `${OSC} -D 'render_part="lid"'  -o ${R}/majuR_lid.stl  ${ENC}/maju-R.scad`],
  ["majuR_both",  `${OSC} -D 'render_part="both"' -o ${R}/majuR_both.stl ${ENC}/maju-R.scad`],
];

const plan = new Plan();
for (const [name, cmd] of JOBS)
  plan.add(name, async () => { await sh(cmd, { maxBuffer: 128 * 1024 * 1024 }); });

let sumMs = 0;
const ex = new Executor({
  concurrency: "auto",
  onLineage: (e) => {
    if (e.phase !== "end") return;
    sumMs += e.durationMs || 0;
    try { audit?.smoke?.("stl-render", { part: e.name, ms: e.durationMs, result: e.result }); } catch {}
    console.log(`  ${e.result === "error" ? "✗" : "✔"} ${e.name.padEnd(12)} ${(e.durationMs/1000).toFixed(1)}s`);
  },
});

const t0 = Date.now();
const res = await ex.run(plan);
const wall = Date.now() - t0;
const fails = res.lineage.filter((e) => e.phase === "end" && e.result === "error");
console.log(`\nparalelo: wall ${(wall/1000).toFixed(1)}s vs soma ${(sumMs/1000).toFixed(1)}s ` +
            `(speedup ~${(sumMs/wall).toFixed(1)}x, cap=cpu/2)`);
console.log(fails.length ? `FALHAS: ${fails.map(f=>f.name+": "+(f.error?.message||"").slice(0,80)).join(" | ")}`
                         : `${JOBS.length} renders OK`);
