/**
 * JavaScript strategy — verify symbol + import extraction round-trips.
 */
import { describe, it, expect } from 'vitest';
import Parser from 'tree-sitter';
import { javascriptStrategy } from '../javascript.js';

function parse(source: string): Parser.Tree {
  const parser = new Parser();
  parser.setLanguage(javascriptStrategy.parserFactory() as never);
  return parser.parse(source);
}

describe('javascriptStrategy', () => {
  it('claims the JS extensions', () => {
    expect(javascriptStrategy.name).toBe('javascript');
    expect(javascriptStrategy.extensions).toEqual(
      expect.arrayContaining(['.js', '.jsx', '.mjs', '.cjs'])
    );
  });

  it('extracts function declarations and arrow functions', () => {
    const tree = parse(`
      function greet(name) { return 'hi ' + name; }
      const add = (a, b) => a + b;
    `);
    const symbols = javascriptStrategy.extractSymbols(tree, '');
    const fns = symbols.filter((s) => s.type === 'function');
    expect(fns.map((f) => f.name)).toEqual(expect.arrayContaining(['greet', 'add']));
  });

  it('extracts class declarations and methods with parent class', () => {
    const tree = parse(`
      class Animal {
        constructor(name) { this.name = name; }
        bark() { return 'woof'; }
      }
    `);
    const symbols = javascriptStrategy.extractSymbols(tree, '');
    const classes = symbols.filter((s) => s.type === 'class');
    const methods = symbols.filter((s) => s.type === 'method');
    expect(classes.map((c) => c.name)).toContain('Animal');
    expect(methods.find((m) => m.name === 'bark')?.parentClass).toBe('Animal');
  });

  it('extracts call sites', () => {
    const tree = parse(`console.log('hi'); fetch('/x');`);
    const calls = javascriptStrategy.extractSymbols(tree, '').filter((s) => s.type === 'call');
    expect(calls.map((c) => c.callee)).toEqual(expect.arrayContaining(['log', 'fetch']));
  });

  it('extracts ESM imports (named, default, namespace)', () => {
    const tree = parse(`
      import { foo, bar } from 'pkg';
      import baz from 'qux';
      import * as utils from './utils.js';
    `);
    const imports = javascriptStrategy.extractImports(tree, '');
    expect(imports).toHaveLength(3);
    const named = imports.find((i) => i.modulePath === 'pkg');
    expect(named?.importedSymbols).toEqual(expect.arrayContaining(['foo', 'bar']));
    const def = imports.find((i) => i.modulePath === 'qux');
    expect(def?.isDefault).toBe(true);
    const ns = imports.find((i) => i.modulePath === './utils.js');
    expect(ns?.isNamespace).toBe(true);
  });

  it('extracts CJS require() imports', () => {
    const tree = parse(`const fs = require('fs');`);
    const imports = javascriptStrategy.extractImports(tree, '');
    expect(imports).toHaveLength(1);
    expect(imports[0]?.modulePath).toBe('fs');
  });

  it('round-trips at least one symbol AND one import (Phase 2a contract)', () => {
    const tree = parse(`
      import { x } from 'y';
      function main() { return x; }
    `);
    const symbols = javascriptStrategy.extractSymbols(tree, '');
    const imports = javascriptStrategy.extractImports(tree, '');
    expect(symbols.length).toBeGreaterThan(0);
    expect(imports.length).toBeGreaterThan(0);
  });
});
