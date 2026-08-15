/** Aggregate coverage goals consumed by Vitest and the independent exit-code verifier. */
export const coveragePolicy = Object.freeze({
  metrics: Object.freeze(["statements", "branches", "functions", "lines"]),
  thresholds: Object.freeze({ statements: 99, branches: 99, functions: 99, lines: 99 }),
  changedProductionLinesThreshold: 99
})
