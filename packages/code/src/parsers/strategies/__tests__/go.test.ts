/**
 * Go strategy — verify symbol + import extraction round-trips.
 */
import { describe, it, expect } from 'vitest';
import Parser from 'tree-sitter';
import { goStrategy } from '../go.js';

function parse(source: string): Parser.Tree {
  const parser = new Parser();
  parser.setLanguage(goStrategy.parserFactory() as never);
  return parser.parse(source);
}

describe('goStrategy', () => {
  it('claims the .go extension', () => {
    expect(goStrategy.name).toBe('go');
    expect(goStrategy.extensions).toContain('.go');
  });

  it('extracts top-level functions', () => {
    const tree = parse(`
      package main
      func greet(name string) string { return name }
      func add(a, b int) int { return a + b }
    `);
    const fns = goStrategy.extractSymbols(tree, '').filter((s) => s.type === 'function');
    expect(fns.map((f) => f.name)).toEqual(expect.arrayContaining(['greet', 'add']));
  });

  it('extracts methods with receiver type as parentClass', () => {
    const tree = parse(`
      package main
      type Animal struct { name string }
      func (a *Animal) Bark() string { return "woof" }
      func (a Animal) Name() string { return a.name }
    `);
    const methods = goStrategy.extractSymbols(tree, '').filter((s) => s.type === 'method');
    expect(methods.find((m) => m.name === 'Bark')?.parentClass).toBe('Animal');
    expect(methods.find((m) => m.name === 'Name')?.parentClass).toBe('Animal');
  });

  it('extracts struct/interface declarations as classes', () => {
    const tree = parse(`
      package main
      type Animal struct { name string }
      type Greeter interface { Greet() string }
    `);
    const classes = goStrategy.extractSymbols(tree, '').filter((s) => s.type === 'class');
    expect(classes.map((c) => c.name)).toEqual(expect.arrayContaining(['Animal', 'Greeter']));
  });

  it('extracts call sites including selector calls', () => {
    const tree = parse(`
      package main
      import "fmt"
      func main() {
        fmt.Println("hi")
        greet("world")
      }
    `);
    const calls = goStrategy.extractSymbols(tree, '').filter((s) => s.type === 'call');
    expect(calls.map((c) => c.callee)).toEqual(expect.arrayContaining(['Println', 'greet']));
  });

  it('extracts both single and grouped imports', () => {
    const tree = parse(`
      package main
      import "strings"
      import (
        "fmt"
        "os"
      )
    `);
    const imports = goStrategy.extractImports(tree, '');
    const paths = imports.map((i) => i.modulePath);
    expect(paths).toEqual(expect.arrayContaining(['strings', 'fmt', 'os']));
  });

  it('round-trips at least one symbol AND one import (Phase 2a contract)', () => {
    const tree = parse(`
      package main
      import "fmt"
      func main() { fmt.Println("hi") }
    `);
    const symbols = goStrategy.extractSymbols(tree, '');
    const imports = goStrategy.extractImports(tree, '');
    expect(symbols.length).toBeGreaterThan(0);
    expect(imports.length).toBeGreaterThan(0);
  });
});
