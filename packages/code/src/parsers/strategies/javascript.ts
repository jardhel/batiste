/**
 * JavaScript / JSX strategy.
 *
 * Phase 2a · NEW. Splits `.js` / `.jsx` off the legacy TypeScript
 * strategy and parses them with the dedicated `tree-sitter-javascript`
 * grammar. Vanilla JS files trip the TS grammar's superset semantics
 * (e.g., type annotations are absent, `class X` is `identifier` not
 * `type_identifier`), so a dedicated grammar is the lowest-friction
 * fix and unlocks accurate symbol extraction for the majority of
 * front-end repos.
 *
 * Implementation mirrors `../../config/TypeScriptStrategy.ts` but with
 * JS-specific node-type names. Kept short and self-contained — adding
 * a new ECMAScript node only touches this file.
 */
import type Parser from 'tree-sitter';
import JavaScript from 'tree-sitter-javascript';
import {
  type CodeSymbol,
  type ImportStatement,
  type LanguageStrategy,
  nodeRange,
  unquoteStringLiteral,
  walkTree,
} from './base.js';

export const javascriptStrategy: LanguageStrategy = {
  name: 'javascript',
  extensions: ['.js', '.jsx', '.mjs', '.cjs'],
  parserFactory: () => JavaScript,

  extractSymbols(tree: Parser.Tree): CodeSymbol[] {
    const symbols: CodeSymbol[] = [];

    walkTree(tree, (node) => {
      // function foo() {}
      if (node.type === 'function_declaration') {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          symbols.push({ name: nameNode.text, type: 'function', ...nodeRange(node) });
        }
      }

      // const foo = () => {}
      if (node.type === 'variable_declarator') {
        const nameNode = node.childForFieldName('name');
        const valueNode = node.childForFieldName('value');
        if (
          nameNode &&
          (valueNode?.type === 'arrow_function' || valueNode?.type === 'function_expression')
        ) {
          symbols.push({ name: nameNode.text, type: 'function', ...nodeRange(node) });
        }
      }

      // class Foo {}
      if (node.type === 'class_declaration') {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          symbols.push({ name: nameNode.text, type: 'class', ...nodeRange(node) });
        }
      }

      // class Foo { bar() {} }
      if (node.type === 'method_definition') {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          let parentClass: string | undefined;
          let parent = node.parent;
          while (parent) {
            if (parent.type === 'class_declaration') {
              const classNameNode = parent.childForFieldName('name');
              if (classNameNode) parentClass = classNameNode.text;
              break;
            }
            parent = parent.parent;
          }
          symbols.push({
            name: nameNode.text,
            type: 'method',
            parentClass,
            ...nodeRange(node),
          });
        }
      }

      // foo(); obj.bar();
      if (node.type === 'call_expression') {
        const funcNode = node.childForFieldName('function');
        if (funcNode) {
          let callee: string;
          if (funcNode.type === 'identifier') {
            callee = funcNode.text;
          } else if (funcNode.type === 'member_expression') {
            const propNode = funcNode.childForFieldName('property');
            callee = propNode ? propNode.text : funcNode.text;
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
      if (node.type === 'import_statement') {
        const sourceNode = node.childForFieldName('source');
        if (!sourceNode) return;
        const modulePath = unquoteStringLiteral(sourceNode.text);
        const importedSymbols: string[] = [];
        let isDefault = false;
        let isNamespace = false;

        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);
          if (child?.type !== 'import_clause') continue;

          for (let j = 0; j < child.childCount; j++) {
            const clauseChild = child.child(j);
            if (!clauseChild) continue;

            if (clauseChild.type === 'identifier') {
              importedSymbols.push(clauseChild.text);
              isDefault = true;
            }

            if (clauseChild.type === 'namespace_import') {
              for (let k = 0; k < clauseChild.childCount; k++) {
                const nsChild = clauseChild.child(k);
                if (nsChild?.type === 'identifier') {
                  importedSymbols.push(nsChild.text);
                  isNamespace = true;
                }
              }
            }

            if (clauseChild.type === 'named_imports') {
              for (let k = 0; k < clauseChild.childCount; k++) {
                const specifier = clauseChild.child(k);
                if (specifier?.type !== 'import_specifier') continue;
                for (let l = 0; l < specifier.childCount; l++) {
                  const specChild = specifier.child(l);
                  if (specChild?.type === 'identifier') {
                    importedSymbols.push(specChild.text);
                    break;
                  }
                }
              }
            }
          }
        }

        imports.push({
          modulePath,
          importedSymbols,
          isDefault,
          isNamespace,
          line: node.startPosition.row + 1,
        });
      }

      // require('foo')
      if (node.type === 'call_expression') {
        const funcNode = node.childForFieldName('function');
        if (funcNode?.type === 'identifier' && funcNode.text === 'require') {
          const argsNode = node.childForFieldName('arguments');
          if (argsNode && argsNode.namedChildCount > 0) {
            const argNode = argsNode.namedChild(0);
            if (argNode?.type === 'string') {
              const modulePath = unquoteStringLiteral(argNode.text);
              imports.push({
                modulePath,
                importedSymbols: ['*'],
                isDefault: false,
                isNamespace: true,
                line: node.startPosition.row + 1,
              });
            }
          }
        }
      }
    });

    return imports;
  },
};
