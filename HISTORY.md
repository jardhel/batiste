<div align="center">
  <img src="./assets/logo.png" width="120" alt="Batiste Logo" />

  # The Story of Batiste
  *From a local RAG server to an autonomous agent marketplace*
</div>

---

## The Beginning — seu-claude

Everything started with frustration.

In early 2025, working on large TypeScript monorepos, the same problem kept surfacing: AI assistants — as powerful as they were — had no real memory of the codebase. Every conversation started from scratch. Every refactor request required pasting context by hand. Every code review meant re-explaining architecture decisions the model had already reasoned through three sessions ago.

The fix was **[seu-claude](https://github.com/jardhel/seu-claude)** — a local RAG (Retrieval-Augmented Generation) MCP server that gave Claude Code proactive, semantic awareness of a codebase. It indexed files with AST-based chunking, stored embeddings locally, and surfaced relevant context automatically before a model ever had to ask.

It worked. It worked well enough that the next question became obvious:

*If one node can give an AI assistant memory of a codebase — what happens when you have a network of nodes, each specialised in a different capability?*

---

## The Insight

seu-claude was a single node. A specialised tool that did one thing well and stayed out of the way.

But real enterprise AI workflows are not single-node problems. A lawyer reviewing a contract needs a PDF extractor, a clause classifier, a compliance checker, and a document store — all connected, all audited, all running on data that cannot leave the firm's network.

A developer migrating a legacy system needs an AST analyser, a test runner, an autofix engine, and a scope enforcer — all coordinated, all accountable.

The pattern was always the same: **a collection of specialised nodes that needed to be discovered, routed to, billed, and governed.** What was missing was the marketplace layer that connected them.

That missing layer became Batiste.

---

## The Name

Batiste is named after the legendary sous-chef — the person in a professional kitchen who nobody in the dining room ever meets, but without whom nothing would ship.

The sous-chef doesn't cook the signature dish. They prep. They organise. They anticipate what the head chef will need before the order is called. They keep the kitchen running so that the people doing the visible, creative work can do it without friction.

That is exactly what infrastructure should do.

The best infrastructure is invisible. It is already three steps ahead. It handles the routing, the billing, the audit trail, the access control — so that the developer, the lawyer, the analyst never has to think about it.

**Batiste never clutters the workspace. It is already done.**

---

## The Build — Q1 2026

The first public beta was built in a single focused sprint in March 2026, dogfooding Batiste's own tooling throughout.

Every new package was analysed with `@batiste-aidk/code`. Every API was validated against the zero-trust middleware chain. The architecture decisions were documented as they were made, not retroactively.

The packages that shipped:

| Package | What it represents |
|---|---|
| `@batiste-aidk/marketplace` | The routing and billing core — the market itself |
| `@batiste-aidk/transport` | The secure gateway — how nodes are reached |
| `@batiste-aidk/connectors` | The proprietary data layer — PDF and CSV as first-class tools |
| `@batiste-aidk/code` | The original seu-claude capability, evolved into a full MCP node |
| `@batiste-aidk/audit` | The compliance backbone — the ledger that makes enterprise sign-off possible |
| `@batiste-aidk/auth` | The trust layer — JWT-based, scoped, revocable |
| `@batiste-aidk/scope` | The AST-level guardrails — what an agent can and cannot touch |
| `@batiste-aidk/aidk` | The developer SDK — `createNode()` in a single function call |
| `@batiste-aidk/cli` | The terminal interface — `batiste node start`, `connect`, `audit tail` |

446 tests. Zero cloud dependencies. Fully self-hosted.

---

## The Vision

Batiste is not a developer tool. It is the infrastructure layer that makes agentic enterprise software possible.

The $120B market for enterprise automation is being reshaped by AI agents right now. But most organisations cannot deploy agents in production because they have no way to audit them, scope them, bill them, or shut them down. Batiste exists to change that.

The vision is Jarvis — not the interface, but the invisible intelligence underneath. The system that makes everything work, that knows what is needed before it is asked for, that never fails, never leaks, never loses a record.

**Batiste is the real-world materialisation of that idea.**

---

## Where It's Going

| Quarter | Milestone |
|---|---|
| Q1 2026 | Seed + Alpha — marketplace core, CLI, public beta *(now)* |
| Q2 2026 | Public Mainnet V1 — open node registry, creator dashboard |
| Q3 2026 | Enterprise Auth — SSO, SAML, multi-tenant scoping |
| Q4 2026 | Global Scale — geo-routing, SLA tiers, compliance exports |

---

## The Team

Batiste is being built from **Eindhoven, Netherlands**.

The seed round is open. If you are an investor, an enterprise engineering leader, or someone who has felt the same frustration that started this — reach out.

**jardhel@cachola.tech** · [batiste.network](https://batiste.network) · [github.com/jardhel/batiste](https://github.com/jardhel/batiste)
