/**
 * Go strategy.
 *
 * Phase 2a · NEW. Wraps `tree-sitter-go`. Go's grammar models top-level
 * declarations under `function_declaration`, `method_declaration`,
 * `type_declaration` (which contains a `type_spec`), and
 * `import_declaration` (single or block). Methods carry a receiver
 * field that we mine for the parent type — this is what lets the
 * Phase 2b graph builder draw `method → struct` edges across `.go`
 * files.
 */
import type Parser from 'tree-sitter';
import Go from 'tree-sitter-go';
import {
  type CodeSymbol,
  type ImportStatement,
  type LanguageStrategy,
  nodeRange,
  unquoteStringLiteral,
  walkTree,
} from './base.js';

/** Walk the receiver `(a *Animal)` and return `Animal`. */
function receiverType(receiver: Parser.SyntaxNode): string | undefined {
  for (let i = 0; i < receiver.namedChildCount; i++) {
    const param = receiver.namedChild(i);
    if (param?.type !== 'parameter_declaration') continue;
    for (let j = 0; j < param.namedChildCount; j++) {
      const child = param.namedChild(j);
      if (!child) continue;
      if (child.type === 'type_identifier') return child.text;
      if (child.type === 'pointer_type') {
        // *Animal — drill into the wrapped type identifier.
        for (let k = 0; k < child.namedChildCount; k++) {
          const inner = child.namedChild(k);
          if (inner?.type === 'type_identifier') return inner.text;
        }
      }
    }
  }
  return undefined;
}

export const goStrategy: LanguageStrategy = {
  name: 'go',
  extensions: ['.go'],
  parserFactory: () => Go,

  extractSymbols(tree: Parser.Tree): CodeSymbol[] {
    const symbols: CodeSymbol[] = [];

    walkTree(tree, (node) => {
      if (node.type === 'function_declaration') {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          symbols.push({ name: nameNode.text, type: 'function', ...nodeRange(node) });
        }
      }

      if (node.type === 'method_declaration') {
        const nameNode = node.childForFieldName('name');
        const receiver = node.childForFieldName('receiver');
        if (nameNode) {
          symbols.push({
            name: nameNode.text,
            type: 'method',
            parentClass: receiver ? receiverType(receiver) : undefined,
            ...nodeRange(node),
          });
        }
      }

      // type Foo struct { ... }   /   type Foo interface { ... }
      if (node.type === 'type_spec') {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          symbols.push({ name: nameNode.text, type: 'class', ...nodeRange(node) });
        }
      }

      // foo()  /  pkg.Foo()
      if (node.type === 'call_expression') {
        const funcNode = node.childForFieldName('function');
        if (funcNode) {
          let callee: string;
          if (funcNode.type === 'identifier') {
            callee = funcNode.text;
          } else if (funcNode.type === 'selector_expression') {
            const fieldNode = funcNode.childForFieldName('field');
            callee = fieldNode ? fieldNode.text : funcNode.text;
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
      if (node.type !== 'import_spec') return;
      const pathNode = node.childForFieldName('path');
      if (!pathNode) return;
      const modulePath = unquoteStringLiteral(pathNode.text);
      const aliasNode = node.childForFieldName('name');
      const symbolName = aliasNode?.text ?? modulePath.split('/').pop() ?? modulePath;
      imports.push({
        modulePath,
        importedSymbols: [symbolName],
        isDefault: false,
        isNamespace: true,
        line: node.startPosition.row + 1,
      });
    });

    return imports;
  },
};
