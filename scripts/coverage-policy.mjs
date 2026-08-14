/** Honest aggregate floors consumed by Vitest and the independent exit-code verifier. */
export const coveragePolicy = Object.freeze({
  metrics: Object.freeze(["statements", "branches", "functions", "lines"]),
  thresholds: Object.freeze({ statements: 98, branches: 96, functions: 97, lines: 98 }),
  changedProductionLinesThreshold: 99
})
