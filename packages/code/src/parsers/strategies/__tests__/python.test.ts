/**
 * Python strategy — verify symbol + import extraction round-trips.
 *
 * Phase 2a parity coverage. `pythonStrategy` is a wrapper around the
 * long-standing `config/PythonStrategy` (same rationale as the
 * TypeScript wrapper: wrap, do not rewrite). These tests guard the
 * strategy's *behaviour* through the Phase 2a surface so a future
 * refactor of either the wrapper or the legacy strategy cannot
 * silently regress Python parsing, and so Python matches the test
 * coverage already shipped for go / rust / javascript.
 */
import { describe, it, expect } from 'vitest';
import Parser from 'tree-sitter';
import { pythonStrategy } from '../python.js';

function parse(source: string): Parser.Tree {
  const parser = new Parser();
  parser.setLanguage(pythonStrategy.parserFactory() as never);
  return parser.parse(source);
}

describe('pythonStrategy', () => {
  it('claims the .py and .pyi extensions', () => {
    expect(pythonStrategy.name).toBe('python');
    expect(pythonStrategy.extensions).toContain('.py');
    expect(pythonStrategy.extensions).toContain('.pyi');
  });

  it('exposes query patterns for the tree-sitter Query API', () => {
    const patterns = pythonStrategy.getQueryPatterns?.();
    expect(patterns).toBeDefined();
    expect(patterns?.functionDefinitions).toContain('function_definition');
    expect(patterns?.callSites).toContain('call');
    expect(patterns?.classDefinitions).toContain('class_definition');
  });

  it('extracts top-level functions', () => {
    const tree = parse(`
def greet(name):
    return "hi " + name

def add(a, b):
    return a + b
`);
    const fns = pythonStrategy.extractSymbols(tree, '').filter((s) => s.type === 'function');
    expect(fns.map((f) => f.name)).toEqual(expect.arrayContaining(['greet', 'add']));
  });

  it('extracts class definitions', () => {
    const tree = parse(`
class Animal:
    pass

class Greeter:
    pass
`);
    const classes = pythonStrategy.extractSymbols(tree, '').filter((s) => s.type === 'class');
    expect(classes.map((c) => c.name)).toEqual(expect.arrayContaining(['Animal', 'Greeter']));
  });

  it('extracts methods with the enclosing class as parentClass', () => {
    const tree = parse(`
class Animal:
    def __init__(self, name):
        self.name = name

    async def speak(self):
        return self.name
`);
    const methods = pythonStrategy.extractSymbols(tree, '').filter((s) => s.type === 'method');
    expect(methods.find((m) => m.name === '__init__')?.parentClass).toBe('Animal');
    expect(methods.find((m) => m.name === 'speak')?.parentClass).toBe('Animal');
  });

  it('distinguishes module-level functions from class methods', () => {
    const tree = parse(`
class Box:
    def open(self):
        return True

def standalone():
    return False
`);
    const symbols = pythonStrategy.extractSymbols(tree, '');
    const open = symbols.find((s) => s.name === 'open');
    const standalone = symbols.find((s) => s.name === 'standalone');
    expect(open?.type).toBe('method');
    expect(open?.parentClass).toBe('Box');
    expect(standalone?.type).toBe('function');
    expect(standalone?.parentClass).toBeUndefined();
  });

  it('extracts call sites including bare and attribute calls', () => {
    const tree = parse(`
import os
import numpy as np

def main():
    greet("world")
    os.getcwd()
    np.array([1, 2])
`);
    const calls = pythonStrategy.extractSymbols(tree, '').filter((s) => s.type === 'call');
    const callees = calls.map((c) => c.callee);
    // bare identifier call -> greet, attribute calls -> getcwd, array
    expect(callees).toEqual(expect.arrayContaining(['greet', 'getcwd', 'array']));
  });

  it('reports 1-indexed line numbers for symbols', () => {
    const tree = parse(`def first():
    pass

def second():
    pass
`);
    const symbols = pythonStrategy.extractSymbols(tree, '');
    expect(symbols.find((s) => s.name === 'first')?.startLine).toBe(1);
    expect(symbols.find((s) => s.name === 'second')?.startLine).toBe(4);
  });

  it('extracts plain and dotted imports', () => {
    const tree = parse(`
import os
import os.path
`);
    const imports = pythonStrategy.extractImports(tree, '');
    const os = imports.find((i) => i.modulePath === 'os');
    const osPath = imports.find((i) => i.modulePath === 'os.path');
    expect(os?.importedSymbols).toContain('os');
    expect(os?.isNamespace).toBe(true);
    // dotted import pulls the last segment as the bound symbol
    expect(osPath?.importedSymbols).toContain('path');
  });

  it('extracts aliased imports (import x as y)', () => {
    const tree = parse(`import numpy as np`);
    const imports = pythonStrategy.extractImports(tree, '');
    const np = imports.find((i) => i.modulePath === 'numpy');
    expect(np).toBeDefined();
    expect(np?.importedSymbols).toEqual(['np']);
  });

  it('extracts from-imports with multiple named symbols', () => {
    const tree = parse(`from collections import OrderedDict, defaultdict`);
    const imports = pythonStrategy.extractImports(tree, '');
    const coll = imports.find((i) => i.modulePath === 'collections');
    expect(coll).toBeDefined();
    expect(coll?.importedSymbols).toEqual(expect.arrayContaining(['OrderedDict', 'defaultdict']));
    expect(coll?.isNamespace).toBe(false);
  });

  it('extracts aliased from-imports (from m import x as y)', () => {
    const tree = parse(`from .utils import helper as h`);
    const imports = pythonStrategy.extractImports(tree, '');
    const util = imports.find((i) => i.modulePath === '.utils');
    expect(util).toBeDefined();
    // alias is the bound name
    expect(util?.importedSymbols).toEqual(['h']);
  });

  it('extracts relative imports (from . import x)', () => {
    const tree = parse(`from . import sibling`);
    const imports = pythonStrategy.extractImports(tree, '');
    const rel = imports.find((i) => i.importedSymbols.includes('sibling'));
    expect(rel).toBeDefined();
    expect(rel?.modulePath).toBe('.');
  });

  it('extracts wildcard from-imports as a namespace import', () => {
    const tree = parse(`from typing import *`);
    const imports = pythonStrategy.extractImports(tree, '');
    const typing = imports.find((i) => i.modulePath === 'typing');
    expect(typing).toBeDefined();
    expect(typing?.importedSymbols).toEqual(['*']);
    expect(typing?.isNamespace).toBe(true);
  });

  it('handles a syntactically valid module with mixed constructs', () => {
    const tree = parse(`
import os
from typing import List

class Service:
    def run(self, items: List[str]) -> int:
        return len(items)

def factory() -> Service:
    return Service()
`);
    expect(tree.rootNode.hasError).toBe(false);
    const symbols = pythonStrategy.extractSymbols(tree, '');
    expect(symbols.find((s) => s.name === 'Service')?.type).toBe('class');
    expect(symbols.find((s) => s.name === 'run')?.parentClass).toBe('Service');
    expect(symbols.find((s) => s.name === 'factory')?.type).toBe('function');
  });

  it('still extracts recoverable symbols from a file with a syntax error', () => {
    // tree-sitter is error-tolerant: a broken function body should not
    // stop extraction of the well-formed declarations around it.
    const tree = parse(`
def good():
    return 1

def broken(:
    return 2

class Healthy:
    pass
`);
    expect(tree.rootNode.hasError).toBe(true);
    const names = pythonStrategy.extractSymbols(tree, '').map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining(['good', 'Healthy']));
  });

  it('round-trips at least one symbol AND one import (Phase 2a contract)', () => {
    const tree = parse(`
import os
def main():
    return os.getcwd()
`);
    const symbols = pythonStrategy.extractSymbols(tree, '');
    const imports = pythonStrategy.extractImports(tree, '');
    expect(symbols.length).toBeGreaterThan(0);
    expect(imports.length).toBeGreaterThan(0);
  });
});
