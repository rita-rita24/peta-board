export default [
  // Official CPython build sources are external dependencies, not managed application code.
  {
    ignores: [
      ".checks/python315-build/**",
      ".checks/python-tools/**",
      ".checks/python/**",
    ],
  },
  {
    files: [
      "scripts/**/*.{mjs,cjs}",
      "performance/**/*.cjs",
      "*.mjs",
      ".checks/*.js",
    ],
    languageOptions: { ecmaVersion: 2026 },
    rules: {
      "no-var": "error",
      "no-unused-vars": ["error", { args: "none" }],
      "prefer-const": "error",
      "no-unreachable": "error",
      "no-dupe-keys": "error",
      "no-constant-condition": ["error", { checkLoops: false }],
      "no-unused-private-class-members": "error",
      "no-async-promise-executor": "error",
      "no-promise-executor-return": "error",
      "no-prototype-builtins": "error",
      "no-unsafe-optional-chaining": "error",
      "no-constant-binary-expression": "error",
      "no-restricted-properties": [
        "error",
        {
          property: "which",
          message:
            "UIEvent.which is deprecated; use key or button and the documented IME fallback.",
        },
      ],
    },
  },
];
