export interface HostedFormalBinding {
  readonly runId: string
  readonly runAttempt: string
  readonly commitSha: string
  readonly nodeVersion: string
}

export interface HostedFormalCommandEvidence {
  readonly position: number
  readonly name: string
  readonly kind: "typecheck" | "test" | "sampled-run" | "verify"
  readonly args: ReadonlyArray<string>
  readonly verdict: {
    readonly acceptedExitCodes: ReadonlyArray<number>
    readonly witnesses: ReadonlyArray<string>
    readonly temporal: "clean" | "violation" | null
    readonly collectedReplacementTest: boolean
    readonly artifactPreparedAfter: boolean
  }
  readonly result: "exit:0" | "exit:1"
  readonly obligationId: string
  readonly durationMilliseconds: number
}

export interface HostedFormalAggregate {
  readonly version: 1
  readonly binding: HostedFormalBinding
  readonly profileDigest: string
  readonly commands: number
  readonly commandEvidence: ReadonlyArray<HostedFormalCommandEvidence>
  readonly negativeControls: ReadonlyArray<string>
}

export function aggregateHostedFormalShards(input: {
  readonly binding: HostedFormalBinding
  readonly envelopes: ReadonlyArray<unknown>
}): HostedFormalAggregate
