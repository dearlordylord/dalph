export interface CoverageStatementLocation {
  readonly start: { readonly line: number }
  readonly end: { readonly line: number }
}

export interface CoverageFile {
  readonly statementMap?: Readonly<Record<string, CoverageStatementLocation>>
  readonly s?: Readonly<Record<string, number>>
}

export interface ChangedLineFailure {
  readonly path: string
  readonly line: number
  readonly reason?: string
}

export interface ChangedLineCoverageFileResult {
  readonly path: string
  readonly executableLines: number
  readonly coveredLines: number
  readonly uncoveredLines: ReadonlyArray<ChangedLineFailure>
}

export interface ChangedLineCoverageResult {
  readonly files: ReadonlyArray<ChangedLineCoverageFileResult>
  readonly executableLines: number
  readonly coveredLines: number
  readonly uncoveredLines: ReadonlyArray<ChangedLineFailure>
  readonly percentage: number
}

export type GitRunner = (args: ReadonlyArray<string>) => string

export const coverageEligiblePath: (path: string) => boolean
export const changedLinesFromDiff: (diff: string) => ReadonlyMap<string, ReadonlySet<number>>
export const changedProductionLinesFromGit: (options: {
  readonly baseSha: string
  readonly runGit?: GitRunner
  readonly repositoryRoot?: string
  readonly readFile?: (path: string, encoding: "utf8") => string
}) => ReadonlyMap<string, ReadonlySet<number>>
export const changedLineCoverage: (
  coverage: Readonly<Record<string, CoverageFile>>,
  changedLines: ReadonlyMap<string, ReadonlySet<number>>,
  repositoryRoot?: string
) => ChangedLineCoverageResult
export const coverageLineFailures: (
  result: ChangedLineCoverageResult,
  threshold?: number
) => ReadonlyArray<string>
export const resolveCoverageBase: (explicitBase: string | undefined, runGit?: GitRunner) => string
