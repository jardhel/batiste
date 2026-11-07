// Conjunto ESLint SÓ de segurança, enviado ao Code Scanning (category: eslint).
// O lint completo (eslint.config.js, strictTypeChecked) é qualidade/estilo: roda no CI
// como relatório (artefato ci-reports) e NÃO vai ao painel de segurança.
// Sem type-info de propósito: rápido e sem depender de tsconfig por pacote.
import tseslint from 'typescript-eslint';

export default [
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: { parser: tseslint.parser },
    // plugin registrado só para que os `eslint-disable @typescript-eslint/...` existentes resolvam
    plugins: { '@typescript-eslint': tseslint.plugin },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: {
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',
      'no-new-wrappers': 'error',
      'no-proto': 'error',
      'no-extend-native': 'error',
    },
  },
  { ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**'] },
];
