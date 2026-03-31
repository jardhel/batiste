# @batiste-aidk/core

Core infrastructure for Batiste AI tools. Like a well-organized kitchen -- everything in its place.

Named after Batiste, the sous-chef who keeps the kitchen running. He doesn't cook the signature dishes, but nothing would ship without him: tracking orders, managing stations, keeping the line moving.

## Modules

### Task Management
Persistent task DAG with SQLite storage. Tasks survive crashes, organize into hierarchies (goals > subtasks > results), and cache tool outputs to prevent duplicate work.

```typescript
import { TaskManager, SQLiteTaskStore } from '@batiste-aidk/core/tasks';

const store = new SQLiteTaskStore('./tasks.db');
const manager = new TaskManager(store);

const task = await manager.create('Deploy v2');
const subtask = await manager.create('Run tests', task.id);
await manager.updateStatus(subtask.id, 'completed');

// Get full task tree
const tree = await manager.getTree(task.id);
```

### Context Budget
Token budget monitoring across categories. Know when you're approaching limits before you hit them.

```typescript
import { ContextBudgetMonitor } from '@batiste-aidk/core/context';

const budget = new ContextBudgetMonitor({
  totalBudget: 200000,
  warningThreshold: 0.8,
});

budget.add('code', 5000);
const status = budget.getStatus(); // { used, remaining, warnings }
```

### Agent Orchestration
Multi-agent workflows with Kubernetes-inspired pool management. Create agent pools, submit tasks, run workflows with checkpoint recovery.

```typescript
import { Orchestrator, WORKFLOW_TEMPLATES } from '@batiste-aidk/core/agents';

const orch = new Orchestrator();
await orch.createPool('coder', { replicas: 2 });
await orch.createPool('reviewer', { replicas: 1 });

const workflow = WORKFLOW_TEMPLATES.codeReview();
orch.registerWorkflow(workflow);
const execution = await orch.executeWorkflow(workflow.id, { task: 'Add auth' });
```

### Sandbox
Isolated command execution with timeout and resource limits.

```typescript
import { ProcessSandbox } from '@batiste-aidk/core/sandbox';

const sandbox = new ProcessSandbox();
await sandbox.initialize();

const result = await sandbox.execute({
  command: 'npm',
  args: ['test'],
  timeout: 30000,
});

console.log(result.exitCode, result.stdout);
await sandbox.destroy();
```

### MCP Server Factory
Stand up an MCP server with one function call. Handles tool registration, call dispatch, and error formatting.

```typescript
import { createMcpServer, startMcpServer } from '@batiste-aidk/core/mcp';

const server = createMcpServer({
  name: 'my-tool',
  version: '1.0.0',
  tools: MY_TOOL_DEFINITIONS,
  handler: myToolHandler,
});

await startMcpServer(server, 'My Tool');
```

## Install

```bash
pnpm add @batiste-aidk/core
```

## Architecture

```
@batiste-aidk/core
├── tasks/      TaskManager + SQLiteTaskStore
├── context/    ContextBudgetMonitor
├── agents/     Agent, AgentPool, Orchestrator
├── sandbox/    ProcessSandbox
└── mcp/        createMcpServer factory
```

Each module is independently importable via subpath exports (`@batiste-aidk/core/tasks`, `@batiste-aidk/core/agents`, etc.) or from the main entry point.

## License

MIT
