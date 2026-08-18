/** Coverage metrics reported by Vitest and the independent exit-code verifiers. */
const metrics = Object.freeze(["statements", "branches", "functions", "lines"])

const productionThresholds = Object.freeze({ statements: 99, branches: 99, functions: 99, lines: 99 })
const maintainedEvaluationThresholds = Object.freeze({ statements: 90, branches: 90, functions: 90, lines: 90 })

/**
 * The production bracket covers executable application source. Cassette source
 * is evaluated separately because it is a maintained compatibility surface
 * whose current acceptance floor is lower than the application floor.
 */
const brackets = Object.freeze({
  production: Object.freeze({ changedLinesThreshold: 99, name: "production", thresholds: productionThresholds }),
  "maintained-evaluation": Object.freeze({
    changedLinesThreshold: 90,
    name: "maintained-evaluation",
    thresholds: maintainedEvaluationThresholds
  })
})

const disposablePathPattern = /(?:^|\/)(?:disposable-prototypes?|lab(?:s)?|prototypes?|scripts?|tests?)(?:\/|$)/u
const testSourcePattern = /(?:\.test|\.spec)\.[^.]+$/u
const declarationSourcePattern = /\.d\.(?:cts|mts|ts)$/u
const maintainedEvaluationSourcePatterns = Object.freeze([
  /(?:^|\/)packages\/dalph\/src\/cassettes\/.+\.ts$/u,
  /(?:^|\/)packages\/orchestrator\/src\/workflow\/protocols\/integration-finality\/fixtures\.ts$/u
])
const productionSourcePattern = /(?:^|\/)(?:src|packages\/[^/]+\/src)\/.+\.(?:m?tsx?|m?jsx?)$/u

const normalizePath = (path) => path.replaceAll("\\", "/")

/** Return the independent coverage bracket for a repository or absolute path. */
export const coverageBracketForPath = (path) => {
  const normalized = normalizePath(path)
  if (
    disposablePathPattern.test(normalized) ||
    testSourcePattern.test(normalized) ||
    declarationSourcePattern.test(normalized)
  )
    return undefined
  if (maintainedEvaluationSourcePatterns.some((pattern) => pattern.test(normalized))) return "maintained-evaluation"
  if (productionSourcePattern.test(normalized)) return "production"
  return undefined
}

/** Aggregate coverage goals consumed by Vitest and the independent exit-code verifiers. */
export const coveragePolicy = Object.freeze({
  brackets,
  changedProductionLinesThreshold: brackets.production.changedLinesThreshold,
  globalThresholds: maintainedEvaluationThresholds,
  metrics,
  thresholds: productionThresholds
})
