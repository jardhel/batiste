# GDPR Art. 35 — Data Protection Impact Assessment (DPIA) Template

> Use this template when a processing activity is likely to result in a high risk to the rights and freedoms of natural persons (Art. 35(1)). The WP248 rev.01 criteria (nine factors) provide the trigger heuristic: if two or more apply, run a DPIA.

## Preamble

- DPIA ID: `DPIA-YYYYMMDD-NN`
- Processing activity:
- Controller: Cachola Tech (or customer, as applicable)
- Joint controllers (if any):
- Processors:
- DPO:
- Date started:
- Date signed off:
- Review schedule: annually or on material change.

## 1. Systematic description of the processing (Art. 35(7)(a))

### 1.1 Nature, scope, context, purposes

### 1.2 Data flow diagram

Attach or reference `compliance/dpia-artifacts/<DPIA-ID>/dataflow.svg`.

### 1.3 Data categories

- Personal data categories:
- Special categories (Art. 9):
- Categories of data subjects:
- Volume:

### 1.4 Retention

### 1.5 Legal basis

### 1.6 Recipients and transfers

## 2. Necessity and proportionality (Art. 35(7)(b))

- Why is this processing necessary for the purpose?
- Could the purpose be achieved with less data?
- Data minimisation measures:
- Accuracy measures:
- Subject-rights handling (Arts. 15-22):
- Sub-processor controls:
- International transfer safeguards:

## 3. Risks to rights and freedoms (Art. 35(7)(c))

For each risk, record: description, likelihood (low / medium / high), severity, sources.

| # | Risk | Likelihood | Severity | Source |
|---|---|---|---|---|
| R1 | Unauthorised access to personal data | | | |
| R2 | Unlawful disclosure via a sub-processor | | | |
| R3 | Inaccuracy leading to harm | | | |
| R4 | Excessive retention | | | |
| R5 | Profiling / automated decision harm (if applicable) | | | |

## 4. Measures to address risks (Art. 35(7)(d))

Map each risk to technical or organisational measures. Reference the control-mapping document: [`../mappings/batiste-to-controls.md`](../mappings/batiste-to-controls.md).

| Risk | Measure | Evidence |
|---|---|---|
| R1 | Scope deny-list, JWT auth, audit ledger | `mappings/batiste-to-controls.md` §§1-3 |
| R2 | Sub-processor list, DPAs, SCC+TIA | `policies/vendor-management-policy.md` |
| R3 | Data accuracy review, subject correction flow | `policies/data-protection-policy.md` §5 |
| R4 | Retention schedule and automated purge | `policies/data-protection-policy.md` §4 |
| R5 | Human oversight via kill switch, ledger review | `policies/ai-governance-policy.md` §6 |

## 5. Residual risk and sign-off

- Residual risk summary:
- DPO opinion:
- Controller decision:
- Prior consultation under Art. 36 required? (yes/no)
- Sign-off signature + date:

## 6. Post-implementation review

Planned review date:
Trigger events that shorten the cycle (new sub-processor, new data category, reported incident): yes/no.
