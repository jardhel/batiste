#!/usr/bin/env node

/**
 * @batiste-aidk/code CLI entry point
 */

import { start } from './mcp/server.js';

start().catch((err) => {
  console.error('Failed to start @batiste-aidk/code:', err);
  process.exit(1);
});
