export interface FormalEvidenceLocation {
  readonly worktree: string
  readonly custodyRoot: string
  readonly commonDirectory: string
  readonly runDirectory: string
  readonly runId: string
}
export interface FormalEvidenceIdentity {
  readonly version: number
  readonly worktree: string
  readonly inputDigest: string
  readonly [key: string]: unknown
}
export interface FormalAttempt {
  readonly version: 1
  readonly policyVersion: number
  readonly attemptId: string
  readonly runId: string
  readonly runDirectory: string
  readonly worktree: string
  readonly host: { readonly hostname: string; readonly bootId: string }
  readonly identity: FormalEvidenceIdentity
  readonly profileIdentity: string
  readonly startedAt: string
  readonly pointerPath: string
  readonly recordPath: string
}
export interface FormalExecutionEvidence {
  readonly helperObligationId: string
  readonly reportPath: string
  readonly reportDigest: string
}
export interface FormalObservationEvidence {
  readonly version: 1
  readonly observerVersion: 1
  readonly ready: boolean
  readonly drained: boolean
  readonly unchanged: boolean
  readonly inputDigest: string
}
export interface FormalSuccess extends FormalAttempt {
  readonly state: "passed"
  readonly finishedAt: string
  readonly execution: FormalExecutionEvidence
  readonly observation: FormalObservationEvidence
}
export interface FormalEvidenceOptions {
  readonly location: FormalEvidenceLocation
  readonly identity: FormalEvidenceIdentity
  readonly profileIdentity: string
}
export declare const beginFormalAttempt: (options: FormalEvidenceOptions) => FormalAttempt
export declare const invalidateFormalAttempt: (options: {
  readonly attempt: FormalAttempt
  readonly reason: string
}) => void
export declare const validateFormalExecution: (options: { readonly attempt: FormalAttempt; readonly execution: FormalExecutionEvidence }) => { readonly report: unknown; readonly receipts: ReadonlyArray<unknown>; readonly used: ReadonlySet<string> }
export declare const publishFormalSuccess: (options: { readonly attempt: FormalAttempt; readonly execution: FormalExecutionEvidence; readonly observation: FormalObservationEvidence }) => FormalSuccess
export declare const readFormalSuccess: (options: FormalEvidenceOptions) => { readonly status: "miss"; readonly reason: string } | { readonly status: "hit"; readonly success: FormalSuccess; readonly evidencePath: string }
export declare const readReferencedFormalSuccess: (options: {
  readonly recordPath: string
  readonly worktree: string
  readonly identity?: FormalEvidenceIdentity
  readonly profileIdentity?: string
}) => FormalSuccess
