import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";
import puchipixPlugin from "./eslint/plugin-puchipix.mjs";

const eslintConfig = defineConfig([
  ...tseslint.configs.recommended,
  globalIgnores([
    "dist/**",
    "out/**",
    "build/**",
    "data/**",
    "public/vendor/**",
    ".catpaw/temp/**",
    ".catpaw/skills/**",
    "tests/manual/**",
  ]),
  {
    plugins: { puchipix: puchipixPlugin },
    rules: {
      "puchipix/no-chinese-in-logs": "error",
      "puchipix/no-chinese-in-comments": "error",
      "puchipix/no-decorative-separators": "error",
      "puchipix/no-section-labels": "error",
      "puchipix/no-empty-catch-comment": "error",
      "puchipix/no-empty-jsdoc": "error",
      "puchipix/no-malformed-jsdoc": "error",

      "spaced-comment": ["error", "always", {
        line: { markers: ["/"] },
        block: { markers: ["*"], exceptions: ["*"] },
      }],
      "capitalized-comments": ["warn", "always", {
        ignorePattern: "^(TODO|FIXME|HACK|NOTE|XXX|eslint|@|https?://|type |import |#|&|\\*)",
      }],
      "no-warning-comments": ["warn", {
        terms: ["todo", "fixme", "hack", "xxx"],
        location: "start",
      }],
      "multiline-comment-style": ["error", "starred-block"],

      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          "argsIgnorePattern": "^_",
          "varsIgnorePattern": "^_",
          "caughtErrorsIgnorePattern": "^_",
        },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          "prefer": "type-imports",
          "fixStyle": "separate-type-imports",
          "disallowTypeAnnotations": false,
        },
      ],
      "@typescript-eslint/explicit-function-return-type": [
        "error",
        {
          "allowExpressions": true,
          "allowTypedFunctionExpressions": true,
          "allowHigherOrderFunctions": true,
          "allowDirectConstAssertionInArrowFunctions": true,
        },
      ],
      "@typescript-eslint/explicit-module-boundary-types": [
        "error",
        {
          "allowTypedFunctionExpressions": true,
          "allowHigherOrderFunctions": true,
        },
      ],
    },
  },
]);

eslintConfig.push({
  files: ["**/*.mjs", "**/*.js", "**/*.cjs"],
  rules: {
    "@typescript-eslint/explicit-function-return-type": "off",
    "@typescript-eslint/explicit-module-boundary-types": "off",
    "@typescript-eslint/consistent-type-imports": "off",
    "@typescript-eslint/no-require-imports": "off",
  },
});

eslintConfig.push({
  files: ["src/lib/i18n/locales/**"],
  rules: {
    "puchipix/no-chinese-in-comments": "off",
    "capitalized-comments": "off",
  },
});

export default eslintConfig;
