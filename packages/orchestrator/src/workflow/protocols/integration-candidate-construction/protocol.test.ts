import { Context, Effect, Layer, Ref } from "effect"
import { it } from "@effect/vitest"
import { expect } from "vitest"
import {
  AcceptedResult,
  AttemptId,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  PlannedAttemptExecutorReport,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import { TargetLineageObservation } from "../../../authorities/git/target-lineage.js"
import { makeIntegrationTargetResourceController } from "../../../coordination/admission/integration-target-resource.js"
import { reduceWorkflowJournalHistory } from "../../../coordination/reconstruction/history.js"
import { runIntegrationCandidateConstruction as runIntegrationCandidateConstructionWithLimit } from "../../../coordination/run/integration-candidate-runtime.js"
import { memoryJournalStoreLayer } from "../../../workflow-journal/adapters/memory-store.js"
import { JournalPosition, JournalRecordKey } from "../../../workflow-journal/identity.js"
import { JournalStore } from "../../../workflow-journal/store.js"
import {
  attemptPlanRecordKey,
  integrationCandidateAgentReportRecordKey,
  integrationCandidateGitObservationRecordKey,
  integrationResponsibilityBeganRecordKey,
  integrationStartedRecordKey,
  intentRecordKey,
  outcomeRecordKey,
  plannedAttemptExecutorWorkReportedRecordKey,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey
} from "../../../workflow-journal/record-key.js"
import { InitialControlPolicy } from "../../../control/policy.js"
import { defaultTaskWorkCapacity } from "../../../coordination/admission/capacity.js"
import { FixtureTarget } from "../../../authorities/task-tracker/fixture/target.js"
import { ClaimOwner, ClaimToken } from "../../../authorities/task-tracker/claim.js"
import {
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent
} from "../../registry/event.js"
import { makeTaskAttemptPlanOperation, makeTaskClaimAcquisitionOperation } from "../../registry/operation.js"
import { OperationId } from "../../identity.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { IntegrationResponsibilityBeganEvent, IntegrationStartedEvent } from "../integration-admission/events.js"
import { StartedIntegrationResponsibility } from "../integration-admission/protocol.js"
import {
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent
} from "../planned-attempt-executor-work/events.js"
import {
  CandidateContinuationLimit,
  IntegrationCandidateAgentReportedEvent,
  IntegrationCandidateAgentReportOrdinal,
  IntegrationCandidateGitObservedEvent
} from "./events.js"
import {
  CandidateCorrectionLimit,
  continueIntegrationCandidateConstruction as continueIntegrationCandidateConstructionWithLimit,
  deriveIntegrationCandidateConstruction,
  IntegrationCandidateAgent,
  IntegrationCandidateAgentReport,
  IntegrationCandidateId,
  IntegrationCandidateResourceLocator,
  IntegrationCandidateGit,
  IntegrationCandidateGitObservation,
  IntegrationCandidateGitReadFailure,
  IntegrationCandidateTargetLineageRejected,
  IntegrationSessionId,
  type IntegrationCandidateAgentRequest
} from "./protocol.js"

const runId = RunId.make("candidate-run")
const target = IntegrationTarget.make({
  repository: GitRepositoryLocator.make("/repositories/candidate.git"),
  ref: IntegrationTargetRef.make("refs/heads/master")
})
const base = GitCommitSha.make("1".repeat(40))
const head = GitCommitSha.make("2".repeat(40))
const acceptedCommit = GitCommitSha.make("3".repeat(40))
const candidate = GitCommitSha.make("4".repeat(40))
const continuationLimit = CandidateContinuationLimit.make(2)
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("candidate-attempt"),
  baseSha: base,
  branch: TaskBranchRef.make("refs/heads/dalph/candidate-attempt"),
  executor: TaskExecutorLocator.make("executor:controlled-fake"),
  runId,
  taskId: TaskId.make("candidate-task"),
  taskRevision: TaskRevision.make("candidate-revision"),
  worktree: WorktreeLocator.make("/worktrees/candidate-attempt")
})
const acceptedResult = AcceptedResult.make({ commit: acceptedCommit })
const started = StartedIntegrationResponsibility.make({
  acceptedResult,
  integrationTarget: target,
  plannedAttempt,
  queuedAt: JournalPosition.make(7),
  startedAt: JournalPosition.make(8)
})
const lineage = TargetLineageObservation.make({
  plannedBaseIsAncestorOfTargetHead: true,
  plannedBaseSha: base,
  targetHeadSha: head
})
const continueIntegrationCandidateConstruction = (
  ...input: Parameters<typeof continueIntegrationCandidateConstructionWithLimit> extends [
    infer Responsibility,
    infer Lineage,
    infer CorrectionLimit,
    unknown
  ]
    ? [Responsibility, Lineage, CorrectionLimit]
    : never
) => continueIntegrationCandidateConstructionWithLimit(...input, continuationLimit)
const runIntegrationCandidateConstruction = (
  ...input: Parameters<typeof runIntegrationCandidateConstructionWithLimit> extends [
    infer Responsibility,
    infer Lineage,
    infer CorrectionLimit,
    unknown,
    infer Resources
  ]
    ? [Responsibility, Lineage, CorrectionLimit, Resources]
    : never
) => runIntegrationCandidateConstructionWithLimit(input[0], input[1], input[2], continuationLimit, input[3])
const placeholderCorrelation = {
  acceptedResultCommit: acceptedCommit,
  attemptId: plannedAttempt.attemptId,
  candidateId: IntegrationCandidateId.make("placeholder-candidate"),
  candidateResource: IntegrationCandidateResourceLocator.make("/candidate-resources/placeholder"),
  expectedTargetHead: head,
  integrationSessionId: IntegrationSessionId.make("placeholder-session"),
  integrationTarget: target,
  runId
}

const seedStartedResponsibility = Effect.gen(function* () {
  const journal = yield* JournalStore
  yield* journal.beginRun(
    runId,
    FixtureTarget.make("candidate-target"),
    InitialControlPolicy.make({ taskExecutionCapacity: defaultTaskWorkCapacity })
  )
  const claimOperationId = OperationId.make("candidate-claim")
  const claim = {
    operationId: claimOperationId,
    owner: ClaimOwner.make("dalph"),
    taskId: plannedAttempt.taskId,
    token: ClaimToken.make("candidate-claim-token")
  }
  yield* journal.append(
    runId,
    intentRecordKey(claimOperationId),
    TaskClaimAcquisitionIntendedEvent.make({
      operation: makeTaskClaimAcquisitionOperation({ acquisition: claim, predecessorOperationIds: [] }),
      version: workflowJournalEventVersion
    })
  )
  yield* journal.append(
    runId,
    outcomeRecordKey(claimOperationId),
    TaskClaimAcquiredEvent.make({ claim: { _tag: "ActiveTaskClaim", ...claim }, version: workflowJournalEventVersion })
  )
  yield* journal.append(
    runId,
    attemptPlanRecordKey(plannedAttempt.attemptId),
    TaskAttemptPlannedEvent.make({
      operation: makeTaskAttemptPlanOperation({
        operationId: OperationId.make("candidate-plan"),
        plannedAttempt,
        predecessorOperationIds: [claimOperationId]
      }),
      version: workflowJournalEventVersion
    })
  )
  yield* journal.append(
    runId,
    plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId),
    PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({ plannedAttempt, version: workflowJournalEventVersion })
  )
  const executorReportOrdinal = PlannedAttemptExecutorReportOrdinal.make(1)
  yield* journal.append(
    runId,
    plannedAttemptExecutorWorkReportedRecordKey(plannedAttempt.attemptId, executorReportOrdinal),
    PlannedAttemptExecutorWorkReportedEvent.make({
      ordinal: executorReportOrdinal,
      report: PlannedAttemptExecutorReport.cases.Terminal.make({
        correlation: { attemptId: plannedAttempt.attemptId, runId },
        result: { _tag: "Accepted", acceptedResult }
      }),
      version: workflowJournalEventVersion
    })
  )
  yield* journal.append(
    runId,
    integrationResponsibilityBeganRecordKey(plannedAttempt.attemptId),
    IntegrationResponsibilityBeganEvent.make({
      acceptedResult,
      integrationTarget: target,
      plannedAttempt,
      version: workflowJournalEventVersion
    })
  )
  yield* journal.append(
    runId,
    integrationStartedRecordKey(plannedAttempt.attemptId),
    IntegrationStartedEvent.make({
      acceptedResult,
      integrationTarget: target,
      plannedAttempt,
      responsibilityBeganAt: JournalPosition.make(7),
      version: workflowJournalEventVersion
    })
  )
})

type GitResult = IntegrationCandidateGitObservation | IntegrationCandidateGitReadFailure

const candidateBoundaryLayer = (
  reports: ReadonlyArray<IntegrationCandidateAgentReport>,
  gitResults: ReadonlyArray<GitResult> = [
    IntegrationCandidateGitObservation.cases.Commit.make({ directParents: [head, acceptedCommit] })
  ],
  normalizeCorrelation = true
) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const pending = yield* Ref.make(reports)
      const pendingGit = yield* Ref.make(gitResults)
      const invocations = yield* Ref.make(0)
      const gitReads = yield* Ref.make(0)
      const requests = yield* Ref.make<ReadonlyArray<IntegrationCandidateAgentRequest>>([])
      return Context.empty().pipe(
        Context.add(
          IntegrationCandidateAgent,
          IntegrationCandidateAgent.of({
            startOrContinue: (request) =>
              Effect.gen(function* () {
                yield* Ref.update(invocations, (count) => count + 1)
                yield* Ref.update(requests, (current) => [...current, request])
                const report = yield* Ref.modify(pending, (current) => [current[0], current.slice(1)] as const)
                if (report === undefined)
                  return IntegrationCandidateAgentReport.cases.Working.make({ correlation: request.correlation })
                if (!normalizeCorrelation) return report
                return report._tag === "Submitted"
                  ? IntegrationCandidateAgentReport.cases.Submitted.make({
                      candidateCommit: report.candidateCommit,
                      correlation: request.correlation
                    })
                  : report._tag === "Conflict"
                    ? IntegrationCandidateAgentReport.cases.Conflict.make({ correlation: request.correlation })
                    : report._tag === "ExitedWithoutCandidate"
                      ? IntegrationCandidateAgentReport.cases.ExitedWithoutCandidate.make({
                          correlation: request.correlation
                        })
                      : IntegrationCandidateAgentReport.cases.Working.make({ correlation: request.correlation })
              })
          })
        ),
        Context.add(
          IntegrationCandidateGit,
          IntegrationCandidateGit.of({
            readSubmittedCommit: () =>
              Effect.gen(function* () {
                yield* Ref.update(gitReads, (count) => count + 1)
                const result = yield* Ref.modify(pendingGit, (current) => [current[0], current.slice(1)] as const)
                if (result === undefined) {
                  return IntegrationCandidateGitObservation.cases.Commit.make({ directParents: [head, acceptedCommit] })
                }
                return result._tag === "IntegrationCandidateGitReadFailure" ? yield* result : result
              })
          })
        ),
        Context.add(CandidateBoundaryInspection, {
          gitReads: Ref.get(gitReads),
          invocations: Ref.get(invocations),
          requests: Ref.get(requests)
        })
      )
    })
  )

class CandidateBoundaryInspection extends Context.Service<
  CandidateBoundaryInspection,
  {
    readonly gitReads: Effect.Effect<number>
    readonly invocations: Effect.Effect<number>
    readonly requests: Effect.Effect<ReadonlyArray<IntegrationCandidateAgentRequest>>
  }
>()("@dalph/IntegrationCandidateConstruction/TestInspection") {}

it.effect("builds one candidate with current target first and accepted result second", () =>
  Effect.gen(function* () {
    yield* seedStartedResponsibility
    const first = yield* continueIntegrationCandidateConstruction(started, lineage, CandidateCorrectionLimit.make(2))
    expect(first._tag).toBe("CandidateConstructed")
    if (first._tag !== "CandidateConstructed") return
    expect(first.candidateCommit).toBe(candidate)
    expect(first.expectedTargetHead).toBe(head)
    expect(first.acceptedResult.commit).toBe(acceptedCommit)

    const records = yield* (yield* JournalStore).read(runId)
    expect(deriveIntegrationCandidateConstruction(records, started)).toMatchObject({
      _tag: "CandidateConstructed",
      candidateCommit: candidate,
      expectedTargetHead: head
    })
  }).pipe(
    Effect.provide(
      candidateBoundaryLayer([
        IntegrationCandidateAgentReport.cases.Submitted.make({
          candidateCommit: candidate,
          correlation: {
            acceptedResultCommit: acceptedCommit,
            attemptId: plannedAttempt.attemptId,
            candidateId: IntegrationCandidateId.make("ignored-by-controlled-boundary"),
            candidateResource: IntegrationCandidateResourceLocator.make("/candidate-resources/ignored"),
            expectedTargetHead: head,
            integrationSessionId: IntegrationSessionId.make("ignored-by-controlled-boundary"),
            integrationTarget: target,
            runId
          }
        })
      ])
    ),
    Effect.provide(memoryJournalStoreLayer)
  )
)

it.effect("requires explicit candidate submission instead of inferring worktree head", () =>
  Effect.gen(function* () {
    yield* seedStartedResponsibility
    const result = yield* continueIntegrationCandidateConstruction(started, lineage, CandidateCorrectionLimit.make(2))
    expect(result._tag).toBe("CandidateConstructionInProgress")
    const inspection = yield* CandidateBoundaryInspection
    expect(yield* inspection.gitReads).toBe(0)
  }).pipe(Effect.provide(candidateBoundaryLayer([])), Effect.provide(memoryJournalStoreLayer))
)

it.effect("keeps the first submitted candidate when later commits appear", () =>
  Effect.gen(function* () {
    yield* seedStartedResponsibility
    const first = yield* continueIntegrationCandidateConstruction(started, lineage, CandidateCorrectionLimit.make(2))
    const second = yield* continueIntegrationCandidateConstruction(started, lineage, CandidateCorrectionLimit.make(2))
    expect(first._tag).toBe("CandidateConstructed")
    expect(second).toEqual(first)
    const inspection = yield* CandidateBoundaryInspection
    expect(yield* inspection.invocations).toBe(1)
    expect(yield* inspection.gitReads).toBe(1)
  }).pipe(
    Effect.provide(
      candidateBoundaryLayer([
        IntegrationCandidateAgentReport.cases.Submitted.make({
          candidateCommit: candidate,
          correlation: {
            acceptedResultCommit: acceptedCommit,
            attemptId: plannedAttempt.attemptId,
            candidateId: IntegrationCandidateId.make("ignored-by-controlled-boundary"),
            candidateResource: IntegrationCandidateResourceLocator.make("/candidate-resources/ignored"),
            expectedTargetHead: head,
            integrationSessionId: IntegrationSessionId.make("ignored-by-controlled-boundary"),
            integrationTarget: target,
            runId
          }
        }),
        IntegrationCandidateAgentReport.cases.Submitted.make({
          candidateCommit: GitCommitSha.make("5".repeat(40)),
          correlation: {
            acceptedResultCommit: acceptedCommit,
            attemptId: plannedAttempt.attemptId,
            candidateId: IntegrationCandidateId.make("ignored-by-controlled-boundary"),
            candidateResource: IntegrationCandidateResourceLocator.make("/candidate-resources/ignored"),
            expectedTargetHead: head,
            integrationSessionId: IntegrationSessionId.make("ignored-by-controlled-boundary"),
            integrationTarget: target,
            runId
          }
        })
      ])
    ),
    Effect.provide(memoryJournalStoreLayer)
  )
)

it.effect("reopens an ambiguously constructed candidate before retrying it", () =>
  Effect.gen(function* () {
    yield* seedStartedResponsibility
    const journal = yield* JournalStore
    const crashingJournal = JournalStore.of({
      ...journal,
      append: (recordRunId, key, event) =>
        event._tag === "IntegrationCandidateConstructed"
          ? Effect.die("process stopped after the Git observation")
          : journal.append(recordRunId, key, event)
    })
    const stopped = yield* continueIntegrationCandidateConstruction(
      started,
      lineage,
      CandidateCorrectionLimit.make(2)
    ).pipe(Effect.provide(Layer.succeed(JournalStore, crashingJournal)), Effect.exit)
    expect(stopped._tag).toBe("Failure")
    expect(deriveIntegrationCandidateConstruction(yield* journal.read(runId), started)?._tag).toBe(
      "CandidateValidationPending"
    )

    const reopened = yield* continueIntegrationCandidateConstruction(started, lineage, CandidateCorrectionLimit.make(2))
    expect(reopened).toMatchObject({ _tag: "CandidateConstructed", candidateCommit: candidate })
    const inspection = yield* CandidateBoundaryInspection
    expect(yield* inspection.invocations).toBe(1)
    expect(yield* inspection.gitReads).toBe(1)
  }).pipe(
    Effect.provide(
      candidateBoundaryLayer([
        IntegrationCandidateAgentReport.cases.Submitted.make({
          candidateCommit: candidate,
          correlation: placeholderCorrelation
        })
      ])
    ),
    Effect.provide(memoryJournalStoreLayer)
  )
)

it.effect(
  "rejects rewritten target lineage before candidate construction and preserves its accepted responsibility",
  () =>
    Effect.gen(function* () {
      yield* seedStartedResponsibility
      const rejected = yield* continueIntegrationCandidateConstruction(
        started,
        TargetLineageObservation.make({
          plannedBaseIsAncestorOfTargetHead: false,
          plannedBaseSha: base,
          targetHeadSha: GitCommitSha.make("9".repeat(40))
        }),
        CandidateCorrectionLimit.make(2)
      ).pipe(Effect.flip)
      expect(rejected).toBeInstanceOf(IntegrationCandidateTargetLineageRejected)
      const inspection = yield* CandidateBoundaryInspection
      expect(yield* inspection.invocations).toBe(0)
      const records = yield* (yield* JournalStore).read(runId)
      expect(records.filter(({ event }) => event._tag.startsWith("IntegrationCandidate"))).toEqual([])
      expect(records.slice(-2).map(({ event }) => event._tag)).toEqual([
        "IntegrationResponsibilityBegan",
        "IntegrationStarted"
      ])
    }).pipe(Effect.provide(candidateBoundaryLayer([])), Effect.provide(memoryJournalStoreLayer))
)

it.effect("keeps conflict edits bound to the same candidate and integration session", () =>
  Effect.gen(function* () {
    yield* seedStartedResponsibility
    const conflict = yield* continueIntegrationCandidateConstruction(started, lineage, CandidateCorrectionLimit.make(2))
    const completed = yield* continueIntegrationCandidateConstruction(
      started,
      TargetLineageObservation.make({
        plannedBaseIsAncestorOfTargetHead: true,
        plannedBaseSha: base,
        targetHeadSha: GitCommitSha.make("8".repeat(40))
      }),
      CandidateCorrectionLimit.make(2)
    )
    expect(conflict._tag).toBe("CandidateConstructionInProgress")
    expect(completed._tag).toBe("CandidateConstructed")
    const requests = yield* (yield* CandidateBoundaryInspection).requests
    expect(requests).toHaveLength(2)
    expect(requests[0]?.correlation).toEqual(requests[1]?.correlation)
    expect(requests[0]?.correlation.expectedTargetHead).toBe(lineage.targetHeadSha)
    expect(requests[0]?.candidateResource).toBe(requests[1]?.candidateResource)
    expect(requests[0]?.candidateResource).not.toBe(plannedAttempt.worktree)
  }).pipe(
    Effect.provide(
      candidateBoundaryLayer([
        IntegrationCandidateAgentReport.cases.Conflict.make({ correlation: placeholderCorrelation }),
        IntegrationCandidateAgentReport.cases.Submitted.make({
          candidateCommit: candidate,
          correlation: placeholderCorrelation
        })
      ])
    ),
    Effect.provide(memoryJournalStoreLayer)
  )
)

it.effect("stops automatic agent continuation at the durable configured limit", () =>
  Effect.gen(function* () {
    yield* seedStartedResponsibility
    const first = yield* continueIntegrationCandidateConstruction(started, lineage, CandidateCorrectionLimit.make(2))
    const second = yield* continueIntegrationCandidateConstruction(started, lineage, CandidateCorrectionLimit.make(2))
    const stopped = yield* continueIntegrationCandidateConstruction(started, lineage, CandidateCorrectionLimit.make(2))

    expect(first._tag).toBe("CandidateConstructionInProgress")
    expect(second._tag).toBe("CandidateConstructionInProgress")
    expect(stopped).toMatchObject({
      _tag: "CandidateContinuationLimitReached",
      continuationCount: 2,
      continuationLimit: 2
    })
    expect(yield* (yield* CandidateBoundaryInspection).invocations).toBe(2)
    const records = yield* (yield* JournalStore).read(runId)
    expect(records.filter(({ event }) => event._tag === "IntegrationCandidateContinuationLimitReached")).toHaveLength(1)
  }).pipe(
    Effect.provide(
      candidateBoundaryLayer([
        IntegrationCandidateAgentReport.cases.Working.make({ correlation: placeholderCorrelation }),
        IntegrationCandidateAgentReport.cases.ExitedWithoutCandidate.make({ correlation: placeholderCorrelation })
      ])
    ),
    Effect.provide(memoryJournalStoreLayer)
  )
)

it.effect("preserves conflicting candidate work across restart", () =>
  Effect.gen(function* () {
    yield* seedStartedResponsibility
    const first = yield* continueIntegrationCandidateConstruction(
      started,
      lineage,
      CandidateCorrectionLimit.make(2)
    ).pipe(
      Effect.provide(
        candidateBoundaryLayer([
          IntegrationCandidateAgentReport.cases.Conflict.make({ correlation: placeholderCorrelation })
        ])
      )
    )
    const second = yield* continueIntegrationCandidateConstruction(
      started,
      lineage,
      CandidateCorrectionLimit.make(2)
    ).pipe(
      Effect.provide(
        candidateBoundaryLayer([
          IntegrationCandidateAgentReport.cases.Submitted.make({
            candidateCommit: candidate,
            correlation: placeholderCorrelation
          })
        ])
      )
    )
    expect(first._tag).toBe("CandidateConstructionInProgress")
    expect(second).toMatchObject({
      _tag: "CandidateConstructed",
      candidateCommit: candidate,
      correlation: first._tag === "CandidateConstructionInProgress" ? first.correlation : undefined
    })
  }).pipe(Effect.provide(memoryJournalStoreLayer))
)

it.effect("ignores agent reports addressed to another candidate responsibility", () =>
  Effect.gen(function* () {
    yield* seedStartedResponsibility
    yield* continueIntegrationCandidateConstruction(started, lineage, CandidateCorrectionLimit.make(2))
    const records = yield* (yield* JournalStore).read(runId)
    const intent = records.find(({ event }) => event._tag === "IntegrationCandidateConstructionIntended")?.event
    if (intent?._tag !== "IntegrationCandidateConstructionIntended") return yield* Effect.die("missing intent")
    const foreign = { ...intent.correlation, candidateId: IntegrationCandidateId.make("foreign-candidate") }
    yield* (yield* JournalStore).append(
      runId,
      JournalRecordKey.make("candidate:foreign-agent-report"),
      IntegrationCandidateAgentReportedEvent.make({
        expectedCorrelation: foreign,
        ordinal: IntegrationCandidateAgentReportOrdinal.make(2),
        report: IntegrationCandidateAgentReport.cases.Working.make({ correlation: foreign }),
        version: workflowJournalEventVersion
      })
    )
    expect(deriveIntegrationCandidateConstruction(yield* (yield* JournalStore).read(runId), started)?._tag).toBe(
      "CandidateConstructionInProgress"
    )
  }).pipe(
    Effect.provide(
      candidateBoundaryLayer([
        IntegrationCandidateAgentReport.cases.Conflict.make({ correlation: placeholderCorrelation })
      ])
    ),
    Effect.provide(memoryJournalStoreLayer)
  )
)

it.effect(
  "returns an invalid parent structure and accepts the first exact corrected submission in the same session",
  () =>
    Effect.gen(function* () {
      yield* seedStartedResponsibility
      const rejected = yield* continueIntegrationCandidateConstruction(
        started,
        lineage,
        CandidateCorrectionLimit.make(2)
      )
      expect(rejected._tag).toBe("CandidateCorrectionRequired")
      const completed = yield* continueIntegrationCandidateConstruction(
        started,
        lineage,
        CandidateCorrectionLimit.make(2)
      )
      expect(completed._tag).toBe("CandidateConstructed")
      const requests = yield* (yield* CandidateBoundaryInspection).requests
      expect(requests[1]?.correction).toContain("ordered direct parents")
      expect(requests[0]?.correlation.integrationSessionId).toBe(requests[1]?.correlation.integrationSessionId)
    }).pipe(
      Effect.provide(
        candidateBoundaryLayer(
          [
            IntegrationCandidateAgentReport.cases.Submitted.make({
              candidateCommit: candidate,
              correlation: placeholderCorrelation
            }),
            IntegrationCandidateAgentReport.cases.Submitted.make({
              candidateCommit: GitCommitSha.make("5".repeat(40)),
              correlation: placeholderCorrelation
            })
          ],
          [
            IntegrationCandidateGitObservation.cases.Commit.make({ directParents: [acceptedCommit, head] }),
            IntegrationCandidateGitObservation.cases.Commit.make({ directParents: [head, acceptedCommit] })
          ]
        )
      ),
      Effect.provide(memoryJournalStoreLayer)
    )
)

it.effect("reconciles a limit-reaching Git observation after a crash before another agent call", () =>
  Effect.gen(function* () {
    yield* seedStartedResponsibility
    const first = yield* continueIntegrationCandidateConstruction(started, lineage, CandidateCorrectionLimit.make(1))
    expect(first).toMatchObject({ _tag: "CandidateCorrectionRequired", correctionCount: 0 })

    const journal = yield* JournalStore
    const records = yield* journal.read(runId)
    const intent = records.find(({ event }) => event._tag === "IntegrationCandidateConstructionIntended")?.event
    if (intent?._tag !== "IntegrationCandidateConstructionIntended") return yield* Effect.die("missing intent")
    const correctedCandidate = GitCommitSha.make("5".repeat(40))
    const correctedOrdinal = IntegrationCandidateAgentReportOrdinal.make(2)
    const submitted = yield* journal.append(
      runId,
      integrationCandidateAgentReportRecordKey(intent.correlation, correctedOrdinal),
      IntegrationCandidateAgentReportedEvent.make({
        expectedCorrelation: intent.correlation,
        ordinal: correctedOrdinal,
        report: IntegrationCandidateAgentReport.cases.Submitted.make({
          candidateCommit: correctedCandidate,
          correlation: intent.correlation
        }),
        version: workflowJournalEventVersion
      })
    )
    yield* journal.append(
      runId,
      integrationCandidateGitObservationRecordKey(intent.correlation, submitted.position),
      IntegrationCandidateGitObservedEvent.make({
        candidateCommit: correctedCandidate,
        correlation: intent.correlation,
        observation: IntegrationCandidateGitObservation.cases.Commit.make({ directParents: [] }),
        submissionAt: submitted.position,
        version: workflowJournalEventVersion
      })
    )
    expect(reduceWorkflowJournalHistory(runId, yield* journal.read(runId))._tag).toBe("ValidWorkflowJournalHistory")

    const recovered = yield* continueIntegrationCandidateConstruction(
      started,
      lineage,
      CandidateCorrectionLimit.make(1)
    )
    expect(recovered).toMatchObject({ _tag: "CandidateCorrectionLimitReached", correctionCount: 1, correctionLimit: 1 })
    const inspection = yield* CandidateBoundaryInspection
    expect(yield* inspection.invocations).toBe(1)
    expect(yield* inspection.gitReads).toBe(1)
  }).pipe(
    Effect.provide(
      candidateBoundaryLayer(
        [
          IntegrationCandidateAgentReport.cases.Submitted.make({
            candidateCommit: candidate,
            correlation: placeholderCorrelation
          })
        ],
        [IntegrationCandidateGitObservation.cases.Commit.make({ directParents: [] })]
      )
    ),
    Effect.provide(memoryJournalStoreLayer)
  )
)

it.effect("returns a missing or non-commit submission to the same integration agent", () =>
  Effect.gen(function* () {
    yield* seedStartedResponsibility
    const missing = yield* continueIntegrationCandidateConstruction(started, lineage, CandidateCorrectionLimit.make(3))
    const nonCommit = yield* continueIntegrationCandidateConstruction(
      started,
      lineage,
      CandidateCorrectionLimit.make(3)
    )
    const completed = yield* continueIntegrationCandidateConstruction(
      started,
      lineage,
      CandidateCorrectionLimit.make(3)
    )
    expect(missing).toMatchObject({ _tag: "CandidateCorrectionRequired", reason: "Missing" })
    expect(nonCommit).toMatchObject({ _tag: "CandidateCorrectionRequired", reason: "NonCommit" })
    expect(completed._tag).toBe("CandidateConstructed")
  }).pipe(
    Effect.provide(
      candidateBoundaryLayer(
        [candidate, GitCommitSha.make("5".repeat(40)), GitCommitSha.make("6".repeat(40))].map((candidateCommit) =>
          IntegrationCandidateAgentReport.cases.Submitted.make({ candidateCommit, correlation: placeholderCorrelation })
        ),
        [
          IntegrationCandidateGitObservation.cases.Missing.make({}),
          IntegrationCandidateGitObservation.cases.NonCommit.make({ objectType: "tree" }),
          IntegrationCandidateGitObservation.cases.Commit.make({ directParents: [head, acceptedCommit] })
        ]
      )
    ),
    Effect.provide(memoryJournalStoreLayer)
  )
)

it.effect("fails closed before Git and preserves involved sessions without automatic resubmission", () =>
  Effect.gen(function* () {
    yield* seedStartedResponsibility
    const contradicted = yield* continueIntegrationCandidateConstruction(
      started,
      lineage,
      CandidateCorrectionLimit.make(2)
    )
    expect(contradicted._tag).toBe("CandidateCorrelationContradiction")
    const repeated = yield* continueIntegrationCandidateConstruction(started, lineage, CandidateCorrectionLimit.make(2))
    expect(repeated).toEqual(contradicted)
    const inspection = yield* CandidateBoundaryInspection
    expect(yield* inspection.gitReads).toBe(0)
    expect(yield* inspection.invocations).toBe(1)
  }).pipe(
    Effect.provide(
      candidateBoundaryLayer(
        [
          IntegrationCandidateAgentReport.cases.Submitted.make({
            candidateCommit: candidate,
            correlation: {
              ...placeholderCorrelation,
              candidateResource: IntegrationCandidateResourceLocator.make("/candidate-resources/foreign")
            }
          })
        ],
        undefined,
        false
      )
    ),
    Effect.provide(memoryJournalStoreLayer)
  )
)

it.effect(
  "keeps and rereads the same submitted candidate without charging an agent correction round when Git is unreadable",
  () =>
    Effect.gen(function* () {
      yield* seedStartedResponsibility
      const pending = yield* continueIntegrationCandidateConstruction(
        started,
        lineage,
        CandidateCorrectionLimit.make(2)
      )
      expect(pending).toMatchObject({ _tag: "CandidateValidationPending", candidateCommit: candidate })
      const completed = yield* continueIntegrationCandidateConstruction(
        started,
        lineage,
        CandidateCorrectionLimit.make(2)
      )
      expect(completed._tag).toBe("CandidateConstructed")
      const inspection = yield* CandidateBoundaryInspection
      expect(yield* inspection.invocations).toBe(1)
      expect(yield* inspection.gitReads).toBe(2)
    }).pipe(
      Effect.provide(
        candidateBoundaryLayer(
          [
            IntegrationCandidateAgentReport.cases.Submitted.make({
              candidateCommit: candidate,
              correlation: placeholderCorrelation
            })
          ],
          [
            new IntegrationCandidateGitReadFailure({
              candidateCommit: candidate,
              detail: "cat-file timed out",
              repository: target.repository
            }),
            IntegrationCandidateGitObservation.cases.Commit.make({ directParents: [head, acceptedCommit] })
          ]
        )
      ),
      Effect.provide(memoryJournalStoreLayer)
    )
)

it.effect("resolves a later readable invalid Git result through same-session correction", () =>
  Effect.gen(function* () {
    yield* seedStartedResponsibility
    const pending = yield* continueIntegrationCandidateConstruction(started, lineage, CandidateCorrectionLimit.make(2))
    const invalid = yield* continueIntegrationCandidateConstruction(started, lineage, CandidateCorrectionLimit.make(2))
    expect(pending._tag).toBe("CandidateValidationPending")
    expect(invalid).toMatchObject({ _tag: "CandidateCorrectionRequired", reason: "WrongParents" })
    const inspection = yield* CandidateBoundaryInspection
    expect(yield* inspection.invocations).toBe(1)
    expect(yield* inspection.gitReads).toBe(2)
  }).pipe(
    Effect.provide(
      candidateBoundaryLayer(
        [
          IntegrationCandidateAgentReport.cases.Submitted.make({
            candidateCommit: candidate,
            correlation: placeholderCorrelation
          })
        ],
        [
          new IntegrationCandidateGitReadFailure({
            candidateCommit: candidate,
            detail: "repository temporarily unreadable",
            repository: target.repository
          }),
          IntegrationCandidateGitObservation.cases.Commit.make({ directParents: [acceptedCommit, head] })
        ]
      )
    ),
    Effect.provide(memoryJournalStoreLayer)
  )
)

it.effect("preserves non-convergent work and leaves the task incomplete after correction exhaustion", () =>
  Effect.gen(function* () {
    yield* seedStartedResponsibility
    const first = yield* continueIntegrationCandidateConstruction(started, lineage, CandidateCorrectionLimit.make(1))
    const exhausted = yield* continueIntegrationCandidateConstruction(
      started,
      lineage,
      CandidateCorrectionLimit.make(1)
    )
    expect(first._tag).toBe("CandidateCorrectionRequired")
    expect(exhausted).toMatchObject({ _tag: "CandidateCorrectionLimitReached", correctionCount: 1 })
    const repeated = yield* continueIntegrationCandidateConstruction(started, lineage, CandidateCorrectionLimit.make(1))
    expect(repeated).toEqual(exhausted)
    expect(yield* (yield* CandidateBoundaryInspection).invocations).toBe(2)
  }).pipe(
    Effect.provide(
      candidateBoundaryLayer(
        [candidate, GitCommitSha.make("5".repeat(40))].map((candidateCommit) =>
          IntegrationCandidateAgentReport.cases.Submitted.make({ candidateCommit, correlation: placeholderCorrelation })
        ),
        [
          IntegrationCandidateGitObservation.cases.Missing.make({}),
          IntegrationCandidateGitObservation.cases.Commit.make({ directParents: [head] })
        ]
      )
    ),
    Effect.provide(memoryJournalStoreLayer)
  )
)

it.effect("releases the integration target after non-convergence so unrelated work may continue", () =>
  Effect.gen(function* () {
    yield* seedStartedResponsibility
    const resources = yield* makeIntegrationTargetResourceController()
    yield* resources.acquire(started)
    yield* runIntegrationCandidateConstruction(started, lineage, CandidateCorrectionLimit.make(1), resources)
    const exhausted = yield* runIntegrationCandidateConstruction(
      started,
      lineage,
      CandidateCorrectionLimit.make(1),
      resources
    )
    expect(exhausted).toMatchObject({ _tag: "CandidateCorrectionLimitReached", correctionCount: 1 })
    expect((yield* resources.snapshot).heldResponsibilityPositions).toEqual(new Set())
    expect(exhausted._tag === "CandidateCorrectionLimitReached" && exhausted.correlation.acceptedResultCommit).toBe(
      acceptedCommit
    )
  }).pipe(
    Effect.provide(
      candidateBoundaryLayer(
        [candidate, GitCommitSha.make("5".repeat(40))].map((candidateCommit) =>
          IntegrationCandidateAgentReport.cases.Submitted.make({ candidateCommit, correlation: placeholderCorrelation })
        ),
        [
          IntegrationCandidateGitObservation.cases.Missing.make({}),
          IntegrationCandidateGitObservation.cases.Commit.make({ directParents: [head] })
        ]
      )
    ),
    Effect.provide(memoryJournalStoreLayer)
  )
)
