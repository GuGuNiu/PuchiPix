import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const puchipixPlugin = {
  meta: { name: "puchipix-rules" },
  rules: {
    "no-chinese-in-logs": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Disallow Chinese characters in log messages, error messages, and event payloads to prevent encoding issues",
        },
        schema: [],
      },
      create(context) {
        const CJK_REGEX = /[\u4e00-\u9fff]/;

        /** @param {import('estree').Node} node */
        function checkForChinese(node) {
          if (!node) return;
          if (
            node.type === "Literal" &&
            typeof node.value === "string" &&
            CJK_REGEX.test(node.value)
          ) {
            context.report({
              node,
              message:
                "Chinese characters are not allowed in log/error messages. Use English instead. See logging.md §11.7",
            });
          }
          if (node.type === "TemplateLiteral") {
            for (const quasi of node.quasis) {
              if (CJK_REGEX.test(quasi.value.raw)) {
                context.report({
                  node,
                  message:
                    "Chinese characters are not allowed in log/error messages. Use English instead. See logging.md §11.7",
                });
                break;
              }
            }
          }
        }

        /**
         * @param {import('estree').Node} callee
         * @returns {boolean}
         */
        function isConsoleCall(callee) {
          return (
            callee.type === "MemberExpression" &&
            callee.object.type === "Identifier" &&
            callee.object.name === "console" &&
            callee.property.type === "Identifier" &&
            ["log", "warn", "error", "info", "debug"].includes(
              callee.property.name,
            )
          );
        }

        /**
         * @param {import('estree').Node} callee
         * @returns {boolean}
         */
        function isLoggerCall(callee) {
          if (
            callee.type === "MemberExpression" &&
            callee.property.type === "Identifier" &&
            ["log", "warn", "error", "info", "debug", "trace"].includes(
              callee.property.name,
            )
          ) {
            if (callee.object.type === "Identifier" && callee.object.name === "logger")
              return true;
            if (
              callee.object.type === "MemberExpression" &&
              callee.object.property.type === "Identifier" &&
              callee.object.property.name === "logger"
            )
              return true;
          }
          return false;
        }

        /**
         * @param {import('estree').Node} callee
         * @returns {boolean}
         */
        function isEventBusEmit(callee) {
          return (
            callee.type === "MemberExpression" &&
            callee.object.type === "Identifier" &&
            callee.object.name === "eventBus" &&
            callee.property.type === "Identifier" &&
            callee.property.name === "emit"
          );
        }

        return {
          CallExpression(node) {
            const callee = node.callee;

            if (isConsoleCall(callee) || isLoggerCall(callee)) {
              if (node.arguments.length > 0) {
                checkForChinese(node.arguments[0]);
              }
            }

            if (isEventBusEmit(callee) && node.arguments.length > 1) {
              const secondArg = node.arguments[1];
              if (secondArg.type === "ObjectExpression") {
                for (const prop of secondArg.properties) {
                  if (
                    prop.type === "Property" &&
                    prop.key.type === "Identifier" &&
                    prop.key.name === "error" &&
                    prop.value.type !== "Identifier"
                  ) {
                    checkForChinese(prop.value);
                  }
                }
              }
            }
          },
          NewExpression(node) {
            if (node.callee.type === "Identifier" && node.callee.name === "Error") {
              if (node.arguments.length > 0) {
                checkForChinese(node.arguments[0]);
              }
            }
          },
        };
      },
    },

    "no-chinese-in-comments": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Disallow Chinese characters in comments. Use professional English instead. See commentspec.md §3",
        },
        schema: [],
      },
      create(context) {
        const CJK_REGEX = /[\u4e00-\u9fff]/;
        const message =
          "Chinese characters are not allowed in comments. Use professional English. See commentspec.md §3";

        return {
          Program() {
            const sourceCode = context.sourceCode || context.getSourceCode();
            const comments = sourceCode.getAllComments();
            for (const comment of comments) {
              if (CJK_REGEX.test(comment.value)) {
                context.report({ node: comment, message });
              }
            }
          },
        };
      },
    },

    "no-decorative-separators": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Disallow decorative separator comments like // === or // ---. See commentspec.md §6.1",
        },
        schema: [],
      },
      create(context) {
        const SEPARATOR_REGEX = /^[-=]{3,}$/;

        return {
          Program() {
            const sourceCode = context.sourceCode || context.getSourceCode();
            const comments = sourceCode.getAllComments();
            for (const comment of comments) {
              if (comment.type === "Line") {
                const text = comment.value.trim();
                if (SEPARATOR_REGEX.test(text)) {
                  context.report({
                    node: comment,
                    message:
                      "Decorative separator comments (// === or // ---) are not allowed. See commentspec.md §6.1",
                  });
                }
              }
            }
          },
        };
      },
    },

    "no-section-labels": {
      meta: {
        type: "suggestion",
        docs: {
          description:
            "Disallow generic section label comments. See commentspec.md §6.1",
        },
        schema: [],
      },
      create(context) {
        const SECTION_LABELS = new Set([
          "类型定义", "常量", "单例导出", "工具函数", "辅助函数",
          "内部方法", "工具方法", "组件", "渲染", "核心服务类",
          "抽象方法", "主下载函数", "等待工具", "状态查询",
          "响应封装工具", "事件类型映射", "导出单例", "导出类型",
          "导出增强版签到服务", "导出",
          "Type Definitions", "Constants", "Singleton Export", "Exports",
          "Utility Functions", "Helper Functions", "Internal Methods",
          "Components", "Rendering", "Core Service Class",
          "Abstract Methods", "Main Download Function",
        ]);

        return {
          Program() {
            const sourceCode = context.sourceCode || context.getSourceCode();
            const comments = sourceCode.getAllComments();
            for (const comment of comments) {
              if (comment.type === "Line") {
                const text = comment.value.trim();
                if (SECTION_LABELS.has(text)) {
                  context.report({
                    node: comment,
                    message: `Generic section label "${text}" is not allowed. Remove it or use a meaningful comment. See commentspec.md §6.1`,
                  });
                }
              }
            }
          },
        };
      },
    },

    "no-empty-catch-comment": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Disallow comments inside empty catch blocks. See commentspec.md §6.3",
        },
        schema: [],
      },
      create(context) {
        return {
          CatchClause(node) {
            const sourceCode = context.sourceCode || context.getSourceCode();
            const comments = sourceCode.getCommentsInside(node.body);
            const hasEmptyBody =
              !node.body.body || node.body.body.length === 0;
            if (hasEmptyBody && comments.length > 0) {
              for (const comment of comments) {
                context.report({
                  node: comment,
                  message:
                    "Comments inside empty catch blocks are not allowed. If explanation is needed, place it above the catch. See commentspec.md §6.3",
                });
              }
            }
          },
        };
      },
    },

    "no-empty-jsdoc": {
      meta: {
        type: "problem",
        fixable: "code",
        docs: {
          description:
            "Disallow empty JSDoc blocks with no description content. See commentspec.md §6.12",
        },
        schema: [],
      },
      create(context) {
        return {
          Program() {
            const sourceCode = context.sourceCode || context.getSourceCode();
            const comments = sourceCode.getAllComments();
            for (const comment of comments) {
              if (comment.type !== "Block") continue;
              if (!comment.value.startsWith("*")) continue;

              const lines = comment.value.split("\n").map((line) =>
                line.replace(/^\s*\*\s?/, "").trim()
              );

              const contentLines = lines.filter((line) => line.length > 0);

              if (contentLines.length === 0) {
                context.report({
                  node: comment,
                  message:
                    "Empty JSDoc block: no description content. Remove the block or add a description. See commentspec.md §6.12",
                  fix(fixer) {
                    const sourceCode = context.sourceCode || context.getSourceCode();
                    const text = sourceCode.getText(comment);
                    const range = comment.range;
                    const after = sourceCode.text.slice(range[1], range[1] + 2);
                    if (after === "\n\n") {
                      return fixer.removeRange([range[0], range[1] + 1]);
                    }
                    return fixer.remove(comment);
                  },
                });
                continue;
              }

              const tagOnlyLines = contentLines.filter((line) =>
                line.startsWith("@")
              );
              const descriptionLines = contentLines.filter(
                (line) => !line.startsWith("@")
              );

              if (descriptionLines.length === 0 && tagOnlyLines.length > 0) {
                const hasEmptyTags = tagOnlyLines.some((line) => {
                  const afterTag = line.replace(/^@\w+/, "").trim();
                  return afterTag.length === 0;
                });
                if (hasEmptyTags) {
                  context.report({
                    node: comment,
                    message:
                      "Empty JSDoc tag: @example or @returns has no content. Add content or remove the tag. See commentspec.md §6.12",
                    fix(fixer) {
                      const sourceCode = context.sourceCode || context.getSourceCode();
                      const text = sourceCode.getText(comment);
                      const range = comment.range;
                      const after = sourceCode.text.slice(range[1], range[1] + 2);
                      if (after === "\n\n") {
                        return fixer.removeRange([range[0], range[1] + 1]);
                      }
                      return fixer.remove(comment);
                    },
                  });
                }
              }
            }
          },
        };
      },
    },
  },
};

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
    ".catpaw/temp/**",
    ".catpaw/skills/**",
    "tests/manual/**",
  ]),
  {
    plugins: { puchipix: puchipixPlugin },
    rules: {
      "puchipix/no-chinese-in-logs": "error",
      "puchipix/no-chinese-in-comments": "warn",
      "puchipix/no-decorative-separators": "warn",
      "puchipix/no-section-labels": "warn",
      "puchipix/no-empty-catch-comment": "warn",
      "puchipix/no-empty-jsdoc": "warn",

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
  files: ["*.mjs", "*.js", "*.cjs", "scripts/**/*.cjs"],
  rules: {
    "@typescript-eslint/explicit-function-return-type": "off",
    "@typescript-eslint/explicit-module-boundary-types": "off",
    "@typescript-eslint/consistent-type-imports": "off",
    "@typescript-eslint/no-require-imports": "off",
  },
});

export default eslintConfig;
