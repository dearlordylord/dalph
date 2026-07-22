export interface CoverageSummary {
  readonly total?: Partial<Record<"statements" | "branches" | "functions" | "lines", {
    readonly pct?: number
  }>>
}

export declare const coverageThresholdFailures: (
  summary: CoverageSummary,
  threshold?: number
) => ReadonlyArray<string>
export declare const coverageExitCode: (summary: CoverageSummary, threshold?: number) => number
