import Parser from 'tree-sitter';
import TypeScript from 'tree-sitter-typescript';
import type {
  LanguageStrategy,
  CodeSymbol,
  QueryPatterns,
  ImportStatement,
} from './LanguageStrategy.js';

export class TypeScriptStrategy implements LanguageStrategy {
  languageId = 'typescript';
  extensions = ['.ts', '.tsx', '.js', '.jsx'];

  getParser(): unknown {
    return TypeScript.typescript;
  }

  getQueryPatterns(): QueryPatterns {
    return {
      functionDefinitions: `
        (function_declaration
          name: (identifier) @name) @definition
        (arrow_function) @definition
        (function_expression
          name: (identifier)? @name) @definition
      `,
      callSites: `
        (call_expression
          function: (identifier) @callee) @call
        (call_expression
          function: (member_expression
            property: (property_identifier) @callee)) @call
      `,
      classDefinitions: `
        (class_declaration
          name: (type_identifier) @name) @definition
      `,
      methodDefinitions: `
        (method_definition
          name: (property_identifier) @name) @definition
      `,
    };
  }

  extractSymbols(tree: Parser.Tree, _source: string): CodeSymbol[] {
    const symbols: CodeSymbol[] = [];
    const cursor = tree.walk();

    const visit = (): void => {
      const node = cursor.currentNode;

      if (node.type === 'function_declaration') {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          symbols.push({
            name: nameNode.text,
            type: 'function',
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            startColumn: node.startPosition.column,
            endColumn: node.endPosition.column,
          });
        }
      }

      if (node.type === 'lexical_declaration' || node.type === 'variable_declaration') {
        for (let i = 0; i < node.childCount; i++) {
          const declarator = node.child(i);
          if (declarator?.type === 'variable_declarator') {
            const nameNode = declarator.childForFieldName('name');
            const valueNode = declarator.childForFieldName('value');
            if (nameNode && valueNode?.type === 'arrow_function') {
              symbols.push({
                name: nameNode.text,
                type: 'function',
                startLine: declarator.startPosition.row + 1,
                endLine: declarator.endPosition.row + 1,
                startColumn: declarator.startPosition.column,
                endColumn: declarator.endPosition.column,
              });
            }
          }
        }
      }

      if (node.type === 'class_declaration') {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          symbols.push({
            name: nameNode.text,
            type: 'class',
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            startColumn: node.startPosition.column,
            endColumn: node.endPosition.column,
          });
        }
      }

      if (node.type === 'method_definition') {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          let parentClass: string | undefined;
          let parent = node.parent;
          while (parent) {
            if (parent.type === 'class_declaration') {
              const classNameNode = parent.childForFieldName('name');
              if (classNameNode) {
                parentClass = classNameNode.text;
              }
              break;
            }
            parent = parent.parent;
          }

          symbols.push({
            name: nameNode.text,
            type: 'method',
            parentClass,
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            startColumn: node.startPosition.column,
            endColumn: node.endPosition.column,
          });
        }
      }

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
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            startColumn: node.startPosition.column,
            endColumn: node.endPosition.column,
          });
        }
      }

      if (cursor.gotoFirstChild()) {
        do {
          visit();
        } while (cursor.gotoNextSibling());
        cursor.gotoParent();
      }
    };

    visit();
    return symbols;
  }

  extractImports(tree: Parser.Tree, _source: string): ImportStatement[] {
    const imports: ImportStatement[] = [];
    const cursor = tree.walk();

    const visit = (): void => {
      const node = cursor.currentNode;

      if (node.type === 'import_statement') {
        const sourceNode = node.childForFieldName('source');
        if (sourceNode) {
          const modulePath = sourceNode.text.slice(1, -1);
          const importedSymbols: string[] = [];
          let isDefault = false;
          let isNamespace = false;

          for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i);
            if (!child) continue;

            if (child.type === 'import_clause') {
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
                    if (specifier?.type === 'import_specifier') {
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
      }

      if (node.type === 'call_expression') {
        const funcNode = node.childForFieldName('function');
        if (funcNode?.text === 'require') {
          const argsNode = node.childForFieldName('arguments');
          if (argsNode && argsNode.childCount > 0) {
            const argNode = argsNode.child(1);
            if (argNode?.type === 'string') {
              const modulePath = argNode.text.slice(1, -1);
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

      if (cursor.gotoFirstChild()) {
        do {
          visit();
        } while (cursor.gotoNextSibling());
        cursor.gotoParent();
      }
    };

    visit();
    return imports;
  }
}
