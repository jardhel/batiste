# Contributing to Batiste

First off — thank you. Every contribution, no matter the size, makes Batiste better for everyone building on it.

This guide covers everything you need to go from zero to opening a pull request.

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How Can I Contribute?](#how-can-i-contribute)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Making Changes](#making-changes)
- [Pull Request Guidelines](#pull-request-guidelines)
- [Commit Convention](#commit-convention)
- [Reporting Bugs](#reporting-bugs)
- [Suggesting Features](#suggesting-features)

---

## Code of Conduct

This project follows a simple rule: **be respectful**. We are building tools that developers will trust with production infrastructure. The same level of care goes into how we treat each other.

Harassment, discrimination, or bad-faith behaviour of any kind will not be tolerated.

---

## How Can I Contribute?

There are many ways to help beyond writing code:

- **Star the repo** — it helps discoverability and signals momentum to potential contributors
- **Report bugs** — open a detailed issue with reproduction steps
- **Suggest features** — open a discussion before starting large work
- **Improve documentation** — typos, unclear sections, missing examples all count
- **Write tests** — especially integration tests for edge cases
- **Build a node** — create a specialised MCP node and publish it to the marketplace
- **Share it** — write about Batiste, post about it, tell your team

---

## Development Setup

**Prerequisites:** Node.js ≥ 20, pnpm ≥ 9

```bash
# 1. Fork the repository on GitHub, then clone your fork
git clone https://github.com/<your-username>/batiste.git
cd batiste

# 2. Install all workspace dependencies
pnpm install

# 3. Build all packages
pnpm build

# 4. Run the full test suite to verify your setup
pnpm test

# 5. Run the investor demo to confirm the end-to-end flow works
npx tsx examples/investor-demo/run.ts
```

If all 446 tests pass and the demo completes cleanly, you are ready to contribute.

---

## Project Structure

```
batiste/
├── packages/
│   ├── aidk/           createNode() factory
│   ├── audit/          Append-only audit ledger + kill switch
│   ├── auth/           JWT token issuance and verification
│   ├── cli/            batiste CLI binary
│   ├── code/           Code analysis MCP server (AST, TDD, AutoFix)
│   ├── connectors/     PDF + CSV/ETL MCP connectors
│   ├── core/           Shared MCP primitives + orchestration
│   ├── marketplace/    Node registry, routing, billing
│   ├── scope/          AST-level access policy enforcement
│   ├── transport/      Secure HTTP gateway + PerformanceTracker
│   └── web/            Dashboard UI
├── examples/
│   ├── investor-demo/  End-to-end showcase script
│   ├── local-node/     Local stdio node example
│   └── remote-agent/   Remote gateway agent example
├── ARCHITECTURE.md     Technical deep-dive
└── CONTRIBUTING.md     This file
```

Each package under `packages/` is an independent workspace. See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full dependency graph and design decisions.

---

## Making Changes

### 1. Create a branch

```bash
git checkout -b feat/your-feature-name
# or
git checkout -b fix/the-bug-you-are-fixing
```

### 2. Work in the relevant package

Each package has its own `src/`, `__tests__/`, and `vitest.config.ts`. Run tests for just that package during development:

```bash
pnpm --filter @batiste-aidk/marketplace test
pnpm --filter @batiste-aidk/transport test:watch
```

### 3. Write or update tests

All packages use **Vitest** with real SQLite `:memory:` — no mocks for storage. Every new behaviour should have a test. Every bug fix should include a regression test.

```bash
# Run a single package's tests
pnpm --filter @batiste-aidk/<package-name> test

# Run the full suite
pnpm test
```

### 4. Build before committing

```bash
pnpm build
```

TypeScript errors are blocking. The build must pass cleanly.

---

## Pull Request Guidelines

- **Keep PRs focused** — one logical change per PR. Large PRs are hard to review and slow to merge.
- **Reference an issue** — if your PR fixes or implements something tracked, link it with `Fixes #123` or `Closes #123`.
- **Write a clear description** — explain what changed and why, not just what the diff shows.
- **All tests must pass** — CI will run the full suite. Don't open a PR with known failures.
- **No breaking changes without discussion** — open an issue first if your change modifies a public API.

### PR title format

Follow the [Conventional Commits](https://www.conventionalcommits.org/) spec:

```
feat: add geo-routing to RoutingLayer
fix: handle null latency in PerformanceTracker.percentile
docs: add CSV connector examples to README
chore: bump better-sqlite3 to v11.10.0
test: add regression for kill switch after heartbeat timeout
```

---

## Commit Convention

We use [Conventional Commits](https://www.conventionalcommits.org/):

| Prefix | When to use |
|---|---|
| `feat:` | A new feature |
| `fix:` | A bug fix |
| `docs:` | Documentation only |
| `test:` | Adding or fixing tests |
| `chore:` | Maintenance, deps, tooling |
| `refactor:` | Code change with no behaviour change |
| `perf:` | Performance improvement |

---

## Reporting Bugs

Open an issue and include:

1. **Environment** — Node version, OS, pnpm version
2. **Steps to reproduce** — the minimal set of commands that triggers the bug
3. **Expected behaviour** — what you expected to happen
4. **Actual behaviour** — what actually happened, including any error output
5. **Package** — which `@batiste-aidk/*` package is affected

The more specific your report, the faster we can fix it.

---

## Suggesting Features

Before writing code for a large feature:

1. Open a GitHub Discussion or issue tagged `enhancement`
2. Describe the problem you are solving, not just the solution
3. Wait for feedback before investing significant time

This avoids duplicated effort and ensures new features align with the project's direction.

---

## Questions?

If something in this guide is unclear or you're stuck on setup, open an issue tagged `question` or reach out directly:

**jardhel@cachola.tech**

We want contributing to feel easy. If it doesn't, that's a bug we want to fix.
