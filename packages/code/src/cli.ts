#!/usr/bin/env node

/**
 * @batiste/code CLI entry point
 */

import { start } from './mcp/server.js';

start().catch((err) => {
  console.error('Failed to start @batiste/code:', err);
  process.exit(1);
});
