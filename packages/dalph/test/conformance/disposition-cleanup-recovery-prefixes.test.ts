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
  WorktreeLocator,
  encodeTaskRevisionFingerprint
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
  worktreeCleanupTestLayer,
  appendCandidateProvenance,
  appendReplacementProvenance,
  replacementPredecessorsFor,
  replacementWorktreeObservationOperationIdFor
} from "@dalph/orchestrator"
import type { JournalRecord } from "@dalph/orchestrator"
import {
  expectedRecoveryPrefix,
  prefixThrough,
  recoveryPrefixMismatch,
  replayRecoveryPrefix
} from "./recovery-store-lanes.js"
import type { RecoveryPrefix, RecoveryPrefixResume } from "./recovery-store-lanes.js"
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
  taskRevision: encodeTaskRevisionFingerprint(
    JSON.stringify({ body: "cleanup provenance witness", title: "cleanup provenance witness" })
  ),
  worktree: WorktreeLocator.make("/tmp/issue-69-recovery-p2")
})
const authorization = WorktreeCleanupAuthorization.make({
  causalPredecessors: replacementPredecessorsFor(attempt),
  disposition: PlannedAttemptCleanupDisposition.cases.Superseded.make({
    dispositionAt: JournalPosition.make(19),
    plannedAttempt: attempt,
    successorAttempt: successor
  }),
  evidenceRevision: WorktreeCleanupEvidenceRevision.make(1),
  expectedHead: baseSha,
  locator: attempt.worktree,
  observationAt: JournalPosition.make(16),
  observationOperationId: replacementWorktreeObservationOperationIdFor(attempt),
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
  causalPredecessors: [authorization.operationId, ...replacementPredecessorsFor(attempt)],
  disposition: authorization.disposition,
  evidenceRevision: BranchCleanupEvidenceRevision.make(1),
  expectedHead: baseSha,
  locator: attempt.branch,
  observationAt: JournalPosition.make(16),
  observationOperationId: replacementWorktreeObservationOperationIdFor(attempt),
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
  queuedAt: JournalPosition.make(2),
  sessionId: IntegratorSessionId.make("session:issue-69-recovery-p1"),
  startedAt: JournalPosition.make(6),
  targetLineageObservedAt: JournalPosition.make(4)
})
const candidateSuccessor = IntegratorSessionCorrelation.make({
  ...candidatePredecessor,
  candidateResource: IntegratorCandidateResourceLocator.make("candidate:issue-69-recovery-p2"),
  sessionId: IntegratorSessionId.make("session:issue-69-recovery-p2"),
  targetLineageObservedAt: JournalPosition.make(12)
})
const candidateAuthorization = IntegratorCandidateCleanupAuthorization.make({
  causalPredecessors: [OperationId.make("issue-69-recovery-full-rerun")],
  disposition: IntegratorCandidateCleanupDisposition.make({
    directionAppliedAt: JournalPosition.make(10),
    dispositionAt: JournalPosition.make(9),
    predecessor: candidatePredecessor,
    successor: candidateSuccessor
  }),
  evidenceRevision: IntegratorCandidateCleanupEvidenceRevision.make(1),
  locator: candidatePredecessor.candidateResource,
  observationAt: JournalPosition.make(4),
  observationOperationId: OperationId.make("session:issue-69-recovery-p1:predecessor-lineage"),
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
    yield* appendReplacementProvenance(attempt, successor)
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
  readonly familyTags: ReadonlyArray<string>
  readonly absenceCauses: ReadonlyArray<string>
  readonly mutationCalls: number
  readonly mutationIntentCount: number
  readonly mutationAttempts: ReadonlyArray<number>
  readonly observationCalls: number
  readonly observationIntentKeys: ReadonlyArray<string>
  readonly settlementCount: number
}

const cleanupResumeEvidence = (
  records: ReadonlyArray<JournalRecord>,
  family: "Worktree" | "Branch" | "IntegratorCandidate"
) => {
  const familyRecords = records.filter(({ event }) => event._tag.startsWith(`${family}Cleanup`))
  return {
    familyTags: familyRecords.map(({ event }) => event._tag),
    absenceCauses: familyRecords.flatMap(({ event }) =>
      "cause" in event && typeof event.cause === "string" ? [event.cause] : []
    ),
    mutationAttempts: familyRecords.flatMap(({ event }) =>
      event._tag.endsWith("MutationIntended") && "attempt" in event && typeof event.attempt === "number"
        ? [event.attempt]
        : []
    ),
    observationIntentKeys: familyRecords.flatMap(({ event }) =>
      "ordinal" in event &&
      "operationId" in event &&
      event._tag.endsWith("ObservationIntended") &&
      typeof event.ordinal === "number"
        ? [`${event.ordinal}:${event.operationId}`]
        : []
    )
  }
}

const expectedFamilyTagsAfterResume = (
  prefix: RecoveryPrefix,
  family: "Worktree" | "Branch" | "IntegratorCandidate"
): ReadonlyArray<string> => {
  const familyPrefix = `${family}Cleanup`
  const retained = prefix.records
    .filter(({ event }) => event._tag.startsWith(familyPrefix))
    .map(({ event }) => event._tag)
  const tag = (suffix: string) => `${familyPrefix}${suffix}`
  if (prefix.cut === "P0" || prefix.cut === "P1") {
    return [
      tag("Authorized"),
      tag("ObservationIntended"),
      tag("Observed"),
      tag("MutationIntended"),
      tag("MutationResultRecorded"),
      tag("ObservationIntended"),
      tag("Observed"),
      tag("AbsenceConfirmed"),
      tag("Settled")
    ]
  }
  if (prefix.cut === "P2" || prefix.cut === "P3") {
    return [...retained, tag("ObservationIntended"), tag("Observed"), tag("AbsenceConfirmed"), tag("Settled")]
  }
  if (prefix.cut === "P4") {
    return [...retained, tag("Observed"), tag("AbsenceConfirmed"), tag("Settled")]
  }
  if (prefix.cut === "P5") {
    return [...retained, tag("ObservationIntended"), tag("Observed"), tag("AbsenceConfirmed"), tag("Settled")]
  }
  // P6 already contains the exact accepted terminal fact. A replay returns
  // that durable answer without a new boundary read or journal event.
  return retained
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
        ...cleanupResumeEvidence(records, "Worktree"),
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
      position: records.findIndex(({ event }) => event._tag === "WorktreeCleanupAuthorized") - 1,
      endpoint: "record immediately before WorktreeCleanupAuthorized"
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
      const expectedPrefix = yield* expectedRecoveryPrefix(prefix)
      // Use one fresh memory replay as the authoritative post-resume lane for
      // this cut.  P2 legitimately resumes without the lost mutation result,
      // so the final durable record sequence is cut-specific rather than the
      // same raw sequence as the fully exercised source.  Both physical
      // stores must nevertheless match this independently reopened lane in
      // decoded history, validity, and production projection.
      const canonical = yield* replayRecoveryPrefix(prefix, "memory", resumeCleanupAfter(prefix.cut))
      if (
        canonical.finalDecodedRecords === undefined ||
        canonical.finalHistoryTag === undefined ||
        canonical.finalProjection === undefined
      ) {
        return yield* Effect.die(`${prefix.cut} canonical recovery lane did not reread final state`)
      }
      const expected = {
        ...expectedPrefix,
        finalDecodedRecords: canonical.finalDecodedRecords,
        finalHistoryTag: canonical.finalHistoryTag,
        finalProjection: canonical.finalProjection
      }
      const actualByLane = {
        memory: yield* replayRecoveryPrefix(prefix, "memory", resumeCleanupAfter(prefix.cut)),
        sqlite: yield* replayRecoveryPrefix(prefix, "sqlite", resumeCleanupAfter(prefix.cut))
      }
      expect(
        recoveryPrefixMismatch(prefix.cut, "sqlite", actualByLane.memory, actualByLane.sqlite),
        `${prefix.cut}/memory-vs-sqlite resumed final projection`
      ).toBeUndefined()
      for (const lane of ["memory", "sqlite"] as const) {
        const actual = actualByLane[lane]
        expect(recoveryPrefixMismatch(prefix.cut, lane, expected, actual), `${prefix.cut}/${lane}`).toBeUndefined()
        expect(actual.finalHistoryTag, `${prefix.cut}/${lane} final history reread`).toBeDefined()
        expect(actual.finalDecodedRecords, `${prefix.cut}/${lane} final records`).toBeDefined()
        expect(actual.finalProjection, `${prefix.cut}/${lane} final projection`).toBeDefined()
        const evidence = actual.resumption as CleanupResumeEvidence | undefined
        expect(evidence, `${prefix.cut}/${lane} must resume production cleanup`).toBeDefined()
        if (evidence === undefined) continue
        expect(evidence.finalTag, `${prefix.cut}/${lane} final outcome`).toBe("Settled")
        expect(evidence.familyTags, `${prefix.cut}/${lane} exact worktree event order`).toEqual(
          expectedFamilyTagsAfterResume(prefix, "Worktree")
        )
        expect(evidence.absenceCauses, `${prefix.cut}/${lane} absence cause`).toEqual([
          "MutationResponseReconciliation"
        ])
        expect(evidence.mutationAttempts, `${prefix.cut}/${lane} mutation ordinals`).toEqual([1])
        expect(evidence.observationIntentKeys, `${prefix.cut}/${lane} observation identities`).toHaveLength(
          prefix.cut === "P5" ? 3 : 2
        )
        expect(new Set(evidence.observationIntentKeys).size, `${prefix.cut}/${lane} duplicate observation intent`).toBe(
          evidence.observationIntentKeys.length
        )
        if (prefix.cut === "P4") {
          expect(evidence.observationIntentKeys, `${prefix.cut}/${lane} reuses unmatched observation intent`).toEqual(
            cleanupResumeEvidence(prefix.records, "Worktree").observationIntentKeys
          )
        }
        expect(evidence.mutationIntentCount, `${prefix.cut}/${lane} mutation intents`).toBe(1)
        expect(evidence.settlementCount, `${prefix.cut}/${lane} settlements`).toBe(1)
        expect(evidence.observationCalls, `${prefix.cut}/${lane} fresh reads`).toBe(
          prefix.cut === "P6" ? 0 : prefix.cut === "P0" || prefix.cut === "P1" ? 2 : 1
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
    yield* appendReplacementProvenance(attempt, successor)
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
    yield* appendCandidateProvenance(candidatePredecessor, candidateSuccessor, "issue-69-recovery-full-rerun")
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
        ...cleanupResumeEvidence(records, "Branch"),
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
        ...cleanupResumeEvidence(records, "IntegratorCandidate"),
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
  family: "Branch" | "IntegratorCandidate",
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
      const expectedPrefix = yield* expectedRecoveryPrefix(prefix)
      const canonical = yield* replayRecoveryPrefix(prefix, "memory", resume(prefix.cut))
      if (
        canonical.finalDecodedRecords === undefined ||
        canonical.finalHistoryTag === undefined ||
        canonical.finalProjection === undefined
      ) {
        return yield* Effect.die(`${prefix.cut} canonical recovery lane did not reread final state`)
      }
      const expected = {
        ...expectedPrefix,
        finalDecodedRecords: canonical.finalDecodedRecords,
        finalHistoryTag: canonical.finalHistoryTag,
        finalProjection: canonical.finalProjection
      }
      const actualByLane = {
        memory: yield* replayRecoveryPrefix(prefix, "memory", resume(prefix.cut)),
        sqlite: yield* replayRecoveryPrefix(prefix, "sqlite", resume(prefix.cut))
      }
      expect(
        recoveryPrefixMismatch(prefix.cut, "sqlite", actualByLane.memory, actualByLane.sqlite),
        `${prefix.cut}/memory-vs-sqlite resumed final projection`
      ).toBeUndefined()
      for (const lane of ["memory", "sqlite"] as const) {
        const actual = actualByLane[lane]
        expect(recoveryPrefixMismatch(prefix.cut, lane, expected, actual), `${prefix.cut}/${lane}`).toBeUndefined()
        expect(actual.finalHistoryTag, `${prefix.cut}/${lane} final history reread`).toBeDefined()
        expect(actual.finalDecodedRecords, `${prefix.cut}/${lane} final records`).toBeDefined()
        expect(actual.finalProjection, `${prefix.cut}/${lane} final projection`).toBeDefined()
        const evidence = actual.resumption as CleanupResumeEvidence | undefined
        expect(evidence, `${prefix.cut}/${lane} must resume production cleanup`).toBeDefined()
        if (evidence === undefined) continue
        expect(evidence.finalTag, `${prefix.cut}/${lane} final outcome`).toBe("Settled")
        expect(evidence.familyTags, `${prefix.cut}/${lane} exact ${family} event order`).toEqual(
          expectedFamilyTagsAfterResume(prefix, family)
        )
        expect(evidence.absenceCauses, `${prefix.cut}/${lane} absence cause`).toEqual([
          "MutationResponseReconciliation"
        ])
        expect(evidence.mutationAttempts, `${prefix.cut}/${lane} mutation ordinals`).toEqual([1])
        expect(evidence.observationIntentKeys, `${prefix.cut}/${lane} observation identities`).toHaveLength(
          prefix.cut === "P5" ? 3 : 2
        )
        expect(new Set(evidence.observationIntentKeys).size, `${prefix.cut}/${lane} duplicate observation intent`).toBe(
          evidence.observationIntentKeys.length
        )
        if (prefix.cut === "P4") {
          expect(evidence.observationIntentKeys, `${prefix.cut}/${lane} reuses unmatched observation intent`).toEqual(
            cleanupResumeEvidence(prefix.records, family).observationIntentKeys
          )
        }
        expect(evidence.mutationIntentCount, `${prefix.cut}/${lane} mutation intents`).toBe(1)
        expect(evidence.settlementCount, `${prefix.cut}/${lane} settlements`).toBe(1)
        expect(evidence.observationCalls, `${prefix.cut}/${lane} fresh reads`).toBe(
          prefix.cut === "P6" ? 0 : prefix.cut === "P0" || prefix.cut === "P1" ? 2 : 1
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
      "Branch",
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
      "IntegratorCandidate",
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
          true
        ),
      resumeCandidateCleanupAfter
    )
  })
)
