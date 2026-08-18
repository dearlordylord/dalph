export type CoverageMetric = "statements" | "branches" | "functions" | "lines"
export type CoverageThresholds = Readonly<Record<CoverageMetric, number>>
export type CoverageBracketName = "production" | "maintained-evaluation"

export interface CoverageBracketPolicy {
  readonly changedLinesThreshold: number
  readonly name: CoverageBracketName
  readonly thresholds: CoverageThresholds
}

export interface CoverageBracketPolicies {
  readonly production: CoverageBracketPolicy
  readonly "maintained-evaluation": CoverageBracketPolicy
}

export declare const coverageBracketForPath: (path: string) => CoverageBracketName | undefined
export declare const coveragePolicy: {
  readonly brackets: CoverageBracketPolicies
  readonly changedProductionLinesThreshold: number
  readonly globalThresholds: CoverageThresholds
  readonly metrics: ReadonlyArray<CoverageMetric>
  readonly thresholds: CoverageThresholds
}
