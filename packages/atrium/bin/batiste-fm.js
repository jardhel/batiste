#!/usr/bin/env node
import('../dist/index.js').catch((err) => {
  console.error('Fatal:', err && err.message ? err.message : err);
  process.exit(1);
});
