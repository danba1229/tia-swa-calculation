import js from '@eslint/js';
import react from 'eslint-plugin-react';
import globals from 'globals';

export default [
  { ignores: ['.next/**', 'node_modules/**', '.vercel/**', '.preview-test-results/**', 'calculator_core/**', 'cloud_artifacts/**', 'app.js', 'data/**'] },
  { files: ['app/**/*.{js,jsx}', 'components/**/*.{js,jsx}', 'lib/**/*.js', 'tests/**/*.mjs'],
    ...js.configs.recommended,
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } }, globals: { ...globals.browser, ...globals.node } },
    plugins: { react },
    rules: { ...js.configs.recommended.rules, 'no-unused-vars': 'off', 'react/jsx-uses-vars': 'error', 'react/jsx-no-undef': 'error', 'no-empty': ['error', { allowEmptyCatch: true }] },
  },
];
