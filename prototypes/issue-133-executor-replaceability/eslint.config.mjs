import tsParser from "@typescript-eslint/parser"

const forbiddenExecutorInternals = [
  "**/selected-executor-protocol.js",
  "**/implementation-evidence*.js",
  "**/implementation-review*.js",
  "**/implementation-convergence*.js"
]

export default [{
  files: ["**/*.ts"],
  languageOptions: {
    parser: tsParser,
    parserOptions: {
      ecmaVersion: 2022,
      sourceType: "module"
    }
  },
  rules: {
    "no-restricted-imports": ["error", {
      patterns: forbiddenExecutorInternals.map((group) => ({
        group: [group],
        message: "Generic orchestration may import only the executor outer boundary."
      }))
    }]
  }
}]
