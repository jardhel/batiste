# Runbook — Incident Response

**Purpose:** detect, triage, contain, eradicate, recover, and report security incidents affecting Batiste or customer data processed through Batiste.
**Supports:** GDPR Art. 33-34 (breach notification 72h), NIS2 Art. 23 (early warning 24h / incident notification 72h / final report 1 month), DORA Art. 17-19 (major ICT-related incident reporting), ISO 27001 A.5.24-26, SOC 2 CC7.3-7.5.

## 0. Severity matrix

| Severity | Definition | Responder | Target ack |
|---|---|---|---|
| SEV-0 | Active exfiltration, confirmed key compromise, or regulator stop-order | Security Lead + CISO | 5 min |
| SEV-1 | Confirmed unauthorised access / integrity break / ≥ 1000 data subjects affected | Security Lead | 15 min |
| SEV-2 | Significant service degradation or suspected breach under investigation | On-call SRE | 30 min |
| SEV-3 | Single-host anomaly, no data exposure | On-call SRE | 4 h |

## 1. Detect

Primary detection sources:

- Audit ledger tail (`batiste audit tail --follow --filter auth_failure,scope_violation,kill_*`).
- Live `GET /metrics` — p99 spike or error rate breach.
- External report (user, researcher, regulator). Create a ticket **before** anything else.
- Vendor alert (dependency CVE, GitHub security advisory).

When a signal arrives, the first responder:

1. Opens an incident ticket (`INC-YYYYMMDD-NN`).
2. Sets initial SEV.
3. Starts an incident channel (Slack/Teams) and invites Security Lead + CISO if SEV ≤ 1.
4. Starts the stopwatch (breach-clock for SEV-0/1).

## 2. Contain

If SEV-0 or confirmed SEV-1: **fire the kill switch first, investigate second.** See [`kill-switch.md`](./kill-switch.md).

For lower severities, containment options in order of preference:

1. Revoke the specific JWT / session.
2. Add a tighter scope deny-list and redeploy affected node.
3. Isolate the node at the SecureGateway (`batiste marketplace disable <node-id>`).
4. Fire the kill switch (always an option).

Every containment action must be logged to the ledger automatically (via the CLI) or manually via `batiste audit note`.

## 3. Notify — 72-hour breach clock (GDPR)

Clock starts at the moment the controller becomes "aware" of a breach (GDPR Art. 33(1)).

| T+ | Action |
|---|---|
| 0 | Breach confirmed. Ledger entry `breach_confirmed` written. Initial notes captured. |
| 1 h | Customer (if Batiste acted as processor) notified per DPA Art. 28(3)(f). |
| 24 h | NIS2 Art. 23(4)(a) early warning sent to the national CSIRT **if** the incident is significant per Art. 23(3). DORA Art. 19(4)(a) initial notification to the lead overseer **if** DORA-regulated entity and incident is "major". |
| 72 h | GDPR Art. 33 notification to the supervisory authority (for the customer's Member State). NIS2 Art. 23(4)(b) incident notification. |
| 1 month | NIS2 Art. 23(4)(d) final report. DORA Art. 19(4)(c) final report. GDPR follow-ups as needed. |

Under GDPR, if the breach is likely to result in a **high risk** to rights and freedoms of natural persons, notify affected data subjects without undue delay (Art. 34). Template in §5.

## 4. Communication templates

### 4.1 Internal all-hands — SEV-0 / SEV-1

> **Subject:** INC-<id> — SEV-<n> — <short title>
>
> At <UTC> we detected <signal>. Severity set to SEV-<n>. Incident commander: <name>. Comms channel: #inc-<id>. Kill switch <fired|not fired>. Next update in <15|30> min. Do not forward outside the incident channel.

### 4.2 Customer notification (processor → controller)

> At <UTC> we detected an incident affecting the Batiste node(s) in your deployment. Root cause is <under investigation | identified: short description>. Data possibly affected: <description>. Containment actions taken: <list>. We are continuing to investigate and will provide our next update by <UTC + 4h>. This notification is issued under Art. 28(3)(f) of Regulation (EU) 2016/679 and clause <N> of our DPA.

### 4.3 Supervisory authority (GDPR Art. 33)

Use the national authority's template (e.g., AP for Netherlands, CNIL for France). Minimum content per Art. 33(3):

- Nature of the breach, categories and approximate number of data subjects, categories and approximate number of personal data records.
- Name and contact details of the DPO.
- Likely consequences.
- Measures taken or proposed.

Attach the evidence pack exported per [`audit-evidence-export.md`](./audit-evidence-export.md).

### 4.4 Data subject notification (GDPR Art. 34)

Plain language (CEFR B1), directly to the individual:

- What happened, when, what categories of data.
- Likely consequences for them.
- Measures we took and measures they should take (e.g., rotate credentials).
- Contact point.

## 5. Eradicate

- Identify root cause (5-whys, ideally in a Confluence / Notion incident doc).
- Patch all nodes. Ship a hotfix release with signed SBOM.
- Rotate all affected credentials, keys, and secrets.
- Update threat model (`.batiste/eixo3_security_hardening.md`).

## 6. Recover

- Reset the kill switch only after eradication is signed off by Security Lead and evidence pack is archived.
- Restore scopes to normal configuration (remove temporary tight deny-lists once tested safe).
- Monitor closely for 72 h; keep the incident channel open.

## 7. Post-mortem

Within 10 business days, publish a post-mortem to `compliance/post-mortems/INC-<id>.md` with:

- Timeline (UTC, minute-precise).
- Root cause.
- What worked, what did not.
- Action items with owners and due dates.
- Regulatory filings made and their status.

Blameless tone. The post-mortem is itself an audit artefact (ISO 27001 A.5.27).

## 8. Drills

Table-top drill every 6 months; live-fire kill switch drill every quarter (see [`kill-switch.md`](./kill-switch.md) §4). File drill reports to `compliance/drills/`.

## 9. Escalation contacts

Populate per customer deployment:

| Role | Name | Email | Phone |
|---|---|---|---|
| Incident Commander | | | |
| Security Lead | | | |
| DPO | | | |
| Legal | | | |
| Customer CISO | | | |
| National CSIRT | (NL: `cert@ncsc.nl`) | | |
| Supervisory Authority | (NL: AP) | | |
| DORA Lead Overseer | | | |
