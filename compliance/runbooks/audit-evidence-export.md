# Runbook — Audit Evidence Export

**Purpose:** produce a byte-reproducible, hash-chained NDJSON export of the audit ledger for auditors, regulators, or incident investigators.
**Supports:** ISO 27001 A.5.28 & A.8.15, SOC 2 CC7.3, GDPR Art. 30, DORA Art. 17, EU AI Act Art. 12, NIS2 Art. 23.

## 1. What the export contains

Each line in the NDJSON output is one ledger entry. Fields:

| Field | Type | Meaning |
|---|---|---|
| `seq` | integer | Strictly monotonic sequence number |
| `ts_ns` | integer | Nanoseconds since Unix epoch (UTC) |
| `kind` | string | `tool_call`, `tool_result`, `auth_failure`, `kill_fired`, `kill_reset`, `key_rotated`, ... |
| `actor` | string | Node / session / user identifier |
| `subject` | string | Path or resource touched (scope-normalised) |
| `detail` | object | Type-specific payload (no PII by default) |
| `prev_hash` | hex | BLAKE3 of the previous entry's canonical JSON |
| `hash` | hex | BLAKE3 of this entry's canonical JSON, computed including `prev_hash` |

The chain allows any auditor to verify tamper-evidence by re-computing hashes.

## 2. Exporting

```bash
# Full export from a ledger file
batiste audit export \
  --in .batiste/audit.sqlite \
  --out /tmp/evidence-$(date -u +%Y%m%dT%H%M%SZ).ndjson \
  --verify

# Windowed export (incident investigation)
batiste audit export \
  --in .batiste/audit.sqlite \
  --from 2026-04-18T00:00:00Z \
  --to   2026-04-20T00:00:00Z \
  --out /tmp/incident-2026-04-window.ndjson \
  --verify
```

`--verify` re-computes the hash chain and fails if any break is detected. Keep the flag on for every export intended as evidence.

## 3. Hash manifest

Every export is paired with a manifest file:

```bash
batiste audit manifest \
  --in /tmp/evidence-20260420T080000Z.ndjson \
  --out /tmp/evidence-20260420T080000Z.manifest.json
```

Manifest fields:

- `file_sha256` — SHA-256 of the NDJSON file
- `first_seq`, `last_seq`
- `first_hash`, `last_hash`
- `entry_count`
- `exported_at` (UTC)
- `batiste_version`

Sign the manifest with the customer's evidence signing key (recommended: sigstore/cosign):

```bash
cosign sign-blob --key cosign.key /tmp/evidence-20260420T080000Z.manifest.json
```

## 4. Chain-of-custody log

For every export that leaves the customer's premises, record in `compliance/exports-log.md`:

| Date (UTC) | Export file | Manifest | Recipient | Purpose | Approver |
|---|---|---|---|---|---|
| 2026-04-20T08:00Z | evidence-...ndjson | evidence-...manifest.json | Audit firm X | SOC 2 Type II | CISO |

## 5. Redaction

If the ledger ever contains personal data (not the default; see Data Protection Policy §2), redact before export:

```bash
batiste audit export \
  --in .batiste/audit.sqlite \
  --redact-pii \
  --out /tmp/evidence-redacted.ndjson \
  --verify
```

`--redact-pii` replaces flagged fields with `"[redacted]"` **but preserves the hash chain** by re-keying via a deterministic redaction hash. The redaction key is stored in the customer's secrets manager; without it, redacted entries cannot be reversed.

The unredacted file stays in the customer's vault under the retention period and is provided only on controller instruction.

## 6. Reproducibility check (for auditors)

Given an NDJSON file and its manifest, an auditor can verify:

```bash
batiste audit verify /tmp/evidence-20260420T080000Z.ndjson
# Exit 0: chain intact, matches manifest.
# Exit 2: chain broken at seq=<n>. Report finding.
```

The verifier is a standalone binary; it does not require a running Batiste node or access to the original SQLite file.

## 7. Retention

Default retention: 6 years (exceeds DORA Art. 12 ICT log retention and GDPR statute-of-limitations requirements). Configure with `.batiste/config.yaml`:

```yaml
audit:
  retentionDays: 2190    # 6 years
  rotation: monthly
  archive: /var/lib/batiste/audit-archive
```

Archived ledgers keep the hash chain across rotations.
