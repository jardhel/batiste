# Runbook — Right to Erasure (GDPR Art. 17)

**Purpose:** fulfil a data subject's erasure request within one month (Art. 12(3)), while preserving the tamper-evident audit trail that frameworks such as DORA, NIS2 and ISO 27001 require.
**Supports:** GDPR Art. 17, Art. 12, Art. 30; EU AI Act Art. 10(5) where training-data provenance is recorded.

## 1. Eligibility check

Not every erasure request is valid. Confirm one of the Art. 17(1) grounds applies and that no Art. 17(3) exception overrides (e.g., compliance with legal obligation, public interest, legal claims).

Fill out `compliance/dsr-log.md` before acting:

| Field | Value |
|---|---|
| Request ID | DSR-YYYYMMDD-NN |
| Received | UTC timestamp, channel |
| Requester identity verified | yes/no, method |
| Legal ground (Art. 17(1)) | a/b/c/d/e/f |
| Exceptions considered (Art. 17(3)) | none / cite |
| Decision | grant / refuse / partially grant |
| Deadline | received + 1 month (may extend +2 if complex, Art. 12(3)) |

## 2. Locate personal data

Batiste by default does **not** store personal data in the audit ledger. Customer deployments may differ. Run the locator:

```bash
batiste dsr locate --subject "<subject-id>" --out /tmp/dsr-locate.json
```

The locator searches:

- Ledger entries (`subject`, `actor`, `detail.*` matched against the subject identifier and its known aliases).
- Connector-emitted content under `.batiste/connector-cache/` (only if caching is enabled).
- PricingMeter billing records for that subject (usually tenant-scoped, not subject-scoped).

Output is a list of locations. Anything **outside Batiste** (source repositories, CI logs, customer databases) is the controller's responsibility.

## 3. Erase — cache and connector content

```bash
batiste dsr erase \
  --subject "<subject-id>" \
  --scope connector-cache \
  --confirm
```

This physically removes cached content and writes a `dsr_erase_cache` ledger entry with the number of items removed and a BLAKE3 of the removal manifest. The content is gone; the fact of erasure is recorded.

## 4. Redact — audit ledger

The audit ledger itself **must not be deleted**: that would break the hash chain and violate integrity requirements (GDPR Art. 5(1)(f), DORA Art. 12(1), ISO A.8.15). Instead, redact:

```bash
batiste dsr redact \
  --subject "<subject-id>" \
  --reason "DSR-YYYYMMDD-NN Art.17(1)(a)" \
  --confirm
```

What happens:

- Fields flagged as PII for the matched entries are replaced with `"[redacted: DSR-YYYYMMDD-NN]"`.
- The entries are re-hashed using the same canonical JSON rules.
- A `dsr_redact` meta-entry is appended with `{subject_alias, count, reason}`.
- The hash chain remains continuous because redaction is implemented as a structural update that feeds the new entry into the chain (documented in `packages/audit/src/dsr.md`).

The controller's deletion key (stored in a hardware security module or password manager) is required; without it, redaction cannot be reversed and the hash chain cannot be reforged.

## 5. Confirm to data subject

Within the statutory month:

> We received your request on <date>. Under Article 17 GDPR we have <erased | partially erased> the personal data we held about you. Specifically: <short description>. We were not able to erase the following, because <legal basis>: <list, or "none">. Your rights to lodge a complaint with your supervisory authority are set out at <link to national DPA>.

Log the response in the DSR log.

## 6. Downstream processors

If Batiste acted as a processor for the customer (controller), notify the controller as soon as possible. If Batiste in turn relies on sub-processors (unusual for the air-gapped deployment model), the customer controller's DPA Art. 28(4) instructions apply — propagate the erasure to each sub-processor and keep their confirmations in the DSR log.

## 7. Metrics

Report quarterly to the DPO:

- Number of requests received, granted, refused (with grounds), partially granted.
- Median and p95 time-to-close.
- Any Art. 12(3) extensions used.

Numbers feed the ROPA (Art. 30 records).
