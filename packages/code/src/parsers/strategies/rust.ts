/**
 * Rust strategy.
 *
 * Phase 2a · NEW. Wraps `tree-sitter-rust`. Rust diverges from the
 * other strategies in three ways worth noting:
 *
 *   - Top-level fns are `function_item`, not `function_declaration`.
 *   - Methods live inside `impl_item` blocks; the parent `class` is
 *     the impl's `type` field, not the function's parent traversal.
 *   - Imports are `use_declaration` and can fan out into many symbols
 *     via `use_list`. We flatten the leaves so the graph builder sees
 *     one {@link ImportStatement} per `use ...;` line.
 */
import type Parser from 'tree-sitter';
import Rust from 'tree-sitter-rust';
import {
  type CodeSymbol,
  type ImportStatement,
  type LanguageStrategy,
  nodeRange,
  walkTree,
} from './base.js';

/**
 * Walk a `use_declaration` and return the module path plus the
 * symbol(s) imported. Handles:
 *   `use std::io;`                     → io
 *   `use std::collections::HashMap;`   → HashMap
 *   `use crate::utils::{foo, bar};`    → foo, bar
 */
function flattenUse(node: Parser.SyntaxNode): {
  modulePath: string;
  symbols: string[];
  isNamespace: boolean;
} {
  // Walk down past `use_declaration` -> first named child = the path expression.
  let pathExpr: Parser.SyntaxNode | null = null;
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child) {
      pathExpr = child;
      break;
    }
  }
  if (!pathExpr) {
    return { modulePath: node.text.replace(/^use\s+/, '').replace(/;$/, ''), symbols: [], isNamespace: true };
  }

  // scoped_identifier: a::b::c → modulePath=a::b, symbol=c
  if (pathExpr.type === 'scoped_identifier') {
    const last = pathExpr.namedChild(pathExpr.namedChildCount - 1);
    const symbol = last?.text ?? pathExpr.text;
    return { modulePath: pathExpr.text, symbols: [symbol], isNamespace: false };
  }

  // identifier: `use foo;`
  if (pathExpr.type === 'identifier') {
    return { modulePath: pathExpr.text, symbols: [pathExpr.text], isNamespace: false };
  }

  // scoped_use_list: a::{b, c}
  if (pathExpr.type === 'scoped_use_list') {
    const path = pathExpr.childForFieldName('path');
    const list = pathExpr.childForFieldName('list');
    const modulePath = path?.text ?? pathExpr.text;
    const symbols: string[] = [];
    if (list) {
      for (let i = 0; i < list.namedChildCount; i++) {
        const item = list.namedChild(i);
        if (item) symbols.push(item.text);
      }
    }
    return { modulePath, symbols, isNamespace: symbols.length === 0 };
  }

  // Fallback: dump the raw text.
  return { modulePath: pathExpr.text, symbols: [pathExpr.text], isNamespace: false };
}

export const rustStrategy: LanguageStrategy = {
  name: 'rust',
  extensions: ['.rs'],
  parserFactory: () => Rust,

  extractSymbols(tree: Parser.Tree): CodeSymbol[] {
    const symbols: CodeSymbol[] = [];

    walkTree(tree, (node) => {
      if (node.type === 'function_item') {
        const nameNode = node.childForFieldName('name');
        if (!nameNode) return;
        // Determine if this fn is inside an impl_item — if so it's a method.
        let parentClass: string | undefined;
        let isMethod = false;
        let parent = node.parent;
        while (parent) {
          if (parent.type === 'impl_item') {
            const typeNode = parent.childForFieldName('type');
            if (typeNode) parentClass = typeNode.text;
            isMethod = true;
            break;
          }
          parent = parent.parent;
        }
        symbols.push({
          name: nameNode.text,
          type: isMethod ? 'method' : 'function',
          parentClass,
          ...nodeRange(node),
        });
      }

      if (node.type === 'struct_item' || node.type === 'enum_item' || node.type === 'trait_item') {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          symbols.push({ name: nameNode.text, type: 'class', ...nodeRange(node) });
        }
      }

      if (node.type === 'call_expression') {
        const funcNode = node.childForFieldName('function');
        if (funcNode) {
          let callee: string;
          if (funcNode.type === 'identifier') {
            callee = funcNode.text;
          } else if (funcNode.type === 'field_expression') {
            const fieldNode = funcNode.childForFieldName('field');
            callee = fieldNode ? fieldNode.text : funcNode.text;
          } else if (funcNode.type === 'scoped_identifier') {
            const last = funcNode.namedChild(funcNode.namedChildCount - 1);
            callee = last?.text ?? funcNode.text;
          } else {
            callee = funcNode.text;
          }
          symbols.push({
            name: `call:${callee}`,
            type: 'call',
            callee,
            ...nodeRange(node),
          });
        }
      }
    });

    return symbols;
  },

  extractImports(tree: Parser.Tree): ImportStatement[] {
    const imports: ImportStatement[] = [];

    walkTree(tree, (node) => {
      if (node.type !== 'use_declaration') return;
      const { modulePath, symbols, isNamespace } = flattenUse(node);
      imports.push({
        modulePath,
        importedSymbols: symbols.length > 0 ? symbols : ['*'],
        isDefault: false,
        isNamespace,
        line: node.startPosition.row + 1,
      });
    });

    return imports;
  },
};
