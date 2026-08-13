import functional from "eslint-plugin-functional"
import importPlugin from "eslint-plugin-import"
import importX from "eslint-plugin-import-x"
import tsParser from "@typescript-eslint/parser"

const typedFiles = [
  "src/**/*.ts",
  "src/**/*.tsx",
  "packages/**/*.ts",
  "packages/**/*.tsx",
  "scripts/**/*.ts",
  "test/**/*.ts",
  "test/**/*.tsx",
  "*.config.ts",
  "*.config.tsx"
]
const productionFiles = ["src/**/*.{ts,tsx}", "packages/*/src/**/*.{ts,tsx}", "scripts/**/*.{ts,tsx}"]
const publicEntryPoints = ["src/index.ts", "packages/*/src/index.ts"]
const compatibilityGraphFiles = [
  "packages/**/*.{ts,tsx}",
  "scripts/**/*.{ts,tsx}",
  "test/**/*.{ts,tsx}",
  "*.config.{ts,tsx}"
]
const compatibilityGraphTestFiles = ["test/**/*.{ts,tsx}", "**/*.{test,spec}.{ts,tsx}"]

export default [
  {
    ignores: ["**/node_modules/**", "**/dist/**", "**/coverage/**", "**/prototypes/**", "**/test/fixtures/**"],
    linterOptions: { reportUnusedDisableDirectives: "off" }
  },
  {
    files: typedFiles,
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: "./tsconfig.lint.json",
        tsconfigRootDir: import.meta.dirname,
        sourceType: "module",
        ecmaVersion: 2022
      }
    },
    plugins: { functional, import: importPlugin, "import-x": importX },
    settings: {
      "import-x/parsers": { "@typescript-eslint/parser": [".ts", ".tsx"] },
      "import-x/resolver": { typescript: { alwaysTryTypes: true } }
    },
    rules: {
      ...functional.configs.recommended.rules,
      "functional/immutable-data": "error",
      "functional/no-classes": "off",
      "functional/no-class-inheritance": "off",
      "functional/no-conditional-statements": "off",
      "functional/no-expression-statements": "off",
      "functional/no-let": "off",
      "functional/no-loop-statements": "off",
      "functional/no-return-void": "off",
      "functional/functional-parameters": "off",
      "functional/prefer-immutable-types": "off",
      "functional/prefer-tacit": "error",
      "import/no-nodejs-modules": "off",
      "import-x/no-unused-modules": "off"
    }
  },
  {
    files: productionFiles,
    rules: {
      "functional/no-throw-statements": "error",
      "import-x/no-unused-modules": [
        "error",
        { unusedExports: true, src: compatibilityGraphFiles, ignoreExports: compatibilityGraphTestFiles }
      ]
    }
  },
  { files: publicEntryPoints, rules: { "import-x/no-unused-modules": "off" } },
  { files: ["scripts/**/*.{ts,tsx}"], rules: { "functional/no-throw-statements": "off" } },
  { files: ["**/*.test.ts", "**/*.spec.ts"], rules: { "functional/immutable-data": "off" } }
]
