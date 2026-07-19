import effectEslint from "@effect/eslint-plugin"
import { fixupPluginRules } from "@eslint/compat"
import eslint from "@eslint/js"
import tsParser from "@typescript-eslint/parser"
import functional from "eslint-plugin-functional"
import importPlugin from "eslint-plugin-import"
import importX from "eslint-plugin-import-x"
import sortDestructureKeys from "eslint-plugin-sort-destructure-keys"
import tseslint from "typescript-eslint"

const clockReads = [
  {
    message: "Inject time through Effect Clock or a service instead of calling Date.now().",
    selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']"
  },
  {
    message: "Inject time through Effect Clock or a service instead of constructing the current Date.",
    selector: "NewExpression[callee.name='Date'][arguments.length=0]"
  }
]

const moduleMocks = ["mock", "doMock", "unmock", "spyOn", "stubGlobal"].map((member) => ({
  message: `vi.${member} is forbidden. Substitute behavior through Effect services and Layers.`,
  selector: `CallExpression[callee.object.name='vi'][callee.property.name='${member}']`
})).flatMap((restriction) => [
  restriction,
  {
    ...restriction,
    selector: restriction.selector.replace("[callee.property.name=", "[callee.computed=true][callee.property.value=")
  },
  {
    ...restriction,
    selector: restriction.selector
      .replace("CallExpression[callee.object.name='vi'][callee.property.name=", "VariableDeclarator[init.name='vi'] Property[key.name=")
  }
]).concat([
  {
    message: "Do not import Vitest's vi API. Substitute behavior through Effect services and Layers.",
    selector: "ImportDeclaration[source.value='vitest'] ImportSpecifier[imported.name='vi']"
  },
  {
    message: "Do not namespace-import Vitest; it bypasses the module-mock guard.",
    selector: "ImportDeclaration[source.value='vitest'] ImportNamespaceSpecifier"
  },
  {
    message: "Do not import vi through @effect/vitest. Substitute behavior through Effect services and Layers.",
    selector: "ImportDeclaration[source.value='@effect/vitest'] ImportSpecifier[imported.name='vi']"
  },
  {
    message: "Do not namespace-import @effect/vitest; it re-exports vi and bypasses the module-mock guard.",
    selector: "ImportDeclaration[source.value='@effect/vitest'] ImportNamespaceSpecifier"
  },
  {
    message: "jest.mock is forbidden. Substitute behavior through Effect services and Layers.",
    selector: "CallExpression[callee.object.name='jest'][callee.property.name='mock']"
  },
  {
    message: "jest.mock is forbidden. Substitute behavior through Effect services and Layers.",
    selector: "CallExpression[callee.object.name='jest'][callee.computed=true][callee.property.value='mock']"
  }
])

const effectImportDiscipline = [
  {
    message: "Import Effect modules by name; namespace imports hide enforceable boundaries.",
    selector: "ImportDeclaration[source.value='effect'] ImportNamespaceSpecifier"
  },
  {
    message: "Keep the canonical Schema name so boundary rules remain visible.",
    selector: "ImportDeclaration[source.value='effect'] ImportSpecifier[imported.name='Schema']:not([local.name='Schema'])"
  }
]

const productionRestrictions = [
  ...clockReads,
  ...moduleMocks,
  ...effectImportDiscipline,
  {
    message: "Unchecked type assertions are forbidden. Parse with Schema, use satisfies, or restructure the code.",
    selector: "TSAsExpression:not([typeAnnotation.typeName.name='const'])"
  },
  {
    message: "Unchecked type assertions are forbidden. Parse with Schema, use satisfies, or restructure the code.",
    selector: "TSTypeAssertion"
  },
  {
    message: "Read runtime configuration through Effect Config at the application boundary.",
    selector: "MemberExpression[object.name='process'][property.name='env']"
  }
]

const testRestrictions = [
  ...clockReads,
  ...moduleMocks,
  ...effectImportDiscipline,
  {
    message: "Double assertions erase evidence even in tests.",
    selector: "TSAsExpression > TSAsExpression"
  }
]

const typedFiles = [
  "src/**/*.{ts,tsx}",
  "packages/**/*.{ts,tsx}",
  "scripts/**/*.ts",
  "test/**/*.{ts,tsx}",
  "*.config.ts"
]
const javascriptToolingFiles = ["eslint.config.mjs", "scripts/**/*.mjs"]

export default [
  {
    ignores: ["**/node_modules/**", "**/dist/**", "**/coverage/**", "**/*.md"]
  },
  {
    ...eslint.configs.recommended,
    files: javascriptToolingFiles,
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        process: "readonly"
      },
      sourceType: "module"
    }
  },
  ...tseslint.configs.recommended.map((config) => ({ ...config, files: typedFiles })),
  ...effectEslint.configs.dprint.map((config) => ({ ...config, files: typedFiles })),
  {
    files: typedFiles,
    languageOptions: {
      ecmaVersion: 2022,
      parser: tsParser,
      parserOptions: {
        project: "./tsconfig.lint.json",
        tsconfigRootDir: import.meta.dirname
      },
      sourceType: "module"
    },
    plugins: {
      functional,
      import: fixupPluginRules(importPlugin),
      "sort-destructure-keys": sortDestructureKeys
    },
    rules: {
      "@effect/dprint": ["error", {
        config: {
          indentWidth: 2,
          lineWidth: 120,
          quoteStyle: "alwaysDouble",
          semiColons: "asi",
          trailingCommas: "never"
        }
      }],
      "@typescript-eslint/array-type": ["error", { default: "generic", readonly: "generic" }],
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/no-unnecessary-condition": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      ...functional.configs.recommended.rules,
      "functional/immutable-data": "warn",
      "functional/no-classes": "off",
      "functional/no-conditional-statements": "off",
      "functional/no-expression-statements": "off",
      "functional/no-let": "off",
      "functional/no-loop-statements": "off",
      "functional/no-return-void": "off",
      "functional/functional-parameters": "off",
      "functional/prefer-immutable-types": "off",
      "functional/prefer-tacit": "error",
      "import/first": "error",
      "import/no-duplicates": "error",
      "import/newline-after-import": "off",
      "max-lines": ["error", { max: 420, skipBlankLines: true, skipComments: true }],
      "no-console": "error",
      "no-magic-numbers": ["warn", {
        enforceConst: true,
        ignore: [0, 1, 1024],
        ignoreArrayIndexes: true,
        ignoreDefaultValues: true
      }],
      "no-restricted-syntax": ["error", ...productionRestrictions],
      "object-shorthand": "error",
      "sort-destructure-keys/sort-destructure-keys": "error"
    }
  },
  {
    files: ["src/**/*.ts", "packages/*/src/**/*.ts"],
    rules: {
      "functional/no-throw-statements": "error"
    }
  },
  {
    files: ["src/**/*.ts", "packages/*/src/**/*.ts", "scripts/**/*.ts"],
    plugins: { "import-x": importX },
    settings: {
      "import-x/parsers": { "@typescript-eslint/parser": [".ts", ".tsx"] },
      "import-x/resolver": { typescript: { alwaysTryTypes: true } }
    },
    rules: {
      "import-x/no-unused-modules": ["error", { unusedExports: true }]
    }
  },
  {
    files: ["src/index.ts", "packages/*/src/index.ts"],
    rules: {
      "import-x/no-unused-modules": "off"
    }
  },
  {
    files: ["**/*.test.ts", "**/*.spec.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "warn",
      "functional/immutable-data": "off",
      "max-lines": "off",
      "no-magic-numbers": "off",
      "no-restricted-syntax": ["error", ...testRestrictions]
    }
  },
  {
    files: ["**/*.test.ts", "**/*.spec.ts"],
    ignores: ["**/*.property.test.ts"],
    rules: {
      "no-restricted-syntax": ["error", ...testRestrictions, {
        message: "Property tests belong in discoverable *.property.test.ts files.",
        selector: "ImportDeclaration[source.value='fast-check']"
      }, {
        message: "Property tests belong in discoverable *.property.test.ts files.",
        selector: "CallExpression[callee.object.name='fc'][callee.property.name='property']"
      }]
    }
  },
  {
    files: ["scripts/**/*.ts"],
    rules: {
      "functional/no-throw-statements": "off",
      "no-console": "off",
      "no-restricted-syntax": ["error", ...clockReads, ...moduleMocks, ...effectImportDiscipline]
    }
  }
]
