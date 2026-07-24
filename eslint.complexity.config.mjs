import tsParser from "@typescript-eslint/parser"
import functional from "eslint-plugin-functional"
import tseslint from "typescript-eslint"

export default [{
  ignores: ["**/build", "**/coverage", "**/dist", "**/node_modules"]
}, {
  files: ["src/**/*.ts", "packages/**/bin/**/*.ts", "packages/**/src/**/*.ts"],
  ignores: ["**/*.test.ts", "**/*.spec.ts"],
  linterOptions: {
    reportUnusedDisableDirectives: "off"
  },
  languageOptions: {
    parser: tsParser
  },
  plugins: {
    "@typescript-eslint": tseslint.plugin,
    functional
  },
  rules: {
    complexity: ["error", { max: 8, variant: "classic" }]
  }
}]
