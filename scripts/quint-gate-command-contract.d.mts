import type { QuintManifestCommand } from "./quint-gate-command-manifest.mjs"

export interface QuintGateCommandCounts {
  readonly total: number
  readonly typecheck: number
  readonly test: number
  readonly "sampled-run": number
  readonly verify: number
}

export declare const quintGateExpectedCommandCounts: Readonly<QuintGateCommandCounts>
export declare const assertQuintGateCommandContract: (args: {
  readonly manifest: ReadonlyArray<QuintManifestCommand>
  readonly executed: QuintGateCommandCounts
}) => void
