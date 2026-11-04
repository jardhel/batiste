# The ten-minute tour

Three acts, all runnable, no cloud account. Every number you will see is measured
on your machine during the run — that is the whole point of this project.

**Prerequisites:** Node.js ≥ 20, pnpm ≥ 9.

```bash
git clone https://github.com/jardhel/batiste.git
cd batiste
pnpm install && pnpm build
```

---

## Act 1 — the zero-trust chain, measured (~5 min)

```bash
npx tsx examples/investor-demo/run.ts
```

A marketplace starts in-process, nodes register, and real tool calls route through
the full chain: path-scoped policy → JWT verification → append-only audit ledger
→ handler. The action is on the record **before** it runs. At the end, the kill
switch revokes every node and the demo prints its figures — handler success count,
billed compute, audit entries, median latency, kill-switch revocation latency —
each one measured during this run, none of them hardcoded. Which brings us to Act 2.

## Act 2 — the gate that fails fake demos (~90 s)

Most demo theater survives because nothing is positioned to catch it. Batiste
ships a gate whose only job is to fail a pitch that fakes its numbers. Plant some
theater and watch:

```bash
mkdir -p examples/theater
cat > examples/theater/demo.ts <<'EOF'
// investor demo — impressive numbers
async function run() {
  const latencyMs = Math.random() * 2 + 3;        // "measured" latency
  await new Promise(r => setTimeout(r, 3000));     // simulate real work
  console.log(`latency: ${latencyMs.toFixed(1)}ms · success rate: 99.7%`);
  return { result: "success" };
}
run();
EOF
git add examples/theater/demo.ts     # the gate reads what you are about to ship
node packages/pitch-integrity/pitch-integrity.mjs .
```

Exit code 1, three findings: a metric drawn from a random generator
(`random-metric`), a sleep dressed up as work (`fake-work-sleep`), and a
hardcoded success (`theater-success`). Clean up and the repo is green again:

```bash
git rm -q --cached examples/theater/demo.ts && rm -rf examples/theater
node packages/pitch-integrity/pitch-integrity.mjs .   # ✓ OK, exit 0
```

This gate runs against Batiste's own demos in this repository. The demo you ran
in Act 1 passes it.

## Act 3 — the ledger's own tests (~1 min)

```bash
pnpm --filter @batiste-aidk/audit test    # 8 files, 67 tests, real SQLite
```

The signed audit ledger — the part everything else leans on — tested against a
real SQLite engine, not mocks. If you only remember one design rule from this
tour: **evidence that cannot be re-executed carries no weight here.** That rule
is enforced on our agents, on our demos, and on this README.

---

*Questions, bugs, or a demo that fooled the gate? Open an issue — a reproducible
counterexample is the most valuable thing you can send us.*
