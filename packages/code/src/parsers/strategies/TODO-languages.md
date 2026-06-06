# Phase 2a · Remaining Language Strategies

Phase 2a (this commit) shipped **5** default strategies — `typescript`,
`python`, `javascript`, `go`, `rust`. Phases 2a.1+ (separate agent runs)
expand the lineup to ~25. Each bullet below is scoped to a single
one-file commit; follow the **Add-procedure** immediately under the
list.

## Add-procedure (every new language)

1. `pnpm add --filter @batiste-aidk/code tree-sitter-<lang>@^0.21.0`
   (pin to the `0.21.x` line so it matches the `tree-sitter@^0.21.0`
   host). If no `0.21.x` is published, use the closest compatible
   minor — the test suite will catch ABI mismatches immediately.
2. Create `src/parsers/strategies/<lang>.ts` exporting a const
   `<lang>Strategy: LanguageStrategy`.
3. Add the new strategy to `DEFAULT_STRATEGIES` in
   `src/parsers/strategies/index.ts` AND to the dynamic-import list in
   `defaultRegistry()` inside `src/parsers/strategies/registry.ts`.
4. Write `src/parsers/strategies/__tests__/<lang>.test.ts` — assert at
   least one symbol and one import round-trip.
5. Add the language's extensions to the integration test's `SAMPLES`
   list (`src/__tests__/parsers-integration.test.ts`).
6. `pnpm --filter @batiste-aidk/code typecheck && build && test`.

## Priority 1 — highest-ROI languages (target: Phase 2a.1)

- **java** — `tree-sitter-java`. Biggest enterprise surface we don't
  cover yet; required for every Java shop DD conversation.
- **c** — `tree-sitter-c`. Kernel/embedded/OSS tooling.
- **cpp** — `tree-sitter-cpp`. Follows on from `c`; same ecosystem.
- **csharp** — `tree-sitter-c-sharp`. .NET enterprise coverage.
- **ruby** — `tree-sitter-ruby`. Rails monoliths that dominate many
  mid-market shops.

## Priority 2 — scripting & shells (target: Phase 2a.2)

- **bash** — `tree-sitter-bash`. Shell scripts in every repo; feeds
  supply-chain analysis.
- **lua** — `tree-sitter-lua`. Game engines, Neovim configs.
- **perl** — `tree-sitter-perl` (community fork). Legacy enterprise.
- **php** — `tree-sitter-php`. WordPress / Laravel ecosystem.
- **r** — `tree-sitter-r`. Data science pipelines.

## Priority 3 — JVM & typed scripting (target: Phase 2a.3)

- **kotlin** — `tree-sitter-kotlin` (community). Android + JVM modern.
- **scala** — `tree-sitter-scala`. Data engineering (Spark).
- **swift** — `tree-sitter-swift`. iOS/macOS.
- **elixir** — `tree-sitter-elixir`. Phoenix / distributed systems.
- **erlang** — `tree-sitter-erlang`. Telecoms / OTP.

## Priority 4 — infra-as-code & data (target: Phase 2a.4)

- **hcl** — `tree-sitter-hcl`. Terraform / HashiCorp configs — aligns
  with the HashiCorp-wedge strategy.
- **yaml** — `tree-sitter-yaml`. K8s manifests, CI configs.
- **toml** — `tree-sitter-toml`. Rust / Python / pyproject configs.
- **sql** — `tree-sitter-sql`. Stored procedures / migrations.
- **dockerfile** — `tree-sitter-dockerfile`. Supply-chain context.

## Priority 5 — remaining coverage (target: Phase 2a.5)

- **markdown** — `tree-sitter-markdown`. Doc-as-code.
- **html** — `tree-sitter-html`. Template analysis.
- **css** — `tree-sitter-css`. Design-system scope.
- **json** — `tree-sitter-json`. Package manifests / lockfiles.
- **zig** — `tree-sitter-zig`. New systems-lang coverage.

That is 25 additional languages beyond the 5 Phase 2a ships, for a
total of 30 — the roadmap target of ~25 can stop at any point after
Priority 4, depending on enterprise-DD demand.
