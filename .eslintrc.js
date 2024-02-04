module.exports = {
    env: {
        browser: true,
        es2021: true
    },
    extends: [
        "eslint:recommended",
        "plugin:@typescript-eslint/eslint-recommended",
        "plugin:@typescript-eslint/recommended",
        "plugin:@typescript-eslint/recommended-requiring-type-checking",
        "plugin:prettier/recommended",
    ],
    parser: "@typescript-eslint/parser",
    parserOptions: {
        project: ["./src/client/tsconfig.json", "./src/server/tsconfig.json"],
        ecmaVersion: "latest",
        sourceType: "module",
      },
    plugins: [
        "@typescript-eslint",
        "prettier"
    ],
    ignorePatterns: [
        "*.glb",
        "*.json",
        "*.env",
        "*.envmap",
        "*.exr",
        "beta/**/*",
        "deploy/**/*",
        "dist/**/*",
        "patches/**/*",
        "resources/**/*",
        "src/client/webpack.*.js",
        "/*.js"
      ],
    rules: {
        "no-console": "off",
        "no-prototype-builtins": "off",
        "@typescript-eslint/no-explicit-any": "off",
        "@typescript-eslint/no-unsafe-call": "off",
        "@typescript-eslint/no-unsafe-member-access": "off",
        "@typescript-eslint/no-unsafe-assignment": "off",
        "@typescript-eslint/no-unsafe-return": "off",
        "@typescript-eslint/no-unsafe-argument": "off",
        "@typescript-eslint/unbound-method": "off",
        "@typescript-eslint/no-floating-promises": "off",
        "@typescript-eslint/array-type": ["error", { default: "array-simple" }],
        "@typescript-eslint/ban-types": [
          "error",
          {
            types: {
              Object: {
                message: "Avoid using the `Object` type. Did you mean `object`?",
              },
              Function: {
                message:
                  "Avoid using the `Function` type. Prefer a specific function type, like `() => void`.",
              },
              Boolean: {
                message: "Avoid using the `Boolean` type. Did you mean `boolean`?",
              },
              Number: {
                message: "Avoid using the `Number` type. Did you mean `number`?",
              },
              String: {
                message: "Avoid using the `String` type. Did you mean `string`?",
              },
              Symbol: {
                message: "Avoid using the `Symbol` type. Did you mean `symbol`?",
              },
            },
          },
        ],
        "@typescript-eslint/consistent-type-definitions": "error",
        "@typescript-eslint/dot-notation": "error",
        "@typescript-eslint/member-delimiter-style": [
          "error",
          {
            multiline: { delimiter: "semi", requireLast: true },
            singleline: { delimiter: "semi", requireLast: false },
          },
        ],
        "@typescript-eslint/no-unused-expressions": "error",
        "@typescript-eslint/prefer-for-of": "error",
        "@typescript-eslint/prefer-function-type": "error",
        "@typescript-eslint/quotes": ["error", "single"],
        "@typescript-eslint/semi": ["error", "always"],
        "@typescript-eslint/triple-slash-reference": [
          "error",
          {
            path: "always",
            types: "prefer-import",
            lib: "always",
          },
        ],
        "@typescript-eslint/unified-signatures": "error",
        "arrow-parens": ["error", "always"],
        camelcase: "error",
        complexity: ["error", { max: 13 }],
        "constructor-super": "error",
        curly: "error",
        "eol-last": "error",
        eqeqeq: ["error", "smart"],
        "for-direction": "error",
        "getter-return": "error",
        "id-match": "error",
        "new-parens": "error",
        "no-async-promise-executor": "error",
        "no-caller": "error",
        "no-case-declarations": "error",
        "no-class-assign": "error",
        "no-compare-neg-zero": "error",
        "no-cond-assign": "error",
        "no-const-assign": "error",
        "no-constant-condition": "error",
        "no-control-regex": "error",
        "no-debugger": "error",
        "no-delete-var": "error",
        "no-dupe-args": "error",
        "no-dupe-class-members": "error",
        "no-dupe-else-if": "error",
        "no-dupe-keys": "error",
        "no-duplicate-case": "error",
        "no-empty": "error",
        "no-empty-character-class": "error",
        "no-empty-pattern": "error",
        "no-eval": "error",
        "no-ex-assign": "error",
        "no-extra-boolean-cast": "error",
        "no-extra-semi": "error",
        "no-func-assign": "error",
        "no-global-assign": "error",
        "no-import-assign": "error",
        "no-inner-declarations": "error",
        "no-invalid-regexp": "error",
        "no-irregular-whitespace": "error",
        "no-misleading-character-class": "error",
        "no-mixed-spaces-and-tabs": "error",
        "no-multiple-empty-lines": "error",
        "no-new-symbol": "error",
        "no-new-wrappers": "error",
        "no-obj-calls": "error",
        "no-octal": "error",
        "no-redeclare": "error",
        "no-regex-spaces": "error",
        "no-self-assign": "error",
        "no-setter-return": "error",
        // 'no-shadow': ['error', {'hoist': 'all'}], --> see why we commented it: https://github.com/typescript-eslint/typescript-eslint/issues/2483#issuecomment-687095358
        "no-shadow-restricted-names": "error",
        "no-sparse-arrays": "error",
        "no-this-before-super": "error",
        "no-throw-literal": "error",
        "no-trailing-spaces": "error",
        "no-undef": "error",
        "no-undef-init": "error",
        "no-underscore-dangle": 0,
        "no-unexpected-multiline": "error",
        "no-unreachable": "error",
        "no-unsafe-finally": "error",
        "no-unsafe-negation": "error",
        "no-unused-labels": "error",
        "no-useless-catch": "error",
        "no-with": "error",
        "object-shorthand": "error",
        "one-var": ["error", "never"],
        "quote-props": ["error", "consistent-as-needed"],
        radix: "error",
        "require-yield": "error",
        "space-before-function-paren": [
          "error",
          { anonymous: "always", named: "never", asyncArrow: "always" },
        ],
        "use-isnan": "error",
        "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
        "@typescript-eslint/ban-ts-comment": [
          "warn",
          {
            "ts-ignore": { descriptionFormat: "^ -- " },
            "ts-nocheck": { descriptionFormat: "^ -- " },
          },
        ],
        "@typescript-eslint/no-shadow": "error",
        "@typescript-eslint/consistent-type-imports": [
          "error",
          {
            prefer: "type-imports",
            disallowTypeAnnotations: true,
            fixStyle: "separate-type-imports",
          },
        ],
    },
    overrides: [
      {
        env: {
          node: true
        },
        files: [
          ".eslintrc.{js,cjs}"
        ],
        parserOptions: {
          "sourceType": "script"
        }
      },
      {
        env: {
          node: true
        },
        files: [
          "src/server/**/*.ts"
        ],
        parserOptions: {
          "sourceType": "module"
        }
      },
      {
        files: [
          "src/client/drag_target.ts",
        ],
        rules: {
          "@typescript-eslint/ban-ts-comment": "off"
        }
      },
      {
        files: [
          "src/client/experimental/outline_pass.ts",
        ],
        rules: {
          "@typescript-eslint/prefer-for-of": "off"
        }
      }
    ]
  }
  