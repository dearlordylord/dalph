import type { QuintManifestCommand } from "./quint-gate-command-manifest.mjs"

export interface QuintProfileCommand extends QuintManifestCommand {
  readonly durationSeconds: number
}

export interface QuintProfileEvidence {
  readonly id: string
  readonly node: string
  readonly repeat: string
  readonly installSeconds: number | null
  readonly formalSeconds: number
  readonly budgetSeconds: number
  readonly source: { readonly path: string | undefined; readonly sha256: string }
  readonly commandCount: number
  readonly phaseCommandCounts: Readonly<Record<string, number>>
  readonly phaseTotals: Readonly<Record<string, number>>
  readonly commands: ReadonlyArray<QuintProfileCommand>
}

export declare const parseProfileLog: (args: {
  readonly id: string
  readonly node: string
  readonly repeat: string
  readonly installSeconds: string
  readonly log: string
  readonly sourcePath?: string
}) => QuintProfileEvidence
export declare const parseProfile: (value: string) => QuintProfileEvidence
export declare const generateEvidence: (args: {
  readonly outputPath: string
  readonly profileArguments: ReadonlyArray<string>
}) => { readonly schemaVersion: number; readonly generatedBy: string; readonly profiles: ReadonlyArray<QuintProfileEvidence> }
export declare const runCli: (values: ReadonlyArray<string>) => unknown
