import type { QuintManifestCommandKind } from "./quint-gate-command-manifest.mjs"

export interface QuintEffectiveVerdict {
  readonly acceptedExitCodes: ReadonlyArray<number>
  readonly witnesses: ReadonlyArray<string>
  readonly temporal: "clean" | "violation" | null
  readonly collectedReplacementTest: boolean
  readonly artifactPreparedAfter: boolean
}
export interface QuintEffectiveCommand {
  readonly position: number
  readonly kind: QuintManifestCommandKind
  readonly name: string
  readonly args: ReadonlyArray<string>
  readonly options: { readonly acceptedExitCodes: ReadonlyArray<number>; readonly captureOutput: boolean }
  readonly verdict: QuintEffectiveVerdict
}
export interface QuintEffectiveProfile {
  readonly version: 1
  readonly commands: ReadonlyArray<QuintEffectiveCommand>
  readonly steps: ReadonlyArray<
    | { readonly kind: "evaluator-provenance" }
    | {
      readonly kind: "commands"
      readonly positions: ReadonlyArray<number>
      readonly concurrency: number
      readonly serializedPrefix: number
    }
  >
  readonly execution: {
    readonly executable: string
    readonly entryPoint: string
    readonly captureOutput: boolean
    readonly forwardOutput: boolean
    readonly relayParentSignals: boolean
    readonly abortSignal: string
    readonly serverEndpoint: string
    readonly evaluatorProvenanceAfterPosition: number
  }
  readonly policy: {
    readonly regressionBudgetMilliseconds: number
    readonly safetyTimeoutMilliseconds: number
    readonly terminationGraceMilliseconds: number
    readonly processGroupAbsenceTimeoutMilliseconds: number
    readonly apalacheVersion: string
  }
}
export declare const createQuintEffectiveProfile: () => QuintEffectiveProfile
export declare const assertQuintEffectiveProfile: (profile: QuintEffectiveProfile) => void
