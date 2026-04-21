# Batiste · Public Specifications

This directory holds the canonical, vendor-neutral specifications that Batiste publishes as market standards. Each specification is licensed under Creative Commons BY 4.0 and is editable via pull request.

Batiste is the **reference implementation** of every specification here. Batiste's presence as editor does not privilege it — compliance is mechanical, measured by the validation rules inside each spec.

## Published specifications

| Spec | Version | Status | Description |
|---|---|---|---|
| [GVS](./gvs-0.1.md) | 0.1-draft | Draft | Governance Vault Specification — filesystem layout, metadata schema, and linking discipline for AI-governed ledger vaults. |

## Editorial process

- **Editor:** Cachola Tech Holding B.V. (in formation), Eindhoven.
- **Correspondence:** `hello@cachola.tech`.
- **Versioning:** Semantic. Drafts carry a `-draft` suffix and may change without notice until the `1.0` of each specification. After 1.0, breaking changes require a major version bump and a written migration note.
- **Licensing:** CC-BY-4.0 for the specification text. Reference implementations may carry separate licenses.

## Why specifications live in the Batiste repository

Specifications that emerge from working products mature faster than specifications written in committee. The Batiste repository is where GVS is proven against daily use; publishing the spec next to the implementation keeps the two from drifting. Other implementations are invited to fork the spec and exercise it against their own code.

The intent over time is that this directory becomes a small family of related protocols — governance vaults (GVS), agent authority contracts, inter-firm dossier exchange, audit-log interoperability — each published here as it stabilizes inside Batiste.

## Proposing a new specification

Open a draft pull request against this directory with a file named `<slug>-0.1.md` and a one-paragraph proposal. Drafts are reviewed for scope fit (governance, not general software), for mechanical validatability, and for absence of vendor coupling. Accepted drafts move to `<slug>-0.1-draft.md` status; when stable and exercised in production by at least two distinct implementations, they move to `1.0`.
