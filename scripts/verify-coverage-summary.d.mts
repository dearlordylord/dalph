import type { CoverageBracketName, CoverageMetric, CoverageThresholds } from "./coverage-policy.mjs"

export interface CoverageFile {
  readonly path?: string
  readonly statementMap?: Readonly<Record<string, {
    readonly start: { readonly line: number }
    readonly end: { readonly line: number }
  }>>
  readonly s?: Readonly<Record<string, number>>
  readonly l?: Readonly<Record<string, number>>
  readonly b?: Readonly<Record<string, ReadonlyArray<number>>>
  readonly f?: Readonly<Record<string, number>>
}

export type CoverageFinal = Readonly<Record<string, CoverageFile>>

export interface CoverageMetricSummary {
  readonly covered: number
  readonly pct: number
  readonly skipped: number
  readonly total: number
}

export interface CoverageSummary {
  readonly total?: Partial<Record<CoverageMetric, {
    readonly pct?: number
  }>>
}

export interface CoverageBracketSummary {
  readonly total: Readonly<Record<CoverageMetric, CoverageMetricSummary>>
}

export interface CoverageBracketSummaries {
  readonly production: CoverageBracketSummary
  readonly "maintained-evaluation": CoverageBracketSummary
}

export declare const coverageThresholdFailures: (
  summary: CoverageSummary,
  thresholds?: CoverageThresholds
) => ReadonlyArray<string>
export declare const coverageExitCode: (
  summary: CoverageSummary,
  thresholds?: CoverageThresholds
) => number
export declare const coverageBracketSummaries: (coverage: CoverageFinal) => CoverageBracketSummaries
export declare const coverageBracketThresholdFailures: (coverage: CoverageFinal) => ReadonlyArray<string>
