import { it } from "@effect/vitest"
import { Effect } from "effect"
import { expect } from "vitest"
import {
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
  WorktreeCleanupAuthorization,
  WorktreeCleanupEvidenceRevision,
  WorktreeCleanupMutationResult,
  WorktreeCleanupObservation,
  WorktreeCleanupOwner,
  TaskWorkCapacity,
  TestWorktreeCleanupBoundary,
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
          WorktreeCleanupMutationResult.cases.Unknown.make({ detail: "lost response", locator: attempt.worktree })
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
