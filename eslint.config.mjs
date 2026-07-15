import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "data/**",
    "next-env.d.ts",
    "public/vendor/**",
  ]),
  {
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/refs": "warn",
      "@typescript-eslint/no-explicit-any": "error",
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

export default eslintConfig;
