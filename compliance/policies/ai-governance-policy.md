# AI Governance Policy

**Owner:** Security Lead + DPO · **Version:** 0.1.0 · **Effective:** 2026-04-20
**Maps to:** EU AI Act (Regulation 2024/1689) Arts. 4, 9, 10, 12, 13, 14, 15, 17, 50; ISO/IEC 42001:2023.

## 1. Role under the EU AI Act

Batiste is a **component** used inside AI systems built by customers. Batiste itself is not an AI model. Customers who build **high-risk AI systems** (Annex III) that embed Batiste may treat our product as a safety-relevant subsystem; we support them by producing the technical documentation artefacts below and by keeping the audit ledger suitable as a logging substrate under Art. 12.

Where Batiste's distribution includes optional model-based features (e.g., embedded code-completion models), those features fall under the GPAI provisions; see §6.

## 2. Risk management (Art. 9)

We maintain a continuous risk-management process:

- Threat models per development eixo (`/.batiste/eixo*.md`), updated on material change.
- Vulnerability management through `pnpm audit`, dependency pinning, SBOM diffs per release.
- Annual penetration test commissioned by an independent party once customer-base justifies it; meanwhile, internal red-team review per release.
- Residual risks are listed in the Annex IV documentation and communicated to customers.

## 3. Data governance (Art. 10)

Applies when Batiste processes training or evaluation data on behalf of a customer. By default it does not. If enabled:

- Data quality criteria documented per dataset (provenance, license, labelling protocol).
- Bias examination: statistically meaningful sampling, with findings documented in the dataset's README.
- Special category data is not processed unless Art. 10(5) legal basis applies.

## 4. Record-keeping (Art. 12)

The Batiste append-only audit ledger satisfies Art. 12(1) for "automatic recording of events". Retention defaults to 6 years; customers may extend. NDJSON export is the Art. 12(2) output format for independent inspection.

## 5. Transparency and instructions for use (Art. 13)

We ship with each release:

- `README.md` describing capabilities and limits in plain language.
- `ARCHITECTURE.md` describing the system.
- `compliance/frameworks/eu-ai-act-annex-iv.md` populated for that version.
- A changelog identifying material changes that could affect conformity.

## 6. Human oversight (Art. 14)

The customer's deployment is expected to place a human in the loop where the AI system's decision affects individuals. Batiste provides mechanisms that make oversight effective:

- Every tool call can be paused or rejected by Scope/Auth before execution.
- The kill switch is a documented, one-command human override.
- The ledger is designed to support post-hoc review, not only real-time monitoring.

## 7. Accuracy, robustness, cybersecurity (Art. 15)

- Accuracy levels of optional embedded models are stated in their model cards; see `/docs/model-cards/`.
- Robustness: 446 tests without mocks; property-based tests for Scope; fuzzing of the connector parsers (TODO: publish fuzz corpus location).
- Cybersecurity: see the Information Security Policy and the control mapping.

## 8. GPAI provisions (if applicable)

If Batiste ships an embedded general-purpose AI model (not in v0.1.0):

- Publish training-data summary per Art. 53.
- Copyright policy compliant with Art. 53(1)(c).
- Model card, evals, known limitations.
- If systemic-risk classified (Art. 55), add red-teaming report + serious-incident reporting process.

## 9. Prohibited practices (Art. 5)

Batiste and customers who deploy it commit not to use it to implement any practice prohibited under Art. 5 (social scoring, exploitative manipulation, biometric categorisation of sensitive attributes, real-time remote biometric identification in public spaces, predictive policing based solely on profiling, emotion recognition in workplaces/schools except safety and medical, untargeted biometric database scraping).

## 10. Post-market monitoring (Art. 72)

We monitor customer-reported incidents, ledger anomaly statistics (aggregate only), and CVE reports against our dependencies. Findings feed Art. 9 risk management and Art. 73 serious-incident reporting.

## 11. Training (Art. 4 AI literacy)

Every employee and contractor who touches Batiste completes a one-hour AI Act literacy module annually. Records kept for 5 years.
