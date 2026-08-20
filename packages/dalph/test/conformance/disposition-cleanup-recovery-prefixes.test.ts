import { it } from "@effect/vitest"
import { Effect } from "effect"
import { expect } from "vitest"
import {
  AcceptedResult,
  EvidenceDigest,
  EvidenceReference,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  AttemptId,
  GitCommitSha,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import {
  FixtureTarget,
  InitialControlPolicy,
  InRunJournal,
  JournalPosition,
  JournalStore,
  OperationId,
  PlannedAttemptCleanupDisposition,
  BranchCleanupAuthorization,
  BranchCleanupEvidenceRevision,
  BranchCleanupMutationResult,
  BranchCleanupObservation,
  BranchCleanupOwner,
  IntegratorCandidateCleanupAuthorization,
  IntegratorCandidateCleanupDisposition,
  IntegratorCandidateCleanupEvidenceRevision,
  IntegratorCandidateCleanupMutationResult,
  IntegratorCandidateCleanupObservation,
  IntegratorCandidateCleanupOwner,
  IntegratorCandidateResourceLocator,
  IntegratorSessionCorrelation,
  IntegratorSessionId,
  JournalRecord,
  WorktreeCleanupAuthorization,
  WorktreeCleanupEvidenceRevision,
  WorktreeCleanupMutationResult,
  WorktreeCleanupObservation,
  WorktreeCleanupOwner,
  TaskWorkCapacity,
  TestWorktreeCleanupBoundary,
  TestBranchCleanupBoundary,
  TestIntegratorCandidateCleanupBoundary,
  branchCleanupTestLayer,
  runBranchCleanup,
  integratorCandidateCleanupTestLayer,
  runIntegratorCandidateCleanup,
  memoryJournalTestLayer,
  runWorktreeCleanup,
  worktreeCleanupTestLayer
} from "@dalph/orchestrator"
import {
  expectedRecoveryPrefix,
  prefixThrough,
  recoveryPrefixMismatch,
  replayRecoveryPrefix
} from "./recovery-store-lanes.js"
import type { RecoveryPrefixResume } from "./recovery-store-lanes.js"
import { recoveryPrefixCutLabels, type RecoveryPrefixCutLabel } from "./recovery-prefix-contract.js"

const runId = RunId.make("issue-69-recovery-prefix-run")
const baseSha = GitCommitSha.make("1111111111111111111111111111111111111111")
const attempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("issue-69-recovery-p1"),
  baseSha,
  branch: TaskBranchRef.make("refs/heads/task/issue-69-recovery-p1"),
  executor: TaskExecutorLocator.make("executor:issue-69-recovery"),
  runId,
  taskId: TaskId.make("issue-69-recovery-task"),
  taskRevision: TaskRevision.make("revision:1"),
  worktree: WorktreeLocator.make("/tmp/issue-69-recovery-p1")
})
const successor = PlannedTaskAttempt.make({
  ...attempt,
  attemptId: AttemptId.make("issue-69-recovery-p2"),
  branch: TaskBranchRef.make("refs/heads/task/issue-69-recovery-p2"),
  worktree: WorktreeLocator.make("/tmp/issue-69-recovery-p2")
})
const authorization = WorktreeCleanupAuthorization.make({
  causalPredecessors: [OperationId.make("issue-69-recovery-restart")],
  disposition: PlannedAttemptCleanupDisposition.cases.Superseded.make({
    dispositionAt: JournalPosition.make(2),
    plannedAttempt: attempt,
    successorAttempt: successor
  }),
  evidenceRevision: WorktreeCleanupEvidenceRevision.make(1),
  expectedHead: baseSha,
  locator: attempt.worktree,
  observationAt: JournalPosition.make(3),
  observationOperationId: OperationId.make("issue-69-recovery-worktree-read"),
  operationId: OperationId.make("issue-69-recovery-worktree-cleanup"),
  owner: WorktreeCleanupOwner.make({ attemptId: attempt.attemptId, branch: attempt.branch }),
  writerQuiescent: true
})
const present = WorktreeCleanupObservation.cases.Present.make({
  attemptId: attempt.attemptId,
  branch: attempt.branch,
  headSha: baseSha,
  locator: attempt.worktree,
  revision: WorktreeCleanupEvidenceRevision.make(1),
  writerQuiescent: true
})
const absent = WorktreeCleanupObservation.cases.Absent.make({
  locator: attempt.worktree,
  revision: WorktreeCleanupEvidenceRevision.make(2)
})

const branchAuthorization = BranchCleanupAuthorization.make({
  causalPredecessors: [authorization.operationId],
  disposition: authorization.disposition,
  evidenceRevision: BranchCleanupEvidenceRevision.make(1),
  expectedHead: baseSha,
  locator: attempt.branch,
  observationAt: JournalPosition.make(5),
  observationOperationId: OperationId.make("issue-69-recovery-branch-read"),
  operationId: OperationId.make("issue-69-recovery-branch-cleanup"),
  owner: BranchCleanupOwner.make({ attemptId: attempt.attemptId }),
  worktreeCleanupOperationId: authorization.operationId,
  writerQuiescent: true
})
const branchPresent = BranchCleanupObservation.cases.Present.make({
  branch: attempt.branch,
  headSha: baseSha,
  registeredWorktree: null,
  revision: BranchCleanupEvidenceRevision.make(1)
})
const branchAbsent = BranchCleanupObservation.cases.Absent.make({
  branch: attempt.branch,
  revision: BranchCleanupEvidenceRevision.make(2)
})

const candidateAcceptedResult = AcceptedResult.make({
  commit: baseSha,
  evidenceManifest: EvidenceReference.make({ byteLength: 1, digest: EvidenceDigest.make("a".repeat(64)) })
})
const candidateTarget = IntegrationTarget.make({
  ref: IntegrationTargetRef.make("refs/heads/main"),
  repository: GitRepositoryLocator.make("repo:issue-69-recovery")
})
const candidatePredecessor = IntegratorSessionCorrelation.make({
  acceptedResult: candidateAcceptedResult,
  candidateResource: IntegratorCandidateResourceLocator.make("candidate:issue-69-recovery-p1"),
  expectedTargetHead: baseSha,
  integrationTarget: candidateTarget,
  plannedAttempt: attempt,
  queuedAt: JournalPosition.make(1),
  sessionId: IntegratorSessionId.make("session:issue-69-recovery-p1"),
  startedAt: JournalPosition.make(1),
  targetLineageObservedAt: JournalPosition.make(1)
})
const candidateSuccessor = IntegratorSessionCorrelation.make({
  ...candidatePredecessor,
  candidateResource: IntegratorCandidateResourceLocator.make("candidate:issue-69-recovery-p2"),
  sessionId: IntegratorSessionId.make("session:issue-69-recovery-p2"),
  targetLineageObservedAt: JournalPosition.make(4)
})
const candidateAuthorization = IntegratorCandidateCleanupAuthorization.make({
  causalPredecessors: [OperationId.make("issue-69-recovery-full-rerun")],
  disposition: IntegratorCandidateCleanupDisposition.make({
    directionAppliedAt: JournalPosition.make(3),
    dispositionAt: JournalPosition.make(2),
    predecessor: candidatePredecessor,
    successor: candidateSuccessor
  }),
  evidenceRevision: IntegratorCandidateCleanupEvidenceRevision.make(1),
  locator: candidatePredecessor.candidateResource,
  observationAt: JournalPosition.make(5),
  observationOperationId: OperationId.make("issue-69-recovery-candidate-read"),
  operationId: OperationId.make("issue-69-recovery-candidate-cleanup"),
  owner: IntegratorCandidateCleanupOwner.make({ sessionId: candidatePredecessor.sessionId }),
  writerQuiescent: true
})
const candidatePresent = IntegratorCandidateCleanupObservation.cases.Present.make({
  locator: candidatePredecessor.candidateResource,
  revision: IntegratorCandidateCleanupEvidenceRevision.make(1),
  sessionId: candidatePredecessor.sessionId,
  writerQuiescent: true
})
const candidateAbsent = IntegratorCandidateCleanupObservation.cases.Absent.make({
  locator: candidatePredecessor.candidateResource,
  revision: IntegratorCandidateCleanupEvidenceRevision.make(2)
})

const maintainedSource = Effect.scoped(
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      FixtureTarget.make("issue-69-recovery-target"),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    yield* runWorktreeCleanup(authorization)
    yield* runWorktreeCleanup(authorization)
    return yield* journal.read(runId)
  }).pipe(
    Effect.provide(
      worktreeCleanupTestLayer({
        observations: [present, absent],
        mutations: [
          WorktreeCleanupMutationResult.cases.Unknown.make({
            branch: attempt.branch,
            detail: "lost response",
            locator: attempt.worktree
          })
        ]
      })
    ),
    Effect.provide(memoryJournalTestLayer)
  )
)

interface CleanupResumeEvidence {
  readonly finalTag: string
  readonly mutationCalls: number
  readonly mutationIntentCount: number
  readonly observationCalls: number
  readonly settlementCount: number
}

const resumeCleanupAfter =
  (cut: RecoveryPrefixCutLabel): RecoveryPrefixResume =>
  ({ inRunJournal, journal }) => {
    const responseLossCut = cut === "P0" || cut === "P1"
    const boundary = worktreeCleanupTestLayer(
      responseLossCut
        ? {
            observations: [present, absent],
            mutations: [
              WorktreeCleanupMutationResult.cases.Unknown.make({
                branch: attempt.branch,
                detail: "response lost after apply",
                locator: attempt.worktree
              })
            ]
          }
        : { observations: [absent] }
    )
    return Effect.gen(function* () {
      const first = yield* runWorktreeCleanup(authorization)
      const final = responseLossCut ? yield* runWorktreeCleanup(authorization) : first
      const records = yield* journal.read(runId)
      const calls = yield* (yield* TestWorktreeCleanupBoundary).calls()
      return {
        finalTag: final._tag,
        mutationCalls: calls.filter(({ _tag }) => _tag === "Remove").length,
        mutationIntentCount: records.filter(({ event }) => event._tag === "WorktreeCleanupMutationIntended").length,
        observationCalls: calls.filter(({ _tag }) => _tag === "Observe").length,
        settlementCount: records.filter(({ event }) => event._tag === "WorktreeCleanupSettled").length
      } satisfies CleanupResumeEvidence
    }).pipe(Effect.provideService(InRunJournal, inRunJournal), Effect.provide(boundary))
  }

const endpointForCut = (
  records: ReadonlyArray<{ readonly event: { readonly _tag: string; readonly [key: string]: unknown } }>,
  cut: RecoveryPrefixCutLabel
) => {
  if (cut === "P0")
    return {
      position: records.findIndex(({ event }) => event._tag === "WorkflowRunBegan"),
      endpoint: "WorkflowRunBegan before WorktreeCleanupAuthorized"
    }
  if (cut === "P1")
    return {
      position: records.findIndex(({ event }) => event._tag === "WorktreeCleanupAuthorized"),
      endpoint: "WorktreeCleanupAuthorized"
    }
  if (cut === "P2")
    return {
      position: records.findIndex(({ event }) => event._tag === "WorktreeCleanupMutationIntended"),
      endpoint: "WorktreeCleanupMutationIntended"
    }
  if (cut === "P3")
    return {
      position: records.findIndex(
        ({ event }) =>
          event._tag === "WorktreeCleanupMutationResultRecorded" &&
          typeof event["result"] === "object" &&
          event["result"] !== null &&
          "_tag" in event["result"] &&
          event["result"]["_tag"] === "Unknown"
      ),
      endpoint: "WorktreeCleanupMutationResultRecorded (Unknown)"
    }
  if (cut === "P4")
    return {
      position: records.findIndex(
        ({ event }) =>
          event._tag === "WorktreeCleanupObservationIntended" && "ordinal" in event && event["ordinal"] === 2
      ),
      endpoint: "WorktreeCleanupObservationIntended (ordinal 2)"
    }
  if (cut === "P5")
    return {
      position: records.findIndex(
        ({ event }) => event._tag === "WorktreeCleanupObserved" && "ordinal" in event && event["ordinal"] === 2
      ),
      endpoint: "WorktreeCleanupObserved (ordinal 2)"
    }
  return {
    position: records.findIndex(({ event }) => event._tag === "WorktreeCleanupSettled"),
    endpoint: "WorktreeCleanupSettled"
  }
}

it.effect("reopens every cleanup P0-P6 prefix through memory and SQLite", () =>
  Effect.gen(function* () {
    const records = yield* maintainedSource
    const cuts = recoveryPrefixCutLabels.flatMap((cut) => {
      const { endpoint, position } = endpointForCut(records, cut)
      const prefix = prefixThrough(records, cut, endpoint, position)
      return prefix === undefined ? [] : [prefix]
    })
    expect(cuts).toHaveLength(7)
    for (const prefix of cuts) {
      const expected = yield* expectedRecoveryPrefix(prefix)
      for (const lane of ["memory", "sqlite"] as const) {
        const actual = yield* replayRecoveryPrefix(prefix, lane, resumeCleanupAfter(prefix.cut))
        expect(recoveryPrefixMismatch(prefix.cut, lane, expected, actual), `${prefix.cut}/${lane}`).toBeUndefined()
        const evidence = actual.resumption as CleanupResumeEvidence | undefined
        expect(evidence, `${prefix.cut}/${lane} must resume production cleanup`).toBeDefined()
        if (evidence === undefined) continue
        expect(evidence.finalTag, `${prefix.cut}/${lane} final outcome`).toBe("Settled")
        expect(evidence.mutationIntentCount, `${prefix.cut}/${lane} mutation intents`).toBe(1)
        expect(evidence.settlementCount, `${prefix.cut}/${lane} settlements`).toBe(1)
        expect(evidence.observationCalls, `${prefix.cut}/${lane} fresh reads`).toBe(
          prefix.cut === "P0" || prefix.cut === "P1" ? 2 : 1
        )
        expect(evidence.mutationCalls, `${prefix.cut}/${lane} delete calls`).toBe(
          prefix.cut === "P0" || prefix.cut === "P1" ? 1 : 0
        )
      }
    }
  })
)

const branchMaintainedSource = Effect.scoped(
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      FixtureTarget.make("issue-69-branch-recovery-target"),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    const worktree = yield* runWorktreeCleanup(authorization)
    if (worktree._tag !== "Settled") return yield* Effect.die("branch recovery source could not settle its worktree")
    yield* runBranchCleanup(branchAuthorization)
    yield* runBranchCleanup(branchAuthorization)
    return yield* journal.read(runId)
  }).pipe(
    Effect.provide(
      worktreeCleanupTestLayer({
        observations: [present, absent],
        mutations: [
          WorktreeCleanupMutationResult.cases.Removed.make({
            branch: attempt.branch,
            locator: attempt.worktree,
            revision: WorktreeCleanupEvidenceRevision.make(2)
          })
        ]
      })
    ),
    Effect.provide(
      branchCleanupTestLayer({
        observations: [branchPresent, branchAbsent],
        mutations: [
          BranchCleanupMutationResult.cases.Unknown.make({
            branch: attempt.branch,
            detail: "response lost after apply"
          })
        ]
      })
    ),
    Effect.provide(memoryJournalTestLayer)
  )
)

const candidateMaintainedSource = Effect.scoped(
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      FixtureTarget.make("issue-69-candidate-recovery-target"),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    yield* runIntegratorCandidateCleanup(candidateAuthorization)
    yield* runIntegratorCandidateCleanup(candidateAuthorization)
    return yield* journal.read(runId)
  }).pipe(
    Effect.provide(
      integratorCandidateCleanupTestLayer({
        observations: [candidatePresent, candidateAbsent],
        mutations: [
          IntegratorCandidateCleanupMutationResult.cases.Unknown.make({
            detail: "response lost after apply",
            locator: candidatePredecessor.candidateResource,
            sessionId: candidatePredecessor.sessionId
          })
        ]
      })
    ),
    Effect.provide(memoryJournalTestLayer)
  )
)

const resumeBranchCleanupAfter =
  (cut: RecoveryPrefixCutLabel): RecoveryPrefixResume =>
  ({ inRunJournal, journal }) => {
    const responseLossCut = cut === "P0" || cut === "P1"
    const boundary = branchCleanupTestLayer(
      responseLossCut
        ? {
            observations: [branchPresent, branchAbsent],
            mutations: [
              BranchCleanupMutationResult.cases.Unknown.make({
                branch: attempt.branch,
                detail: "response lost after apply"
              })
            ]
          }
        : { observations: [branchAbsent] }
    )
    return Effect.gen(function* () {
      const first = yield* runBranchCleanup(branchAuthorization)
      const final = responseLossCut ? yield* runBranchCleanup(branchAuthorization) : first
      const records = yield* journal.read(runId)
      const calls = yield* (yield* TestBranchCleanupBoundary).calls()
      return {
        finalTag: final._tag,
        mutationCalls: calls.filter(({ _tag }) => _tag === "Remove").length,
        mutationIntentCount: records.filter(
          ({ event }) =>
            event._tag === "BranchCleanupMutationIntended" &&
            event.authorization.operationId === branchAuthorization.operationId
        ).length,
        observationCalls: calls.filter(({ _tag }) => _tag === "Observe").length,
        settlementCount: records.filter(
          ({ event }) =>
            event._tag === "BranchCleanupSettled" && event.authorization.operationId === branchAuthorization.operationId
        ).length
      } satisfies CleanupResumeEvidence
    }).pipe(Effect.provideService(InRunJournal, inRunJournal), Effect.provide(boundary))
  }

const resumeCandidateCleanupAfter =
  (cut: RecoveryPrefixCutLabel): RecoveryPrefixResume =>
  ({ inRunJournal, journal }) => {
    const responseLossCut = cut === "P0" || cut === "P1"
    const boundary = integratorCandidateCleanupTestLayer(
      responseLossCut
        ? {
            observations: [candidatePresent, candidateAbsent],
            mutations: [
              IntegratorCandidateCleanupMutationResult.cases.Unknown.make({
                detail: "response lost after apply",
                locator: candidatePredecessor.candidateResource,
                sessionId: candidatePredecessor.sessionId
              })
            ]
          }
        : { observations: [candidateAbsent] }
    )
    return Effect.gen(function* () {
      const first = yield* runIntegratorCandidateCleanup(candidateAuthorization)
      const final = responseLossCut ? yield* runIntegratorCandidateCleanup(candidateAuthorization) : first
      const records = yield* journal.read(runId)
      const calls = yield* (yield* TestIntegratorCandidateCleanupBoundary).calls()
      return {
        finalTag: final._tag,
        mutationCalls: calls.filter(({ _tag }) => _tag === "Remove").length,
        mutationIntentCount: records.filter(
          ({ event }) =>
            event._tag === "IntegratorCandidateCleanupMutationIntended" &&
            event.authorization.operationId === candidateAuthorization.operationId
        ).length,
        observationCalls: calls.filter(({ _tag }) => _tag === "Observe").length,
        settlementCount: records.filter(
          ({ event }) =>
            event._tag === "IntegratorCandidateCleanupSettled" &&
            event.authorization.operationId === candidateAuthorization.operationId
        ).length
      } satisfies CleanupResumeEvidence
    }).pipe(Effect.provideService(InRunJournal, inRunJournal), Effect.provide(boundary))
  }

const endpointForFamily = (
  records: ReadonlyArray<{ readonly event: { readonly _tag: string; readonly [key: string]: unknown } }>,
  cut: RecoveryPrefixCutLabel,
  tags: {
    readonly authorized: string
    readonly mutationIntended: string
    readonly mutationResult: string
    readonly observationIntended: string
    readonly observed: string
    readonly settled: string
  },
  p0UsesPriorRecord: boolean
) => {
  const authorizedPosition = records.findIndex(({ event }) => event._tag === tags.authorized)
  if (cut === "P0") {
    return {
      position: p0UsesPriorRecord
        ? authorizedPosition - 1
        : records.findIndex(({ event }) => event._tag === "WorkflowRunBegan"),
      endpoint: p0UsesPriorRecord
        ? `${tags.authorized} predecessor endpoint`
        : "WorkflowRunBegan before cleanup authorization"
    }
  }
  if (cut === "P1") return { position: authorizedPosition, endpoint: tags.authorized }
  if (cut === "P2") {
    return {
      position: records.findIndex(({ event }) => event._tag === tags.mutationIntended),
      endpoint: tags.mutationIntended
    }
  }
  if (cut === "P3") {
    return {
      position: records.findIndex(
        ({ event }) =>
          event._tag === tags.mutationResult &&
          typeof event["result"] === "object" &&
          event["result"] !== null &&
          "_tag" in event["result"] &&
          event["result"]["_tag"] === "Unknown"
      ),
      endpoint: `${tags.mutationResult} (Unknown)`
    }
  }
  if (cut === "P4") {
    return {
      position: records.findIndex(
        ({ event }) => event._tag === tags.observationIntended && "ordinal" in event && event["ordinal"] === 2
      ),
      endpoint: `${tags.observationIntended} (ordinal 2)`
    }
  }
  if (cut === "P5") {
    return {
      position: records.findIndex(
        ({ event }) => event._tag === tags.observed && "ordinal" in event && event["ordinal"] === 2
      ),
      endpoint: `${tags.observed} (ordinal 2, Absent)`
    }
  }
  return { position: records.findIndex(({ event }) => event._tag === tags.settled), endpoint: tags.settled }
}

const assertCleanupRecoveryFamily = (
  records: ReadonlyArray<JournalRecord>,
  endpoint: (
    records: ReadonlyArray<{ readonly event: { readonly _tag: string; readonly [key: string]: unknown } }>,
    cut: RecoveryPrefixCutLabel
  ) => { readonly position: number; readonly endpoint: string },
  resume: (cut: RecoveryPrefixCutLabel) => RecoveryPrefixResume
) =>
  Effect.gen(function* () {
    const cuts = recoveryPrefixCutLabels.flatMap((cut) => {
      const { endpoint: name, position } = endpoint(records, cut)
      const prefix = prefixThrough(records, cut, name, position)
      return prefix === undefined ? [] : [prefix]
    })
    expect(cuts).toHaveLength(7)
    for (const prefix of cuts) {
      const expected = yield* expectedRecoveryPrefix(prefix)
      for (const lane of ["memory", "sqlite"] as const) {
        const actual = yield* replayRecoveryPrefix(prefix, lane, resume(prefix.cut))
        expect(recoveryPrefixMismatch(prefix.cut, lane, expected, actual), `${prefix.cut}/${lane}`).toBeUndefined()
        const evidence = actual.resumption as CleanupResumeEvidence | undefined
        expect(evidence, `${prefix.cut}/${lane} must resume production cleanup`).toBeDefined()
        if (evidence === undefined) continue
        expect(evidence.finalTag, `${prefix.cut}/${lane} final outcome`).toBe("Settled")
        expect(evidence.mutationIntentCount, `${prefix.cut}/${lane} mutation intents`).toBe(1)
        expect(evidence.settlementCount, `${prefix.cut}/${lane} settlements`).toBe(1)
        expect(evidence.observationCalls, `${prefix.cut}/${lane} fresh reads`).toBe(
          prefix.cut === "P0" || prefix.cut === "P1" ? 2 : 1
        )
        expect(evidence.mutationCalls, `${prefix.cut}/${lane} delete calls`).toBe(
          prefix.cut === "P0" || prefix.cut === "P1" ? 1 : 0
        )
      }
    }
  })

it.effect("reopens branch and predecessor-candidate cleanup P0-P6 prefixes through memory and SQLite", () =>
  Effect.gen(function* () {
    const branchRecords = yield* branchMaintainedSource
    yield* assertCleanupRecoveryFamily(
      branchRecords,
      (records, cut) =>
        endpointForFamily(
          records,
          cut,
          {
            authorized: "BranchCleanupAuthorized",
            mutationIntended: "BranchCleanupMutationIntended",
            mutationResult: "BranchCleanupMutationResultRecorded",
            observationIntended: "BranchCleanupObservationIntended",
            observed: "BranchCleanupObserved",
            settled: "BranchCleanupSettled"
          },
          true
        ),
      resumeBranchCleanupAfter
    )
    const candidateRecords = yield* candidateMaintainedSource
    yield* assertCleanupRecoveryFamily(
      candidateRecords,
      (records, cut) =>
        endpointForFamily(
          records,
          cut,
          {
            authorized: "IntegratorCandidateCleanupAuthorized",
            mutationIntended: "IntegratorCandidateCleanupMutationIntended",
            mutationResult: "IntegratorCandidateCleanupMutationResultRecorded",
            observationIntended: "IntegratorCandidateCleanupObservationIntended",
            observed: "IntegratorCandidateCleanupObserved",
            settled: "IntegratorCandidateCleanupSettled"
          },
          false
        ),
      resumeCandidateCleanupAfter
    )
  })
)
