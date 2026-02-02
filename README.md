# Batiste

> AI-powered tools that work alongside you like a sous-chef

Named after the legendary sous-chefs who prep, organize, and anticipate needs before you ask. Batiste is a collection of MCP (Model Context Protocol) servers that enhance AI assistants with specialized capabilities.

## Packages

| Package | Description |
|---------|-------------|
| [@batiste/core](./packages/core) | Core infrastructure - task management, context budgeting, agent orchestration |
| [@batiste/code](./packages/code) | Code assistant - TDD, validation, dependency analysis, auto-fix |

## Quick Start

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test
```

## Philosophy

Like a great sous-chef, Batiste tools:

1. **Anticipate needs** - Index and understand your codebase proactively
2. **Prep work** - Handle the tedious tasks so you can focus on the creative work
3. **Stay organized** - Track context, manage tasks, maintain quality
4. **Know when to step back** - Suggest, don't override; assist, don't replace

## License

MIT
