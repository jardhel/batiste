/**
 * Rust strategy — verify symbol + import extraction round-trips.
 */
import { describe, it, expect } from 'vitest';
import Parser from 'tree-sitter';
import { rustStrategy } from '../rust.js';

function parse(source: string): Parser.Tree {
  const parser = new Parser();
  parser.setLanguage(rustStrategy.parserFactory() as never);
  return parser.parse(source);
}

describe('rustStrategy', () => {
  it('claims the .rs extension', () => {
    expect(rustStrategy.name).toBe('rust');
    expect(rustStrategy.extensions).toContain('.rs');
  });

  it('extracts top-level functions', () => {
    const tree = parse(`
      fn greet(name: &str) -> String { name.to_string() }
      fn add(a: i32, b: i32) -> i32 { a + b }
    `);
    const fns = rustStrategy.extractSymbols(tree, '').filter((s) => s.type === 'function');
    expect(fns.map((f) => f.name)).toEqual(expect.arrayContaining(['greet', 'add']));
  });

  it('extracts struct/enum/trait as classes', () => {
    const tree = parse(`
      struct Animal { name: String }
      enum Status { Ok, Err }
      trait Greeter { fn greet(&self) -> String; }
    `);
    const classes = rustStrategy.extractSymbols(tree, '').filter((s) => s.type === 'class');
    expect(classes.map((c) => c.name)).toEqual(
      expect.arrayContaining(['Animal', 'Status', 'Greeter'])
    );
  });

  it('extracts impl methods with parent type', () => {
    const tree = parse(`
      struct Animal { name: String }
      impl Animal {
        pub fn bark(&self) -> &str { "woof" }
      }
    `);
    const methods = rustStrategy.extractSymbols(tree, '').filter((s) => s.type === 'method');
    expect(methods.find((m) => m.name === 'bark')?.parentClass).toBe('Animal');
  });

  it('extracts call sites including method and scoped calls', () => {
    const tree = parse(`
      fn main() {
        let s = String::from("hi");
        s.to_uppercase();
        greet("x");
      }
    `);
    const calls = rustStrategy.extractSymbols(tree, '').filter((s) => s.type === 'call');
    const callees = calls.map((c) => c.callee);
    // String::from -> from, .to_uppercase() -> to_uppercase, greet() -> greet
    expect(callees).toEqual(expect.arrayContaining(['from', 'to_uppercase', 'greet']));
  });

  it('extracts use_declaration imports', () => {
    const tree = parse(`
      use std::io;
      use std::collections::HashMap;
      use crate::utils::{foo, bar};
    `);
    const imports = rustStrategy.extractImports(tree, '');
    expect(imports.length).toBeGreaterThanOrEqual(3);
    // Single scoped: pulls last segment as the symbol
    expect(imports.find((i) => i.importedSymbols.includes('io'))).toBeDefined();
    expect(imports.find((i) => i.importedSymbols.includes('HashMap'))).toBeDefined();
    // List form: foo + bar
    const list = imports.find((i) => i.importedSymbols.includes('foo'));
    expect(list?.importedSymbols).toEqual(expect.arrayContaining(['foo', 'bar']));
  });

  it('round-trips at least one symbol AND one import (Phase 2a contract)', () => {
    const tree = parse(`
      use std::io;
      fn main() { let _ = io::stdin(); }
    `);
    const symbols = rustStrategy.extractSymbols(tree, '');
    const imports = rustStrategy.extractImports(tree, '');
    expect(symbols.length).toBeGreaterThan(0);
    expect(imports.length).toBeGreaterThan(0);
  });
});
