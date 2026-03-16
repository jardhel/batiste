#!/usr/bin/env node
import('../dist/index.js').catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
