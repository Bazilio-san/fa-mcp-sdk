import baseConfig from 'eslint-config-at-26-2';

export default [
  ...baseConfig,

  // Project-specific ignores not covered by base config
  {
    ignores: [
      'cli-template/',
    ],
  },

  // Rules that were not in old config — disable to match previous behavior
  {
    rules: {
      'no-console': 'off',
      'import/order': 'off',
      'prefer-arrow/prefer-arrow-functions': 'off',
    },
  },

  // JS-specific overrides
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    rules: {},
  },
];
