# Runbook — Kill Switch

**Purpose:** revoke all active agent sessions and pending tool calls across the mesh in under 1 ms.
**Authority:** Security Lead, on-call SRE, or customer CISO. Dual-control not required (time-critical).
**Supports:** NIS2 Art. 21(2)(b)(c), DORA Art. 11 & 12, ISO 27001 A.5.24 & A.5.30, SOC 2 CC7.4, GDPR Art. 32(1)(c), 33.

## 1. When to fire

Fire the kill switch if **any** of the following are observed:

- Unauthorised tool execution detected in the audit ledger (any unexpected handler invocation).
- Leaked JWT signing key (confirmed or strongly suspected).
- Active attacker observed inside the mesh (lateral movement, privilege escalation).
- Confirmed data exfiltration attempt via a compromised node.
- Customer regulator issues a stop-processing order.

When in doubt, **fire**. Restoring from a fired state takes one signed command; investigating a breach that was not contained takes weeks.

## 2. How to fire (three entry points)

### 2.1 CLI (preferred)

```bash
batiste audit kill --all --reason "unauthorised tool execution on node-7"
```

Exit code 0 means `KillSwitch.fire()` returned, the ledger wrote the revocation entry, and all connected nodes received the broadcast. The CLI prints the ledger sequence number for follow-up.

### 2.2 Programmatic (for automation)

```ts
import { KillSwitch } from '@batiste-aidk/audit';
await KillSwitch.fire({ reason: 'threshold breach: p99 > 30s', actor: 'auto-sre' });
```

Use this only when the automation rule itself is documented (change management review) and the rule cannot produce false positives that would cost more than a precautionary fire.

### 2.3 Dashboard (for non-technical responders)

`packages/web` exposes an Emergency Kill Switch button, gated by an `admin` role. The button opens a confirm modal; confirmation writes the same ledger entry as the CLI.

## 3. What happens

1. `KillSwitch.fire()` flips an in-memory flag (< 100 µs).
2. All `createNode()`-wrapped handlers observe the flag on their next entry and return HTTP 503 with `x-batiste-reason: killed`.
3. Audit ledger receives one `kill_fired` entry with `{actor, reason, sequence, ts_ns}`.
4. Broadcast goes over the SecureGateway to all registered nodes. Each node writes its own `kill_observed` entry when it receives the broadcast.
5. Pending billing cycles are closed at the current boundary (PricingMeter emits partial records).

## 4. Drills (mandatory quarterly)

NIS2 Art. 21(2)(f) and DORA Art. 11(6) both require tested continuity. Schedule a drill every calendar quarter:

1. Announce a 30-minute drill window to stakeholders 24h ahead.
2. Fire during the window: `batiste audit kill --all --reason "Q2-2026 drill"`.
3. Measure: time to revoke (should be < 1 ms inside process, < 100 ms mesh-wide).
4. Restore (§5).
5. File a drill report (`compliance/drills/YYYY-QN.md`) with timings, observed failures, and corrective actions.

## 5. Restore procedure

Do **not** restore until the investigation is closed and the root cause is documented.

```bash
# 1. Confirm the ledger entry that fired the switch.
batiste audit tail --filter kill_fired --last 1

# 2. Issue new signing keys (JWT + TLS) if key compromise was the cause.
batiste auth rotate-keys --all

# 3. Reset the switch.
batiste audit kill --reset --evidence-pack <path/to/investigation-bundle.tar.gz>
```

Reset writes a `kill_reset` ledger entry referencing the evidence-pack hash, so the restore is itself auditable.

## 6. Forensic preservation

Between fire and reset, **do not** delete or modify:

- `.batiste/audit.sqlite` and WAL files;
- node-level `stderr` capture;
- system journal for the last 24 h on each node host.

Produce an evidence pack with `runbooks/audit-evidence-export.md`. Hand it to the investigator. The pack is admissible because the ledger is hash-chained.

## 7. Stakeholder communication template

Replace bracketed fields and send within 15 minutes of fire:

> **Subject:** Batiste mesh revoked — <short reason>
>
> At `<UTC timestamp>` we fired the Batiste kill switch in response to `<reason>`. All agent sessions on the mesh are revoked. No new tool calls will be served until the switch is reset. Expected impact: `<what customer workflows are paused>`. Next update in 30 minutes. Ledger sequence: `<seq>`.

If the event involves personal data and a risk to rights of data subjects, move to the GDPR Art. 33 notification path in [`incident-response.md`](./incident-response.md) §3 within the 72-hour window.
