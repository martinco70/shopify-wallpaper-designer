const js = require('@eslint/js');
const globals = require('globals');

/**
 * Flat config (CommonJS) so ESLint in a CommonJS project won't complain about ESM syntax.
 * Add any new ignore patterns here (replaces deprecated .eslintignore in flat mode).
 */
module.exports = [
  {
    ignores: [
      'public/**',        // static assets
      'backups/**',       // backup artifacts
      'index_ALT.js',     // legacy monolith (kept for reference only)
      'existing_preview.html',
      'prev.html',
      'shot.pdf',
      'test.pdf',
      'test_local.pdf'
    ]
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node }
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'off',
      'prefer-const': 'warn',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-prototype-builtins': 'off'
    }
  }
];
