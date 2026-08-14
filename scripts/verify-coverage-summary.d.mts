export interface CoverageSummary {
  readonly total?: Partial<Record<"statements" | "branches" | "functions" | "lines", {
    readonly pct?: number
  }>>
}

export declare const coverageThresholdFailures: (
  summary: CoverageSummary,
  thresholds?: Readonly<Record<"statements" | "branches" | "functions" | "lines", number>>
) => ReadonlyArray<string>
export declare const coverageExitCode: (
  summary: CoverageSummary,
  thresholds?: Readonly<Record<"statements" | "branches" | "functions" | "lines", number>>
) => number
