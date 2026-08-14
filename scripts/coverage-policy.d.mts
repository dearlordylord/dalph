export declare const coveragePolicy: {
  readonly metrics: ReadonlyArray<"statements" | "branches" | "functions" | "lines">
  readonly thresholds: Readonly<{
    readonly statements: number
    readonly branches: number
    readonly functions: number
    readonly lines: number
  }>
  readonly changedProductionLinesThreshold: number
}
