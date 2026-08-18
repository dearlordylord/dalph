import { it } from "@effect/vitest"
import {
  acceptedResultEvidenceLayer,
  acceptedResultFixture,
  evidenceReferenceFixture,
  registerAcceptedResultEvidence
} from "../../../../test/support/evidence.js"
import { Effect, Layer, Option } from "effect"
import { expect } from "vitest"
import {
  AcceptedResult,
  AttemptId,
  EvidenceReference,
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
  WorktreeLocator,
  makeTaskWorkSpecification
} from "@dalph/contracts"
import { InitialControlPolicy } from "../../../control/policy.js"
import { defaultTaskWorkCapacity } from "../../../coordination/admission/capacity.js"
import { FixtureTarget } from "../../../authorities/task-tracker/fixture/target.js"
import { JournalPosition, JournalRecordKey } from "../../../workflow-journal/identity.js"
import { JournalRecord, JournalStore } from "../../../workflow-journal/store.js"
import { legacyMemoryJournalStoreLayer } from "../../../workflow-journal/adapters/memory-store.js"
import {
  AcceptedResultNotDurable,
  AcceptedResultSuppressedByRestart,
  deriveIntegrationAdmission,
  deriveUnqueuedAcceptedResults,
  integrationTargetSelectionLayer,
  IntegrationTargetSelection,
  queueAcceptedResultIntegrationResponsibility,
  selectStartableIntegrationResponsibilities,
  startQueuedIntegration,
  type StartedIntegrationResponsibility
} from "./protocol.js"

import {
  PlannedAttemptExecutorCommandIntendedEvent,
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent
} from "../planned-attempt-executor-work/events.js"
import {
  integrationResponsibilityBeganRecordKey,
  integrationStartedRecordKey,
  attemptPlanRecordKey,
  intentRecordKey,
  outcomeRecordKey,
  plannedAttemptExecutorCommandIntendedRecordKey,
  plannedAttemptExecutorWorkReportedRecordKey,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey,
  attemptChoiceAppliedRecordKey
} from "../../../workflow-journal/record-key.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import {
  TaskAttemptPlannedEvent,
  GitReadIntentRecordedEvent,
  TargetLineageObservedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  taskTrackerReadIntent
} from "../../registry/event.js"
import { AttemptChoiceAppliedEvent, AttemptChoiceRequestId } from "../attempt-choice/events.js"
import {
  makeTaskAttemptPlanOperation,
  makeTaskClaimAcquisitionOperation,
  makeTaskClaimObservationOperation,
  makeTaskWorkSpecificationObservationOperation,
  makeTargetLineageObservationOperation,
  makeTrackerGraphObservationOperation
} from "../../registry/operation.js"
import { IntegrationResponsibilityBeganEvent, IntegrationStartedEvent } from "./events.js"
import { reduceWorkflowJournalHistory } from "../../../coordination/reconstruction/history.js"
import { deriveIntegrationFrontier } from "../../../coordination/frontier/integration-frontier.js"
import { reconstructRunState } from "../../../coordination/reconstruction/reduce.js"
import { makeIntegrationTargetResourceController } from "../../../coordination/admission/integration-target-resource.js"
import { runnableTransitionTaskId, RunnableFrontierTransition } from "../../../coordination/frontier/frontier.js"
import { OperationId } from "../../identity.js"
import { makeRunRecoveryProjection } from "../../../coordination/run/recovery-activation.js"
import { controlledFakePlannedAttemptExecutorLayer } from "../../../../test/controlled-planned-attempt-executor.js"
import { WorkflowInterpreter, WorkflowTrace } from "../../../workflow/interpretation/interpreter.js"
import { taskTrackerGraphFactsObserved } from "../../../../test/task-tracker-facts.js"
import { TaskLifecycle, TrackerRevision } from "../../../authorities/task-tracker/task.js"
import { ClaimOwner, ClaimToken } from "../../../authorities/task-tracker/claim.js"
import { ActiveTaskClaim } from "../../../authorities/task-tracker/claim-mutation.js"
import { TargetLineageObservation } from "../../../authorities/git/target-lineage.js"
import {
  CandidateContinuationLimit,
  CandidateCorrectionLimit,
  IntegrationCandidateAgentReport,
  IntegrationCandidateAgentReportedEvent,
  IntegrationCandidateAgentReportOrdinal,
  IntegrationCandidateConstructedEvent,
  IntegrationCandidateConstructionIntendedEvent,
  IntegrationCandidateContinuationLimitReachedEvent,
  IntegrationCandidateCorrelation,
  IntegrationCandidateGitObservation,
  IntegrationCandidateGitObservedEvent,
  IntegrationCandidateId,
  IntegrationCandidateResourceLocator,
  IntegrationSessionId
} from "../integration-candidate-construction/events.js"
import {
  TargetVerificationEvidenceSealedEvent,
  TargetVerificationIntendedEvent,
  TargetVerificationPlan,
  TargetVerificationPlanId,
  targetVerificationCorrelationFor
} from "../target-verification/events.js"
import {
  TargetPromotionIntendedEvent,
  TargetPromotionNonConvergenceEvent,
  TargetPromotionStaleEvent,
  TargetPromotionObservedSuccessEvent,
  TargetPromotionAttemptOrdinal,
  TargetPromotionAttemptLimit,
  TargetPromotionNonConvergenceObservation,
  TargetPromotionStaleObservation,
  TargetPromotionSuccessObservation,
  targetPromotionRequestFor
} from "../target-promotion/events.js"

import {
  makeCompleteTaskTrackerFactsObserved,
  makeFocusedTaskClaimFactsObserved,
  makeFocusedTaskWorkSpecificationFactsObserved,
  taskTrackerFactsObservedEvent
} from "../../task-tracker-facts/observation.js"
import { projectTrackerSnapshot } from "../../../authorities/task-tracker/graph.js"

const exactClaimAuthorities = (...attemptIds: ReadonlyArray<AttemptId>) =>
  new Map(attemptIds.map((attemptId) => [attemptId, { _tag: "Exact" as const }]))

const runId = RunId.make("integration-admission-run")
const integrationTarget = IntegrationTarget.make({
  repository: GitRepositoryLocator.make("/repo/.git"),
  ref: IntegrationTargetRef.make("refs/heads/master")
})
const otherIntegrationTarget = IntegrationTarget.make({
  repository: GitRepositoryLocator.make("/other-repo/.git"),
  ref: IntegrationTargetRef.make("refs/heads/master")
})

it.effect("provides the exact configured integration target to the settlement runtime", () =>
  Effect.gen(function* () {
    expect(yield* IntegrationTargetSelection).toEqual(integrationTarget)
  }).pipe(Effect.provide(integrationTargetSelectionLayer(integrationTarget)))
)

const plannedAttempt = (taskId: "A" | "B" | "C", ordinal: number) =>
  PlannedTaskAttempt.make({
    attemptId: AttemptId.make(`attempt:${taskId}:${ordinal}`),
    baseSha: GitCommitSha.make("1".repeat(40)),
    branch: TaskBranchRef.make(`refs/heads/dalph/attempt-${taskId}`),
    executor: TaskExecutorLocator.make("executor:controlled-fake"),
    runId,
    taskId: TaskId.make(taskId),
    taskRevision: TaskRevision.make(`revision-${taskId}`),
    worktree: WorktreeLocator.make(`/worktrees/${taskId}`)
  })

const acceptedResult = (commitDigit: string) => acceptedResultFixture(GitCommitSha.make(commitDigit.repeat(40)))
const substituteEvidenceByteLength = (result: AcceptedResult): AcceptedResult =>
  AcceptedResult.make({
    ...result,
    evidenceManifest: EvidenceReference.make({
      byteLength: result.evidenceManifest.byteLength + 1,
      digest: result.evidenceManifest.digest
    })
  })

it("does not offer an accepted report whose exact attempt responsibility is absent", () => {
  const attempt = plannedAttempt("A", 0)
  const ordinal = PlannedAttemptExecutorReportOrdinal.make(1)
  const orphanReport = JournalRecord.make({
    event: PlannedAttemptExecutorWorkReportedEvent.make({
      ordinal,
      report: PlannedAttemptExecutorReport.cases.Terminal.make({
        correlation: { attemptId: attempt.attemptId, runId: attempt.runId },
        result: { _tag: "Accepted", acceptedResult: acceptedResult("a") }
      }),
      version: workflowJournalEventVersion
    }),
    key: JournalRecordKey.make("orphan-accepted-report"),
    position: JournalPosition.make(1),
    runId
  })

  expect(deriveUnqueuedAcceptedResults([orphanReport])).toEqual([])
})

const claimFor = (attempt: PlannedTaskAttempt) =>
  ActiveTaskClaim.make({
    operationId: OperationId.make(`claim:${attempt.attemptId}`),
    owner: ClaimOwner.make("integration-test-owner"),
    taskId: attempt.taskId,
    token: ClaimToken.make(`claim-token:${attempt.attemptId}`)
  })

const beginRun = Effect.gen(function* () {
  const journal = yield* JournalStore
  yield* journal.beginRun(
    runId,
    FixtureTarget.make("integration-admission-target"),
    InitialControlPolicy.make({ taskExecutionCapacity: defaultTaskWorkCapacity })
  )
})

const recordAcceptedTerminal = (
  attempt: PlannedTaskAttempt,
  result: AcceptedResult,
  beforeTerminal: Effect.Effect<void> = Effect.void
) =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    const claim = claimFor(attempt)
    yield* journal.append(
      runId,
      intentRecordKey(claim.operationId),
      TaskClaimAcquisitionIntendedEvent.make({
        operation: makeTaskClaimAcquisitionOperation({ acquisition: claim, predecessorOperationIds: [] }),
        version: workflowJournalEventVersion
      })
    )
    yield* journal.append(
      runId,
      outcomeRecordKey(claim.operationId),
      TaskClaimAcquiredEvent.make({ claim, version: workflowJournalEventVersion })
    )
    yield* journal.append(
      runId,
      attemptPlanRecordKey(attempt.attemptId),
      TaskAttemptPlannedEvent.make({
        operation: makeTaskAttemptPlanOperation({
          operationId: OperationId.make(`plan:${attempt.attemptId}`),
          plannedAttempt: attempt,
          predecessorOperationIds: [claim.operationId]
        }),
        version: workflowJournalEventVersion
      })
    )
    yield* journal.append(
      runId,
      plannedAttemptExecutorWorkResponsibilityBeganRecordKey(attempt.attemptId),
      PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
        plannedAttempt: attempt,
        version: workflowJournalEventVersion
      })
    )
    const commandOrdinal = PlannedAttemptExecutorCommandOrdinal.make(1)
    yield* journal.append(
      runId,
      plannedAttemptExecutorCommandIntendedRecordKey(attempt.attemptId, commandOrdinal),
      PlannedAttemptExecutorCommandIntendedEvent.make({
        command: "StartOrContinue",
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        ordinal: commandOrdinal,
        plannedAttempt: attempt,
        version: workflowJournalEventVersion
      })
    )
    yield* beforeTerminal
    yield* registerAcceptedResultEvidence(attempt, result)
    const ordinal = PlannedAttemptExecutorReportOrdinal.make(1)
    yield* journal.append(
      runId,
      plannedAttemptExecutorWorkReportedRecordKey(attempt.attemptId, ordinal),
      PlannedAttemptExecutorWorkReportedEvent.make({
        ordinal,
        report: PlannedAttemptExecutorReport.cases.Terminal.make({
          correlation: { attemptId: attempt.attemptId, runId: attempt.runId },
          result: { _tag: "Accepted", acceptedResult: result }
        }),
        version: workflowJournalEventVersion
      })
    )
  })

const frontierRecord = (runId: RunId, position: number, event: JournalRecord["event"]): JournalRecord =>
  JournalRecord.make({
    event,
    key: JournalRecordKey.make(`frontier-candidate:${position}`),
    position: JournalPosition.make(position),
    runId
  })

const candidateFrontierRecordsFor = (
  records: ReadonlyArray<JournalRecord>,
  responsibility: StartedIntegrationResponsibility,
  suffix: string,
  targetHeadSha: GitCommitSha = GitCommitSha.make("f".repeat(40))
) => {
  const nextPosition = Math.max(0, ...records.map(({ position }) => Number(position))) + 1
  const candidateCommit = GitCommitSha.make("c".repeat(40))
  const correlation = IntegrationCandidateCorrelation.make({
    acceptanceManifest: responsibility.acceptedResult.evidenceManifest,
    acceptedResultCommit: responsibility.acceptedResult.commit,
    attemptId: responsibility.plannedAttempt.attemptId,
    candidateId: IntegrationCandidateId.make(`frontier-candidate:${suffix}`),
    candidateResource: IntegrationCandidateResourceLocator.make(`frontier-resource:${suffix}`),
    expectedTargetHead: targetHeadSha,
    integrationSessionId: IntegrationSessionId.make(`frontier-session:${suffix}`),
    integrationTarget: responsibility.integrationTarget,
    runId: responsibility.plannedAttempt.runId
  })
  const intent = frontierRecord(
    responsibility.plannedAttempt.runId,
    nextPosition,
    IntegrationCandidateConstructionIntendedEvent.make({
      continuationLimit: CandidateContinuationLimit.make(2),
      correctionLimit: CandidateCorrectionLimit.make(2),
      correlation,
      plannedAttempt: responsibility.plannedAttempt,
      responsibilityBeganAt: responsibility.queuedAt,
      startedAt: responsibility.startedAt,
      version: workflowJournalEventVersion
    })
  )
  const report = frontierRecord(
    responsibility.plannedAttempt.runId,
    nextPosition + 1,
    IntegrationCandidateAgentReportedEvent.make({
      expectedCorrelation: correlation,
      ordinal: IntegrationCandidateAgentReportOrdinal.make(1),
      report: IntegrationCandidateAgentReport.cases.Submitted.make({
        candidateCommit,
        correlation,
        reviewManifest: evidenceReferenceFixture
      }),
      version: workflowJournalEventVersion
    })
  )
  const git = frontierRecord(
    responsibility.plannedAttempt.runId,
    nextPosition + 2,
    IntegrationCandidateGitObservedEvent.make({
      candidateCommit,
      correlation,
      observation: IntegrationCandidateGitObservation.cases.Commit.make({
        directParents: [targetHeadSha, responsibility.acceptedResult.commit]
      }),
      submissionAt: report.position,
      version: workflowJournalEventVersion
    })
  )
  const constructed = frontierRecord(
    responsibility.plannedAttempt.runId,
    nextPosition + 3,
    IntegrationCandidateConstructedEvent.make({
      candidateCommit,
      correlation,
      gitObservationAt: git.position,
      reviewManifest: evidenceReferenceFixture,
      version: workflowJournalEventVersion
    })
  )
  return {
    candidate: {
      candidateCommit,
      constructedAt: constructed.position,
      correlation,
      reviewManifest: evidenceReferenceFixture
    },
    records: [...records, intent, report, git, constructed]
  }
}

const targetVerificationRecordsFor = (
  records: ReadonlyArray<JournalRecord>,
  candidate: ReturnType<typeof candidateFrontierRecordsFor>["candidate"],
  terminal: "Passed" | "Failed" = "Passed"
) => {
  const nextPosition = Math.max(0, ...records.map(({ position }) => Number(position))) + 1
  const planId = TargetVerificationPlanId.make(`frontier-plan:${candidate.correlation.candidateId}`)
  const correlation = targetVerificationCorrelationFor(candidate, planId)
  const intent = frontierRecord(
    candidate.correlation.runId,
    nextPosition,
    TargetVerificationIntendedEvent.make({ correlation, version: workflowJournalEventVersion })
  )
  const sealed = frontierRecord(
    candidate.correlation.runId,
    nextPosition + 1,
    TargetVerificationEvidenceSealedEvent.make({
      correlation,
      manifest: evidenceReferenceFixture,
      terminal,
      version: workflowJournalEventVersion
    })
  )
  return { correlation, records: [...records, intent, sealed] }
}

const protocolTestLayer = Layer.merge(acceptedResultEvidenceLayer, legacyMemoryJournalStoreLayer)

it.effect("preserves a late Accepted report after Restart without offering or recording P1 integration", () =>
  Effect.gen(function* () {
    const attempt = plannedAttempt("A", 0)
    const result = acceptedResult("a")
    const requestId = AttemptChoiceRequestId.make({ nonce: "late-accepted-restart", runId })
    yield* beginRun
    const journal = yield* JournalStore
    yield* recordAcceptedTerminal(
      attempt,
      result,
      journal
        .append(
          runId,
          attemptChoiceAppliedRecordKey(requestId),
          AttemptChoiceAppliedEvent.make({
            choice: "RestartTaskImplementation",
            initiatedBy: { _tag: "Operator" },
            occurrenceClassification: "InitiatedAction",
            requestId,
            subject: { observedTaskRevision: TaskRevision.make("revision-A-F2"), plannedAttempt: attempt },
            version: workflowJournalEventVersion
          })
        )
        .pipe(Effect.asVoid, Effect.orDie)
    )

    const records = yield* journal.read(runId)
    expect(deriveUnqueuedAcceptedResults(records)).toEqual([])
    const failure = yield* Effect.flip(queueAcceptedResultIntegrationResponsibility(attempt, result, integrationTarget))
    expect(failure).toEqual(
      new AcceptedResultSuppressedByRestart({ attemptId: attempt.attemptId, runId: attempt.runId })
    )
    expect((yield* journal.read(runId)).some(({ event }) => event._tag === "IntegrationResponsibilityBegan")).toBe(
      false
    )
  }).pipe(Effect.provide(protocolTestLayer))
)

it.effect("retains the first Restart cutoff when a later malformed choice is also present", () =>
  Effect.gen(function* () {
    const attempt = plannedAttempt("A", 0)
    const result = acceptedResult("a")
    const firstRequest = AttemptChoiceRequestId.make({ nonce: "first-restart", runId })
    yield* beginRun
    const journal = yield* JournalStore
    yield* recordAcceptedTerminal(
      attempt,
      result,
      journal
        .append(
          runId,
          attemptChoiceAppliedRecordKey(firstRequest),
          AttemptChoiceAppliedEvent.make({
            choice: "RestartTaskImplementation",
            initiatedBy: { _tag: "Operator" },
            occurrenceClassification: "InitiatedAction",
            requestId: firstRequest,
            subject: { observedTaskRevision: TaskRevision.make("revision-A-F2"), plannedAttempt: attempt },
            version: workflowJournalEventVersion
          })
        )
        .pipe(Effect.asVoid, Effect.orDie)
    )
    const laterRequest = AttemptChoiceRequestId.make({ nonce: "later-malformed-restart", runId })
    yield* journal.append(
      runId,
      attemptChoiceAppliedRecordKey(laterRequest),
      AttemptChoiceAppliedEvent.make({
        choice: "RestartTaskImplementation",
        initiatedBy: { _tag: "Operator" },
        occurrenceClassification: "InitiatedAction",
        requestId: laterRequest,
        subject: { observedTaskRevision: TaskRevision.make("revision-A-F3"), plannedAttempt: attempt },
        version: workflowJournalEventVersion
      })
    )
    yield* journal.append(
      runId,
      integrationResponsibilityBeganRecordKey(attempt.attemptId),
      IntegrationResponsibilityBeganEvent.make({
        acceptedResult: result,
        integrationTarget,
        plannedAttempt: attempt,
        version: workflowJournalEventVersion
      })
    )

    const reduction = reduceWorkflowJournalHistory(runId, yield* journal.read(runId))

    expect(reduction._tag).toBe("InvalidWorkflowJournalHistory")
    if (reduction._tag !== "InvalidWorkflowJournalHistory") return
    expect(reduction.issues).toContainEqual(
      expect.objectContaining({
        detail: `integration responsibility for attempt ${attempt.attemptId} follows an Accepted result suppressed by prior Restart`
      })
    )
  }).pipe(Effect.provide(protocolTestLayer))
)

it.effect("rejects a responsibility before the matching accepted terminal report is durable", () =>
  Effect.gen(function* () {
    const attempt = plannedAttempt("A", 0)
    yield* beginRun

    const failure = yield* Effect.flip(
      queueAcceptedResultIntegrationResponsibility(attempt, acceptedResult("a"), integrationTarget)
    )

    expect(failure).toEqual(new AcceptedResultNotDurable({ attemptId: attempt.attemptId, runId: attempt.runId }))
  }).pipe(Effect.provide(protocolTestLayer))
)

it.effect("rejects a responsibility whose planned attempt differs from the durable executor responsibility", () =>
  Effect.gen(function* () {
    const durableAttempt = plannedAttempt("A", 0)
    const result = acceptedResult("a")
    yield* beginRun
    yield* recordAcceptedTerminal(durableAttempt, result)
    const contradictoryAttempt = PlannedTaskAttempt.make({
      ...durableAttempt,
      baseSha: GitCommitSha.make("2".repeat(40))
    })

    const failure = yield* Effect.flip(
      queueAcceptedResultIntegrationResponsibility(contradictoryAttempt, result, integrationTarget)
    )

    expect(failure).toEqual(
      new AcceptedResultNotDurable({ attemptId: contradictoryAttempt.attemptId, runId: contradictoryAttempt.runId })
    )
    expect(
      (yield* JournalStore.pipe(Effect.flatMap((journal) => journal.read(runId)))).some(
        ({ event }) => event._tag === "IntegrationResponsibilityBegan"
      )
    ).toBe(false)
  }).pipe(Effect.provide(protocolTestLayer))
)

it.effect("rejects an accepted-result evidence substitution before queue and at the integration cutoff", () =>
  Effect.gen(function* () {
    const attempt = plannedAttempt("A", 0)
    const durableResult = acceptedResult("a")
    const substitutedResult = substituteEvidenceByteLength(durableResult)
    yield* beginRun
    yield* recordAcceptedTerminal(attempt, durableResult)

    const failure = yield* Effect.flip(
      queueAcceptedResultIntegrationResponsibility(attempt, substitutedResult, integrationTarget)
    )
    expect(failure).toEqual(new AcceptedResultNotDurable({ attemptId: attempt.attemptId, runId: attempt.runId }))

    const queued = yield* queueAcceptedResultIntegrationResponsibility(attempt, durableResult, integrationTarget)
    const journal = yield* JournalStore
    yield* journal.append(
      runId,
      integrationStartedRecordKey(attempt.attemptId),
      IntegrationStartedEvent.make({
        acceptedResult: substitutedResult,
        integrationTarget,
        plannedAttempt: attempt,
        responsibilityBeganAt: queued.queuedAt,
        version: workflowJournalEventVersion
      })
    )

    const reduction = reduceWorkflowJournalHistory(runId, yield* journal.read(runId))
    expect(reduction._tag).toBe("InvalidWorkflowJournalHistory")
    if (reduction._tag !== "InvalidWorkflowJournalHistory") return
    expect(reduction.issues).toContainEqual(
      expect.objectContaining({
        detail: `integration start for attempt ${attempt.attemptId} has no exact earlier responsibility at ${queued.queuedAt}`
      })
    )
  }).pipe(Effect.provide(protocolTestLayer))
)

it.effect("rejects persisted integration responsibility without a prior accepted terminal result", () =>
  Effect.gen(function* () {
    const attempt = plannedAttempt("A", 0)
    yield* beginRun
    const journal = yield* JournalStore
    yield* journal.append(
      runId,
      integrationResponsibilityBeganRecordKey(attempt.attemptId),
      IntegrationResponsibilityBeganEvent.make({
        acceptedResult: acceptedResult("a"),
        integrationTarget,
        plannedAttempt: attempt,
        version: workflowJournalEventVersion
      })
    )

    const reduction = reduceWorkflowJournalHistory(runId, yield* journal.read(runId))

    expect(reduction._tag).toBe("InvalidWorkflowJournalHistory")
    if (reduction._tag !== "InvalidWorkflowJournalHistory") return
    expect(reduction.issues).toContainEqual(
      expect.objectContaining({
        detail: `integration responsibility for attempt ${attempt.attemptId} has no prior matching accepted terminal result`
      })
    )
  }).pipe(Effect.provide(protocolTestLayer))
)

it.effect("rejects persisted integration responsibility with substituted accepted evidence", () =>
  Effect.gen(function* () {
    const attempt = plannedAttempt("A", 0)
    const durableResult = acceptedResult("a")
    yield* beginRun
    yield* recordAcceptedTerminal(attempt, durableResult)
    const journal = yield* JournalStore
    yield* journal.append(
      runId,
      integrationResponsibilityBeganRecordKey(attempt.attemptId),
      IntegrationResponsibilityBeganEvent.make({
        acceptedResult: substituteEvidenceByteLength(durableResult),
        integrationTarget,
        plannedAttempt: attempt,
        version: workflowJournalEventVersion
      })
    )

    const reduction = reduceWorkflowJournalHistory(runId, yield* journal.read(runId))

    expect(reduction._tag).toBe("InvalidWorkflowJournalHistory")
    if (reduction._tag !== "InvalidWorkflowJournalHistory") return
    expect(reduction.issues).toContainEqual(
      expect.objectContaining({
        detail: `integration responsibility for attempt ${attempt.attemptId} has no prior matching accepted terminal result`
      })
    )
  }).pipe(Effect.provide(protocolTestLayer))
)

it.effect("rejects a foreign-run responsibility and a start that points at itself", () =>
  Effect.gen(function* () {
    const attempt = plannedAttempt("A", 0)
    const foreignAttempt = PlannedTaskAttempt.make({ ...attempt, runId: RunId.make("foreign-run") })
    yield* beginRun
    const journal = yield* JournalStore
    yield* journal.append(
      runId,
      integrationResponsibilityBeganRecordKey(foreignAttempt.attemptId),
      IntegrationResponsibilityBeganEvent.make({
        acceptedResult: acceptedResult("a"),
        integrationTarget,
        plannedAttempt: foreignAttempt,
        version: workflowJournalEventVersion
      })
    )
    yield* journal.append(
      runId,
      integrationStartedRecordKey(attempt.attemptId),
      IntegrationStartedEvent.make({
        acceptedResult: acceptedResult("a"),
        integrationTarget,
        plannedAttempt: attempt,
        responsibilityBeganAt: JournalPosition.make(3),
        version: workflowJournalEventVersion
      })
    )

    const reduction = reduceWorkflowJournalHistory(runId, yield* journal.read(runId))

    expect(reduction._tag).toBe("InvalidWorkflowJournalHistory")
    if (reduction._tag !== "InvalidWorkflowJournalHistory") return
    expect(reduction.issues.flatMap((issue) => ("detail" in issue ? [issue.detail] : []))).toEqual(
      expect.arrayContaining([
        `integration work for attempt ${foreignAttempt.attemptId} binds run ${foreignAttempt.runId}`,
        `integration start for attempt ${attempt.attemptId} has no exact earlier responsibility at 3`
      ])
    )
  }).pipe(Effect.provide(protocolTestLayer))
)

it.effect("orders accepted results by committed responsibility position after restart", () =>
  Effect.gen(function* () {
    const a = plannedAttempt("A", 0)
    const b = plannedAttempt("B", 1)
    const aResult = acceptedResult("a")
    const bResult = acceptedResult("b")
    yield* beginRun
    yield* recordAcceptedTerminal(a, aResult)
    yield* recordAcceptedTerminal(b, bResult)

    yield* queueAcceptedResultIntegrationResponsibility(a, aResult, integrationTarget)
    yield* queueAcceptedResultIntegrationResponsibility(b, bResult, integrationTarget)

    const records = yield* JournalStore.pipe(Effect.flatMap((journal) => journal.read(runId)))
    const recovered = deriveIntegrationAdmission(records)

    expect(recovered.responsibilities.map(({ acceptedResult: result }) => result.commit)).toEqual([
      aResult.commit,
      bResult.commit
    ])
    expect(recovered.responsibilities.map(({ queuedAt }) => queuedAt)).toEqual(
      recovered.responsibilities.map(({ queuedAt }) => queuedAt).toSorted((left, right) => left - right)
    )
    expect(JSON.stringify(records)).not.toContain("queueOrdinal")
    expect(
      selectStartableIntegrationResponsibilities(recovered).map(({ plannedAttempt: attempt }) => attempt.taskId)
    ).toEqual(["A"])
  }).pipe(Effect.provide(protocolTestLayer))
)

it.effect("reconciles durable accepted terminals in order and idempotently after restart", () =>
  Effect.gen(function* () {
    const firstAttempt = plannedAttempt("A", 0)
    const secondAttempt = plannedAttempt("B", 1)
    const firstResult = acceptedResult("a")
    const secondResult = acceptedResult("b")
    yield* beginRun
    yield* recordAcceptedTerminal(firstAttempt, firstResult)
    yield* recordAcceptedTerminal(secondAttempt, secondResult)
    const journal = yield* JournalStore
    const reconstructed = reconstructRunState(runId, yield* journal.read(runId))
    expect(reconstructed._tag).toBe("ValidReconstructedRun")
    if (reconstructed._tag !== "ValidReconstructedRun") {
      return yield* Effect.die("expected accepted terminal reconstruction")
    }

    const frontier = deriveIntegrationFrontier(reconstructed.state, {
      currentTrackerTaskIds: new Set([firstAttempt.taskId, secondAttempt.taskId]),
      heldResponsibilityPositions: new Set(),
      integrationTarget: Option.some(integrationTarget),
      taskClaimAuthorityByAttemptId: exactClaimAuthorities(firstAttempt.attemptId, secondAttempt.attemptId)
    })
    expect(deriveIntegrationFrontier(reconstructed.state).explanations).toContainEqual({
      _tag: "IntegrationTaskClaimConstraint",
      claimState: "Unobserved",
      plannedAttempt: firstAttempt,
      wakeCondition: "TaskClaimFactsObserved"
    })
    expect(
      deriveIntegrationFrontier(reconstructed.state, {
        currentTrackerTaskIds: new Set([firstAttempt.taskId, secondAttempt.taskId]),
        heldResponsibilityPositions: new Set(),
        integrationTarget: Option.none(),
        taskClaimAuthorityByAttemptId: exactClaimAuthorities(firstAttempt.attemptId, secondAttempt.attemptId)
      }).explanations
    ).toContainEqual({
      _tag: "IntegrationConfigurationWait",
      plannedAttempt: firstAttempt,
      wakeCondition: "IntegrationTargetConfigured"
    })
    expect(frontier.transitions).toMatchObject([
      {
        _tag: "QueueAcceptedResultIntegrationResponsibility",
        accepted: { acceptedResult: firstResult, plannedAttempt: firstAttempt }
      }
    ])
    expect(frontier.transitions).toHaveLength(1)

    const integrationResources = yield* makeIntegrationTargetResourceController()
    const recovery = yield* makeRunRecoveryProjection(
      runId,
      integrationTarget,
      undefined,
      undefined,
      integrationResources
    )
    for (const attempt of [firstAttempt, secondAttempt]) {
      const read = makeTaskClaimObservationOperation(
        OperationId.make(`post-restart-claim:${attempt.attemptId}`),
        FixtureTarget.make("integration-admission-target"),
        attempt.taskId
      )
      yield* journal.append(runId, intentRecordKey(read.operationId), taskTrackerReadIntent(read))
      yield* journal.append(
        runId,
        outcomeRecordKey(read.operationId),
        taskTrackerFactsObservedEvent(read.operationId, makeFocusedTaskClaimFactsObserved(read, claimFor(attempt)))
      )
    }
    const firstTransition = (yield* recovery.readDeliveryProjection).frontier.transitions[0]
    if (firstTransition?._tag !== "QueueAcceptedResultIntegrationResponsibility") {
      return yield* Effect.die("expected queue reconciliation")
    }
    expect(runnableTransitionTaskId(firstTransition)).toBe(firstAttempt.taskId)
    yield* queueAcceptedResultIntegrationResponsibility(
      firstTransition.accepted.plannedAttempt,
      firstTransition.accepted.acceptedResult,
      firstTransition.integrationTarget
    )
    yield* queueAcceptedResultIntegrationResponsibility(
      firstTransition.accepted.plannedAttempt,
      firstTransition.accepted.acceptedResult,
      firstTransition.integrationTarget
    )

    const secondFrontier = (yield* recovery.readDeliveryProjection).frontier
    expect(secondFrontier.transitions).toHaveLength(1)
    const secondTransition = secondFrontier.transitions[0]
    if (secondTransition?._tag !== "QueueAcceptedResultIntegrationResponsibility") {
      return yield* Effect.die("expected second queue reconciliation")
    }
    expect(runnableTransitionTaskId(secondTransition)).toBe(secondAttempt.taskId)
    yield* queueAcceptedResultIntegrationResponsibility(
      secondTransition.accepted.plannedAttempt,
      secondTransition.accepted.acceptedResult,
      secondTransition.integrationTarget
    )

    const responsibilities = deriveIntegrationAdmission(yield* journal.read(runId)).responsibilities
    expect(responsibilities.map(({ plannedAttempt }) => plannedAttempt.attemptId)).toEqual([
      firstAttempt.attemptId,
      secondAttempt.attemptId
    ])
    expect(responsibilities[0]?.queuedAt).toBeLessThan(responsibilities[1]?.queuedAt ?? JournalPosition.make(1))
    const waitingFrontier = (yield* recovery.readDeliveryProjection).frontier
    expect(waitingFrontier.explanations.filter(({ _tag }) => _tag === "IntegrationTrackerFactsWait")).toEqual([
      { _tag: "IntegrationTrackerFactsWait", plannedAttempt: firstAttempt, wakeCondition: "TaskTrackerFactsObserved" },
      { _tag: "IntegrationTrackerFactsWait", plannedAttempt: secondAttempt, wakeCondition: "TaskTrackerFactsObserved" }
    ])
    expect(waitingFrontier.transitions).toEqual([])
    const deliveryProjection = yield* recovery.readDeliveryProjection
    expect(deliveryProjection.frontier).toEqual(waitingFrontier)
    expect(deliveryProjection.evidence).toMatchObject({
      _tag: "AvailableDeliveryProjectionEvidence",
      integrationWaits: [
        { _tag: "IntegrationTrackerFactsWait", plannedAttempt: firstAttempt },
        { _tag: "IntegrationTrackerFactsWait", plannedAttempt: secondAttempt }
      ]
    })

    const focusedRead = makeTaskWorkSpecificationObservationOperation(
      OperationId.make("post-restart-focused-specification"),
      FixtureTarget.make("integration-admission-target"),
      firstAttempt.taskId
    )
    yield* journal.append(runId, intentRecordKey(focusedRead.operationId), taskTrackerReadIntent(focusedRead))
    yield* journal.append(
      runId,
      outcomeRecordKey(focusedRead.operationId),
      taskTrackerFactsObservedEvent(
        focusedRead.operationId,
        makeFocusedTaskWorkSpecificationFactsObserved(
          focusedRead,
          makeTaskWorkSpecification({
            body: "Integrate the accepted result.",
            taskId: firstAttempt.taskId,
            title: "Integrate result"
          })
        )
      )
    )
    expect((yield* recovery.readDeliveryProjection).frontier.transitions).toEqual([])

    const graphRead = makeTrackerGraphObservationOperation(
      OperationId.make("post-restart-integration-facts"),
      FixtureTarget.make("integration-admission-target")
    )
    yield* journal.append(runId, intentRecordKey(graphRead.operationId), taskTrackerReadIntent(graphRead))
    yield* journal.append(
      runId,
      outcomeRecordKey(graphRead.operationId),
      taskTrackerGraphFactsObserved(graphRead, {
        revision: TrackerRevision.make("post-restart-integration-revision"),
        taskIds: [firstAttempt.taskId, secondAttempt.taskId]
      })
    )
    expect((yield* recovery.readDeliveryProjection).frontier).toMatchObject({
      transitions: [{ _tag: "StartQueuedIntegration", responsibility: { plannedAttempt: { taskId: "A" } } }]
    })
  }).pipe(
    Effect.provide(protocolTestLayer),
    Effect.provide(controlledFakePlannedAttemptExecutorLayer),
    Effect.provideService(
      WorkflowInterpreter,
      WorkflowInterpreter.of({
        acquireTaskClaim: () => Effect.die("unused"),
        readTaskClaim: () => Effect.die("unexpected task claim read"),
        readTaskWorktree: () => Effect.die("unused worktree observation"),
        readTargetLineage: () => Effect.die("unused target-lineage observation"),
        readTrackerGraph: () => Effect.die("unused"),
        readTaskWorkSpecification: () => Effect.die("unused"),
        reconcileTaskWorktree: () => Effect.die("unused"),
        recordTaskAttemptPlan: () => Effect.die("unused"),
        releaseTaskClaim: () => Effect.die("unused")
      })
    ),
    Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void }))
  )
)

it.effect("composes exact integration start with process-local target acquisition and release", () =>
  Effect.gen(function* () {
    const attempt = plannedAttempt("A", 0)
    const result = acceptedResult("a")
    yield* beginRun
    yield* recordAcceptedTerminal(attempt, result)
    const queued = yield* queueAcceptedResultIntegrationResponsibility(attempt, result, integrationTarget)
    const resources = yield* makeIntegrationTargetResourceController()

    yield* resources.acquire(queued)
    yield* startQueuedIntegration(queued)
    const started = deriveIntegrationAdmission(
      yield* JournalStore.pipe(Effect.flatMap((journal) => journal.read(runId)))
    ).responsibilities[0]
    if (started?._tag !== "StartedIntegrationResponsibility") {
      return yield* Effect.die("expected started responsibility")
    }
    yield* resources.publishAcceptedOwnership(started)
    expect((yield* resources.snapshot).heldResponsibilityPositions).toEqual(new Set([queued.queuedAt]))

    const runState = reconstructRunState(
      runId,
      yield* JournalStore.pipe(Effect.flatMap((journal) => journal.read(runId)))
    )
    if (runState._tag !== "ValidReconstructedRun") return yield* Effect.die("expected valid started run")
    yield* resources.release(started)
    expect(
      deriveIntegrationFrontier(runState.state, {
        currentTrackerTaskIds: new Set([started.plannedAttempt.taskId]),
        heldResponsibilityPositions: new Set(),
        integrationTarget: Option.some(integrationTarget),
        taskClaimAuthorityByAttemptId: exactClaimAuthorities(started.plannedAttempt.attemptId)
      }).transitions
    ).toContainEqual(RunnableFrontierTransition.AcquireStartedIntegrationTarget({ responsibility: started }))
    yield* resources.acquire(started)
    yield* resources.publishAcceptedOwnership(started)

    yield* resources.release(started)
    expect((yield* resources.snapshot).heldResponsibilityPositions).toEqual(new Set())
    yield* resources.acquire(started)
    yield* resources.publishAcceptedOwnership(started)
    expect((yield* resources.snapshot).heldResponsibilityPositions).toEqual(new Set([queued.queuedAt]))
  }).pipe(Effect.provide(protocolTestLayer))
)

it.effect("starts integration once and consumes only its pre-integration cancellation capability", () =>
  Effect.gen(function* () {
    const attempt = plannedAttempt("A", 0)
    yield* beginRun
    const result = acceptedResult("a")
    yield* recordAcceptedTerminal(attempt, result)
    yield* queueAcceptedResultIntegrationResponsibility(attempt, result, integrationTarget)

    const journal = yield* JournalStore
    const before = deriveIntegrationAdmission(yield* journal.read(runId))
    const queued = before.responsibilities[0]
    expect(queued?._tag).toBe("QueuedIntegrationResponsibility")
    if (queued?._tag !== "QueuedIntegrationResponsibility") return yield* Effect.die("expected queued responsibility")

    const started = yield* startQueuedIntegration(queued)
    const idempotent = yield* startQueuedIntegration(queued)
    const after = deriveIntegrationAdmission(yield* journal.read(runId))

    expect(started).toEqual(idempotent)
    expect(after.responsibilities).toEqual([started])
    expect("_tag" in started && started._tag).toBe("StartedIntegrationResponsibility")
    expect("preIntegrationCancellation" in started).toBe(false)
    expect(selectStartableIntegrationResponsibilities(after)).toEqual([])
    expect((yield* journal.read(runId)).filter(({ event }) => event._tag === "IntegrationStarted")).toHaveLength(1)
  }).pipe(Effect.provide(protocolTestLayer))
)

it.effect("preserves same-target order while a blocker wait leaves another target usable", () =>
  Effect.gen(function* () {
    const a = plannedAttempt("A", 0)
    const b = plannedAttempt("B", 1)
    const c = plannedAttempt("C", 2)
    const aResult = acceptedResult("a")
    const bResult = acceptedResult("b")
    const cResult = acceptedResult("c")
    yield* beginRun
    yield* recordAcceptedTerminal(a, aResult)
    yield* recordAcceptedTerminal(b, bResult)
    yield* recordAcceptedTerminal(c, cResult)
    const queuedA = yield* queueAcceptedResultIntegrationResponsibility(a, aResult, integrationTarget)
    yield* queueAcceptedResultIntegrationResponsibility(b, bResult, integrationTarget)
    yield* queueAcceptedResultIntegrationResponsibility(c, cResult, otherIntegrationTarget)
    yield* startQueuedIntegration(queuedA)

    const admission = deriveIntegrationAdmission(
      yield* JournalStore.pipe(Effect.flatMap((journal) => journal.read(runId)))
    )

    expect(
      selectStartableIntegrationResponsibilities(admission).map(({ plannedAttempt: attempt }) => attempt.taskId)
    ).toEqual(["C"])
  }).pipe(Effect.provide(protocolTestLayer))
)

it.effect("fails closed without current tracker facts and orders authorized integration work", () =>
  Effect.gen(function* () {
    const a = plannedAttempt("A", 0)
    const b = plannedAttempt("B", 1)
    const aResult = acceptedResult("a")
    const bResult = acceptedResult("b")
    yield* beginRun
    yield* recordAcceptedTerminal(a, aResult)
    yield* recordAcceptedTerminal(b, bResult)
    const queuedA = yield* queueAcceptedResultIntegrationResponsibility(a, aResult, integrationTarget)
    yield* queueAcceptedResultIntegrationResponsibility(b, bResult, integrationTarget)

    const journal = yield* JournalStore
    const queuedRun = reconstructRunState(runId, yield* journal.read(runId))
    expect(queuedRun._tag).toBe("ValidReconstructedRun")
    if (queuedRun._tag !== "ValidReconstructedRun") return yield* Effect.die("expected valid reconstruction")
    expect(deriveIntegrationFrontier(queuedRun.state)).toMatchObject({
      explanations: [
        { _tag: "IntegrationTrackerFactsWait", plannedAttempt: { taskId: "A" } },
        { _tag: "IntegrationTrackerFactsWait", plannedAttempt: { taskId: "B" } }
      ],
      transitions: []
    })
    const foreignClaimFrontier = deriveIntegrationFrontier(queuedRun.state, {
      currentTrackerTaskIds: new Set([a.taskId, b.taskId]),
      heldResponsibilityPositions: new Set(),
      integrationTarget: Option.some(integrationTarget),
      taskClaimAuthorityByAttemptId: new Map([
        [a.attemptId, { _tag: "Foreign" as const }],
        [b.attemptId, { _tag: "Exact" as const }]
      ])
    })
    expect(deriveIntegrationAdmission(queuedRun.state.workflowHistory.records).responsibilities).toHaveLength(2)
    expect(foreignClaimFrontier.transitions).toEqual([])
    expect(foreignClaimFrontier.explanations).toContainEqual({
      _tag: "IntegrationTaskClaimConstraint",
      claimState: "Foreign",
      plannedAttempt: a,
      wakeCondition: "ExplicitAppliedTaskClaimReacquisitionDirection"
    })
    expect(
      deriveIntegrationFrontier(queuedRun.state, {
        currentTrackerTaskIds: new Set([a.taskId, b.taskId]),
        heldResponsibilityPositions: new Set(),
        integrationTarget: Option.some(integrationTarget),
        taskClaimAuthorityByAttemptId: exactClaimAuthorities(a.attemptId, b.attemptId)
      })
    ).toMatchObject({
      explanations: [{ _tag: "IntegrationTargetWait", plannedAttempt: { taskId: "B" } }],
      transitions: [{ _tag: "StartQueuedIntegration", responsibility: { plannedAttempt: { taskId: "A" } } }]
    })

    yield* startQueuedIntegration(queuedA)
    const startedRun = reconstructRunState(runId, yield* journal.read(runId))
    expect(startedRun._tag).toBe("ValidReconstructedRun")
    if (startedRun._tag !== "ValidReconstructedRun") return yield* Effect.die("expected valid reconstruction")
    const staleStartedFrontier = deriveIntegrationFrontier(startedRun.state)
    expect(staleStartedFrontier.explanations).toContainEqual({
      _tag: "IntegrationTrackerFactsWait",
      plannedAttempt: a,
      wakeCondition: "TaskTrackerFactsObserved"
    })
    expect(staleStartedFrontier.transitions).toEqual([])
    expect(
      deriveIntegrationFrontier(startedRun.state, {
        currentTrackerTaskIds: new Set(),
        heldResponsibilityPositions: new Set([queuedA.queuedAt]),
        integrationTarget: Option.some(integrationTarget),
        taskClaimAuthorityByAttemptId: exactClaimAuthorities(a.attemptId)
      }).transitions
    ).toMatchObject([{ _tag: "ReleaseStartedIntegrationTarget", responsibility: { plannedAttempt: a } }])
    expect(
      deriveIntegrationFrontier(startedRun.state, {
        currentTrackerTaskIds: new Set([a.taskId, b.taskId]),
        heldResponsibilityPositions: new Set([queuedA.queuedAt]),
        integrationTarget: Option.some(integrationTarget),
        taskClaimAuthorityByAttemptId: exactClaimAuthorities(a.attemptId, b.attemptId)
      })
    ).toMatchObject({
      explanations: [
        { _tag: "IntegrationInProgress", plannedAttempt: { taskId: "A" } },
        { _tag: "IntegrationTargetWait", plannedAttempt: { taskId: "B" } }
      ],
      transitions: []
    })
    expect(
      deriveIntegrationFrontier(startedRun.state, {
        candidateCorrectionLimit: Option.some(CandidateCorrectionLimit.make(1)),
        candidateContinuationLimit: Option.some(CandidateContinuationLimit.make(2)),
        currentTrackerTaskIds: new Set([a.taskId, b.taskId]),
        heldResponsibilityPositions: new Set([queuedA.queuedAt]),
        integrationTarget: Option.some(integrationTarget),
        targetLineageByAttemptId: new Map([
          [
            a.attemptId,
            TargetLineageObservation.make({
              plannedBaseIsAncestorOfTargetHead: true,
              plannedBaseSha: a.baseSha,
              targetHeadSha: GitCommitSha.make("f".repeat(40))
            })
          ]
        ]),
        taskClaimAuthorityByAttemptId: exactClaimAuthorities(a.attemptId, b.attemptId)
      }).transitions
    ).toContainEqual(
      expect.objectContaining({
        _tag: "ContinueStartedIntegrationCandidate",
        responsibility: expect.objectContaining({ queuedAt: queuedA.queuedAt })
      })
    )
  }).pipe(Effect.provide(protocolTestLayer))
)

it.effect("derives a target-rewrite constraint before proposing candidate construction", () =>
  Effect.gen(function* () {
    const attempt = plannedAttempt("A", 0)
    const result = acceptedResult("a")
    yield* beginRun
    yield* recordAcceptedTerminal(attempt, result)
    const queued = yield* queueAcceptedResultIntegrationResponsibility(attempt, result, integrationTarget)
    yield* startQueuedIntegration(queued)

    const journal = yield* JournalStore
    const reconstructed = reconstructRunState(runId, yield* journal.read(runId))
    if (reconstructed._tag !== "ValidReconstructedRun") {
      return yield* Effect.die("expected valid reconstructed integration responsibility")
    }
    const frontier = deriveIntegrationFrontier(reconstructed.state, {
      candidateCorrectionLimit: Option.some(CandidateCorrectionLimit.make(1)),
      candidateContinuationLimit: Option.some(CandidateContinuationLimit.make(2)),
      currentTrackerTaskIds: new Set([attempt.taskId]),
      heldResponsibilityPositions: new Set([queued.queuedAt]),
      integrationTarget: Option.some(integrationTarget),
      targetLineageByAttemptId: new Map([
        [
          attempt.attemptId,
          TargetLineageObservation.make({
            plannedBaseIsAncestorOfTargetHead: false,
            plannedBaseSha: attempt.baseSha,
            targetHeadSha: GitCommitSha.make("9".repeat(40))
          })
        ]
      ]),
      taskClaimAuthorityByAttemptId: exactClaimAuthorities(attempt.attemptId)
    })

    expect(frontier.transitions).not.toContainEqual(
      expect.objectContaining({ _tag: "ContinueStartedIntegrationCandidate" })
    )
    expect(frontier.explanations).toContainEqual({
      _tag: "PlannedAttemptGitConstraint",
      correlation: expect.objectContaining({ attemptId: attempt.attemptId }),
      gitState: "TargetRewrite",
      taskId: attempt.taskId,
      wakeCondition: "GitFactsObserved"
    })
  }).pipe(Effect.provide(protocolTestLayer))
)

it.effect("rereads target lineage after restart instead of authorizing a candidate from stale evidence", () =>
  Effect.gen(function* () {
    const attempt = plannedAttempt("C", 0)
    const result = acceptedResult("d")
    yield* beginRun
    yield* recordAcceptedTerminal(attempt, result)
    const queued = yield* queueAcceptedResultIntegrationResponsibility(attempt, result, integrationTarget)
    yield* startQueuedIntegration(queued)

    const journal = yield* JournalStore
    const staleRead = makeTargetLineageObservationOperation({
      integrationTarget,
      operationId: OperationId.make("pre-restart-target-lineage"),
      plannedAttempt: attempt,
      predecessorOperationIds: []
    })
    yield* journal.append(
      runId,
      intentRecordKey(staleRead.operationId),
      GitReadIntentRecordedEvent.make({
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        operation: staleRead,
        version: workflowJournalEventVersion
      })
    )
    yield* journal.append(
      runId,
      outcomeRecordKey(staleRead.operationId),
      TargetLineageObservedEvent.make({
        observation: TargetLineageObservation.make({
          plannedBaseIsAncestorOfTargetHead: true,
          plannedBaseSha: attempt.baseSha,
          targetHeadSha: GitCommitSha.make("e".repeat(40))
        }),
        occurrenceClassification: "NonActionOccurrence",
        operationId: staleRead.operationId,
        plannedAttempt: attempt,
        version: workflowJournalEventVersion
      })
    )

    const integrationResources = yield* makeIntegrationTargetResourceController()
    const recovery = yield* makeRunRecoveryProjection(
      runId,
      integrationTarget,
      CandidateCorrectionLimit.make(1),
      CandidateContinuationLimit.make(2),
      integrationResources
    )
    const claimRead = makeTaskClaimObservationOperation(
      OperationId.make("post-restart-stale-lineage-claim"),
      FixtureTarget.make("integration-admission-target"),
      attempt.taskId
    )
    yield* journal.append(runId, intentRecordKey(claimRead.operationId), taskTrackerReadIntent(claimRead))
    yield* journal.append(
      runId,
      outcomeRecordKey(claimRead.operationId),
      taskTrackerFactsObservedEvent(
        claimRead.operationId,
        makeFocusedTaskClaimFactsObserved(claimRead, claimFor(attempt))
      )
    )
    const graphRead = makeTrackerGraphObservationOperation(
      OperationId.make("post-restart-stale-lineage-graph"),
      FixtureTarget.make("integration-admission-target")
    )
    yield* journal.append(runId, intentRecordKey(graphRead.operationId), taskTrackerReadIntent(graphRead))
    yield* journal.append(
      runId,
      outcomeRecordKey(graphRead.operationId),
      taskTrackerGraphFactsObserved(graphRead, {
        revision: TrackerRevision.make("post-restart-stale-lineage-revision"),
        taskIds: [attempt.taskId]
      })
    )

    const acquisition = (yield* recovery.readDeliveryProjection).frontier.transitions.find(
      ({ _tag }) => _tag === "AcquireStartedIntegrationTarget"
    )
    if (acquisition?._tag !== "AcquireStartedIntegrationTarget") {
      return yield* Effect.die("expected restarted integration target acquisition")
    }
    yield* integrationResources.acquire(acquisition.responsibility)
    yield* integrationResources.publishAcceptedOwnership(acquisition.responsibility)

    const lineageRead = (yield* recovery.readDeliveryProjection).frontier.transitions.find(
      ({ _tag }) => _tag === "ObservePlannedAttemptContinuationTargetLineage"
    )
    expect(lineageRead).toMatchObject({
      _tag: "ObservePlannedAttemptContinuationTargetLineage",
      plannedAttempt: { attemptId: attempt.attemptId }
    })
    if (lineageRead?._tag === "ObservePlannedAttemptContinuationTargetLineage") {
      expect(lineageRead.operation.operationId).not.toBe(staleRead.operationId)
    }
  }).pipe(
    Effect.provide(protocolTestLayer),
    Effect.provide(controlledFakePlannedAttemptExecutorLayer),
    Effect.provideService(
      WorkflowInterpreter,
      WorkflowInterpreter.of({
        acquireTaskClaim: () => Effect.die("unused"),
        readTaskClaim: () => Effect.die("unused"),
        readTaskWorktree: () => Effect.die("unused"),
        readTargetLineage: () => Effect.die("unused"),
        readTrackerGraph: () => Effect.die("unused"),
        readTaskWorkSpecification: () => Effect.die("unused"),
        reconcileTaskWorktree: () => Effect.die("unused"),
        recordTaskAttemptPlan: () => Effect.die("unused"),
        releaseTaskClaim: () => Effect.die("unused")
      })
    ),
    Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void }))
  )
)

it.effect("routes a constructed candidate through configuration and compatible target rewrite boundaries", () =>
  Effect.gen(function* () {
    const attempt = plannedAttempt("A", 0)
    const result = acceptedResult("a")
    yield* beginRun
    yield* recordAcceptedTerminal(attempt, result)
    const queued = yield* queueAcceptedResultIntegrationResponsibility(attempt, result, integrationTarget)
    yield* startQueuedIntegration(queued)

    const journal = yield* JournalStore
    const reconstructed = reconstructRunState(runId, yield* journal.read(runId))
    if (reconstructed._tag !== "ValidReconstructedRun") return yield* Effect.die("expected started run")
    const started = deriveIntegrationAdmission(reconstructed.state.workflowHistory.records).responsibilities.find(
      (responsibility): responsibility is StartedIntegrationResponsibility =>
        responsibility._tag === "StartedIntegrationResponsibility"
    )
    if (started === undefined) return yield* Effect.die("expected started integration responsibility")
    const candidateState = candidateFrontierRecordsFor(
      reconstructed.state.workflowHistory.records,
      started,
      "configuration"
    )
    const runState = { ...reconstructed.state, workflowHistory: { records: candidateState.records } }
    const plan = TargetVerificationPlan.make({
      planId: TargetVerificationPlanId.make("frontier-configuration-plan"),
      target: integrationTarget
    })
    const common = {
      currentTrackerTaskIds: new Set([attempt.taskId]),
      heldResponsibilityPositions: new Set([started.queuedAt]),
      integrationTarget: Option.some(integrationTarget),
      taskClaimAuthorityByAttemptId: exactClaimAuthorities(attempt.attemptId)
    }

    expect(deriveIntegrationFrontier(runState, { ...common, targetVerificationPlan: Option.none() })).toMatchObject({
      explanations: [{ _tag: "TargetVerificationConfigurationWait", plannedAttempt: attempt }],
      transitions: [{ _tag: "ReleaseStartedIntegrationTarget" }]
    })

    const targetLineage = TargetLineageObservation.make({
      plannedBaseIsAncestorOfTargetHead: true,
      plannedBaseSha: attempt.baseSha,
      targetHeadSha: GitCommitSha.make("f".repeat(40))
    })
    expect(
      deriveIntegrationFrontier(runState, {
        ...common,
        targetLineageByAttemptId: new Map([[attempt.attemptId, targetLineage]]),
        targetVerificationPlan: Option.some(plan)
      }).transitions
    ).toMatchObject([{ _tag: "RunTargetVerification", candidate: { candidateCommit: expect.any(String) } }])

    const rewritten = TargetLineageObservation.make({
      plannedBaseIsAncestorOfTargetHead: true,
      plannedBaseSha: attempt.baseSha,
      targetHeadSha: GitCommitSha.make("e".repeat(40))
    })
    expect(
      deriveIntegrationFrontier(runState, {
        ...common,
        targetLineageByAttemptId: new Map([[attempt.attemptId, rewritten]]),
        targetVerificationPlan: Option.some(plan)
      }).transitions
    ).toMatchObject([{ _tag: "ContinueStartedIntegrationCandidate" }])

    const incompatible = TargetLineageObservation.make({
      plannedBaseIsAncestorOfTargetHead: false,
      plannedBaseSha: attempt.baseSha,
      targetHeadSha: GitCommitSha.make("d".repeat(40))
    })
    expect(
      deriveIntegrationFrontier(runState, {
        ...common,
        targetLineageByAttemptId: new Map([[attempt.attemptId, incompatible]]),
        targetVerificationPlan: Option.some(plan)
      }).transitions
    ).toMatchObject([{ _tag: "ReleaseStartedIntegrationTarget" }])
    expect(
      deriveIntegrationFrontier(runState, {
        ...common,
        heldResponsibilityPositions: new Set(),
        targetLineageByAttemptId: new Map([[attempt.attemptId, incompatible]]),
        targetVerificationPlan: Option.some(plan)
      }).transitions
    ).toEqual([])
  }).pipe(Effect.provide(protocolTestLayer))
)

it.effect("keeps pending verification passive while an observed prerequisite remains incomplete", () =>
  Effect.gen(function* () {
    const prerequisiteTaskId = TaskId.make("A")
    const attempt = plannedAttempt("B", 2)
    const result = acceptedResult("b")
    yield* beginRun
    yield* recordAcceptedTerminal(attempt, result)
    const queued = yield* queueAcceptedResultIntegrationResponsibility(attempt, result, integrationTarget)
    yield* startQueuedIntegration(queued)

    const journal = yield* JournalStore
    const graphRead = makeTrackerGraphObservationOperation(
      OperationId.make("pending-verification-prerequisite-graph"),
      FixtureTarget.make("integration-admission-target")
    )
    const projected = projectTrackerSnapshot({
      revision: TrackerRevision.make("pending-verification-prerequisite-revision"),
      tasks: [
        {
          id: prerequisiteTaskId,
          lifecycle: TaskLifecycle.cases.Open.make({}),
          parentTaskId: null,
          prerequisiteIds: []
        },
        {
          id: attempt.taskId,
          lifecycle: TaskLifecycle.cases.Open.make({}),
          parentTaskId: null,
          prerequisiteIds: [prerequisiteTaskId]
        }
      ]
    })
    if (projected._tag !== "Valid") return yield* Effect.die("expected valid prerequisite graph")
    yield* journal.append(runId, intentRecordKey(graphRead.operationId), taskTrackerReadIntent(graphRead))
    yield* journal.append(
      runId,
      outcomeRecordKey(graphRead.operationId),
      taskTrackerFactsObservedEvent(
        graphRead.operationId,
        makeCompleteTaskTrackerFactsObserved(graphRead, projected.snapshot)
      )
    )

    const reconstructed = reconstructRunState(runId, yield* journal.read(runId))
    if (reconstructed._tag !== "ValidReconstructedRun") return yield* Effect.die("expected started run")
    const started = deriveIntegrationAdmission(reconstructed.state.workflowHistory.records).responsibilities.find(
      (responsibility): responsibility is StartedIntegrationResponsibility =>
        responsibility._tag === "StartedIntegrationResponsibility"
    )
    if (started === undefined) return yield* Effect.die("expected started integration responsibility")
    const candidateState = candidateFrontierRecordsFor(
      reconstructed.state.workflowHistory.records,
      started,
      "pending-verification-prerequisite"
    )
    const plan = TargetVerificationPlan.make({
      planId: TargetVerificationPlanId.make("pending-verification-prerequisite-plan"),
      target: integrationTarget
    })
    const verificationIntent = frontierRecord(
      runId,
      Math.max(...candidateState.records.map(({ position }) => Number(position))) + 1,
      TargetVerificationIntendedEvent.make({
        correlation: targetVerificationCorrelationFor(candidateState.candidate, plan.planId),
        version: workflowJournalEventVersion
      })
    )
    const runState = {
      ...reconstructed.state,
      workflowHistory: { records: [...candidateState.records, verificationIntent] }
    }

    expect(
      deriveIntegrationFrontier(runState, {
        currentTrackerTaskIds: new Set([attempt.taskId]),
        heldResponsibilityPositions: new Set(),
        integrationTarget: Option.some(integrationTarget),
        targetVerificationPlan: Option.some(plan),
        taskClaimAuthorityByAttemptId: exactClaimAuthorities(attempt.attemptId)
      })
    ).toMatchObject({
      explanations: [
        {
          _tag: "IntegrationDependencyWait",
          plannedAttempt: attempt,
          prerequisiteTaskIds: [prerequisiteTaskId],
          wakeCondition: "TaskTrackerFactsObserved"
        }
      ],
      transitions: []
    })
  }).pipe(Effect.provide(protocolTestLayer))
)

it.effect("keeps passed verification in promotion order and releases a completed promotion", () =>
  Effect.gen(function* () {
    const attempt = plannedAttempt("B", 0)
    const result = acceptedResult("b")
    yield* beginRun
    yield* recordAcceptedTerminal(attempt, result)
    const queued = yield* queueAcceptedResultIntegrationResponsibility(attempt, result, integrationTarget)
    yield* startQueuedIntegration(queued)

    const journal = yield* JournalStore
    const reconstructed = reconstructRunState(runId, yield* journal.read(runId))
    if (reconstructed._tag !== "ValidReconstructedRun") return yield* Effect.die("expected started run")
    const started = deriveIntegrationAdmission(reconstructed.state.workflowHistory.records).responsibilities.find(
      (responsibility): responsibility is StartedIntegrationResponsibility =>
        responsibility._tag === "StartedIntegrationResponsibility"
    )
    if (started === undefined) return yield* Effect.die("expected started integration responsibility")
    const candidateState = candidateFrontierRecordsFor(
      reconstructed.state.workflowHistory.records,
      started,
      "promotion"
    )
    const verified = targetVerificationRecordsFor(candidateState.records, candidateState.candidate)
    const promotion = targetPromotionRequestFor(candidateState.candidate, {
      correlation: verified.correlation,
      manifest: evidenceReferenceFixture
    })
    const promotionIntent = frontierRecord(
      runId,
      Math.max(...verified.records.map(({ position }) => Number(position))) + 1,
      TargetPromotionIntendedEvent.make({ correlation: promotion, version: workflowJournalEventVersion })
    )
    const runState = { ...reconstructed.state, workflowHistory: { records: [...verified.records, promotionIntent] } }
    const plan = TargetVerificationPlan.make({ planId: verified.correlation.planId, target: integrationTarget })
    const facts = {
      currentTrackerTaskIds: new Set([attempt.taskId]),
      heldResponsibilityPositions: new Set([started.queuedAt]),
      integrationTarget: Option.some(integrationTarget),
      targetLineageByAttemptId: new Map([
        [
          attempt.attemptId,
          TargetLineageObservation.make({
            plannedBaseIsAncestorOfTargetHead: true,
            plannedBaseSha: attempt.baseSha,
            targetHeadSha: candidateState.candidate.correlation.expectedTargetHead
          })
        ]
      ]),
      targetPromotionConfigured: true,
      targetVerificationPlan: Option.some(plan),
      taskClaimAuthorityByAttemptId: exactClaimAuthorities(attempt.attemptId)
    }

    expect(deriveIntegrationFrontier(runState, facts)).toMatchObject({
      explanations: [{ _tag: "IntegrationInProgress", plannedAttempt: attempt }],
      transitions: [{ _tag: "RunTargetPromotion" }]
    })

    const success = frontierRecord(
      runId,
      Number(promotionIntent.position) + 1,
      TargetPromotionObservedSuccessEvent.make({
        basis: { _tag: "AfterAttempt", attemptOrdinal: TargetPromotionAttemptOrdinal.make(1) },
        correlation: promotion,
        observation: TargetPromotionSuccessObservation.cases.CompareAndSetApplied.make({
          candidateAncestry: "Current",
          targetHeadSha: candidateState.candidate.candidateCommit
        }),
        version: workflowJournalEventVersion
      })
    )
    expect(
      deriveIntegrationFrontier(
        { ...runState, workflowHistory: { records: [...runState.workflowHistory.records, success] } },
        facts
      ).transitions
    ).toMatchObject([{ _tag: "ReleaseStartedIntegrationTarget" }])
  }).pipe(Effect.provide(protocolTestLayer))
)

it.effect("releases a held target when verification is stopped or tracker facts are stale", () =>
  Effect.gen(function* () {
    const attempt = plannedAttempt("C", 0)
    const result = acceptedResult("c")
    yield* beginRun
    yield* recordAcceptedTerminal(attempt, result)
    const queued = yield* queueAcceptedResultIntegrationResponsibility(attempt, result, integrationTarget)
    yield* startQueuedIntegration(queued)

    const journal = yield* JournalStore
    const reconstructed = reconstructRunState(runId, yield* journal.read(runId))
    if (reconstructed._tag !== "ValidReconstructedRun") return yield* Effect.die("expected started run")
    const started = deriveIntegrationAdmission(reconstructed.state.workflowHistory.records).responsibilities.find(
      (responsibility): responsibility is StartedIntegrationResponsibility =>
        responsibility._tag === "StartedIntegrationResponsibility"
    )
    if (started === undefined) return yield* Effect.die("expected started integration responsibility")
    const candidateState = candidateFrontierRecordsFor(reconstructed.state.workflowHistory.records, started, "stopped")
    const verified = targetVerificationRecordsFor(candidateState.records, candidateState.candidate, "Failed")
    const runState = { ...reconstructed.state, workflowHistory: { records: verified.records } }
    const common = {
      currentTrackerTaskIds: new Set([attempt.taskId]),
      heldResponsibilityPositions: new Set([started.queuedAt]),
      integrationTarget: Option.some(integrationTarget),
      taskClaimAuthorityByAttemptId: exactClaimAuthorities(attempt.attemptId),
      targetVerificationPlan: Option.some(
        TargetVerificationPlan.make({ planId: verified.correlation.planId, target: integrationTarget })
      )
    }
    expect(deriveIntegrationFrontier(runState, common).transitions).toMatchObject([
      { _tag: "ReleaseStartedIntegrationTarget" }
    ])
    expect(
      deriveIntegrationFrontier(runState, {
        ...common,
        currentTrackerTaskIds: new Set(),
        heldResponsibilityPositions: new Set()
      }).transitions
    ).toEqual([])
  }).pipe(Effect.provide(protocolTestLayer))
)

it.effect("covers passed-candidate target acquisition, promotion configuration, and rewrite outcomes", () =>
  Effect.gen(function* () {
    const attempt = plannedAttempt("A", 1)
    const result = acceptedResult("a")
    yield* beginRun
    yield* recordAcceptedTerminal(attempt, result)
    const queued = yield* queueAcceptedResultIntegrationResponsibility(attempt, result, integrationTarget)
    yield* startQueuedIntegration(queued)

    const journal = yield* JournalStore
    const reconstructed = reconstructRunState(runId, yield* journal.read(runId))
    if (reconstructed._tag !== "ValidReconstructedRun") return yield* Effect.die("expected started run")
    const started = deriveIntegrationAdmission(reconstructed.state.workflowHistory.records).responsibilities.find(
      (responsibility): responsibility is StartedIntegrationResponsibility =>
        responsibility._tag === "StartedIntegrationResponsibility"
    )
    if (started === undefined) return yield* Effect.die("expected started integration responsibility")
    const candidateState = candidateFrontierRecordsFor(
      reconstructed.state.workflowHistory.records,
      started,
      "passed-candidate-matrix"
    )
    const verified = targetVerificationRecordsFor(candidateState.records, candidateState.candidate)
    const runState = { ...reconstructed.state, workflowHistory: { records: verified.records } }
    const plan = TargetVerificationPlan.make({ planId: verified.correlation.planId, target: integrationTarget })
    const lineage = TargetLineageObservation.make({
      plannedBaseIsAncestorOfTargetHead: true,
      plannedBaseSha: attempt.baseSha,
      targetHeadSha: candidateState.candidate.correlation.expectedTargetHead
    })
    const common = {
      currentTrackerTaskIds: new Set([attempt.taskId]),
      integrationTarget: Option.some(integrationTarget),
      targetLineageByAttemptId: new Map([[attempt.attemptId, lineage]]),
      targetVerificationPlan: Option.some(plan),
      taskClaimAuthorityByAttemptId: exactClaimAuthorities(attempt.attemptId)
    }

    expect(
      deriveIntegrationFrontier(runState, {
        ...common,
        heldResponsibilityPositions: new Set([started.queuedAt]),
        targetPromotionConfigured: false
      }).transitions
    ).toMatchObject([{ _tag: "ReleaseStartedIntegrationTarget" }])
    expect(
      deriveIntegrationFrontier(runState, {
        ...common,
        heldResponsibilityPositions: new Set(),
        targetPromotionConfigured: false
      }).transitions
    ).toEqual([])
    expect(
      deriveIntegrationFrontier(runState, {
        ...common,
        heldResponsibilityPositions: new Set([started.queuedAt]),
        targetPromotionConfigured: true
      }).transitions
    ).toMatchObject([{ _tag: "RunTargetPromotion" }])
    expect(
      deriveIntegrationFrontier(runState, {
        ...common,
        heldResponsibilityPositions: new Set(),
        targetPromotionConfigured: true
      }).transitions
    ).toMatchObject([{ _tag: "AcquireStartedIntegrationTarget" }])

    const withoutLineage = { ...common, targetLineageByAttemptId: new Map() }
    expect(
      deriveIntegrationFrontier(runState, {
        ...withoutLineage,
        heldResponsibilityPositions: new Set([started.queuedAt]),
        targetPromotionConfigured: true
      }).transitions
    ).toEqual([])
    expect(
      deriveIntegrationFrontier(runState, {
        ...withoutLineage,
        heldResponsibilityPositions: new Set(),
        targetPromotionConfigured: true
      }).transitions
    ).toMatchObject([{ _tag: "AcquireStartedIntegrationTarget" }])

    const compatibleRewrite = TargetLineageObservation.make({
      plannedBaseIsAncestorOfTargetHead: true,
      plannedBaseSha: attempt.baseSha,
      targetHeadSha: GitCommitSha.make("e".repeat(40))
    })
    expect(
      deriveIntegrationFrontier(runState, {
        ...common,
        heldResponsibilityPositions: new Set(),
        targetLineageByAttemptId: new Map([[attempt.attemptId, compatibleRewrite]]),
        targetPromotionConfigured: true
      }).transitions
    ).toMatchObject([{ _tag: "AcquireStartedIntegrationTarget" }])

    const incompatibleRewrite = TargetLineageObservation.make({
      plannedBaseIsAncestorOfTargetHead: false,
      plannedBaseSha: attempt.baseSha,
      targetHeadSha: GitCommitSha.make("d".repeat(40))
    })
    expect(
      deriveIntegrationFrontier(runState, {
        ...common,
        heldResponsibilityPositions: new Set([started.queuedAt]),
        targetLineageByAttemptId: new Map([[attempt.attemptId, incompatibleRewrite]]),
        targetPromotionConfigured: true
      }).transitions
    ).toMatchObject([{ _tag: "ReleaseStartedIntegrationTarget" }])
    expect(
      deriveIntegrationFrontier(runState, {
        ...common,
        heldResponsibilityPositions: new Set(),
        targetLineageByAttemptId: new Map([[attempt.attemptId, incompatibleRewrite]]),
        targetPromotionConfigured: true
      }).transitions
    ).toEqual([])
  }).pipe(Effect.provide(protocolTestLayer))
)

it.effect("releases terminal candidate construction and resumes an unconstructed candidate with exact limits", () =>
  Effect.gen(function* () {
    const attempt = plannedAttempt("B", 1)
    const result = acceptedResult("b")
    yield* beginRun
    yield* recordAcceptedTerminal(attempt, result)
    const queued = yield* queueAcceptedResultIntegrationResponsibility(attempt, result, integrationTarget)
    yield* startQueuedIntegration(queued)

    const journal = yield* JournalStore
    const reconstructed = reconstructRunState(runId, yield* journal.read(runId))
    if (reconstructed._tag !== "ValidReconstructedRun") return yield* Effect.die("expected started run")
    const started = deriveIntegrationAdmission(reconstructed.state.workflowHistory.records).responsibilities.find(
      (responsibility): responsibility is StartedIntegrationResponsibility =>
        responsibility._tag === "StartedIntegrationResponsibility"
    )
    if (started === undefined) return yield* Effect.die("expected started integration responsibility")
    const candidateState = candidateFrontierRecordsFor(
      reconstructed.state.workflowHistory.records,
      started,
      "candidate-limit-matrix"
    )
    const limitAt = Math.max(...candidateState.records.map(({ position }) => Number(position))) + 1
    const limited = frontierRecord(
      runId,
      limitAt,
      IntegrationCandidateContinuationLimitReachedEvent.make({
        continuationCount: 2,
        continuationLimit: CandidateContinuationLimit.make(2),
        correlation: candidateState.candidate.correlation,
        lastReportAt: JournalPosition.make(limitAt - 1),
        version: workflowJournalEventVersion
      })
    )
    const limitedState = { ...reconstructed.state, workflowHistory: { records: [...candidateState.records, limited] } }
    const common = {
      currentTrackerTaskIds: new Set([attempt.taskId]),
      integrationTarget: Option.some(integrationTarget),
      taskClaimAuthorityByAttemptId: exactClaimAuthorities(attempt.attemptId)
    }
    expect(
      deriveIntegrationFrontier(limitedState, { ...common, heldResponsibilityPositions: new Set([started.queuedAt]) })
        .transitions
    ).toMatchObject([{ _tag: "ReleaseStartedIntegrationTarget" }])
    expect(
      deriveIntegrationFrontier(limitedState, { ...common, heldResponsibilityPositions: new Set() }).transitions
    ).toEqual([])

    const noCandidate = reconstructed.state
    expect(
      deriveIntegrationFrontier(noCandidate, {
        ...common,
        heldResponsibilityPositions: new Set([started.queuedAt]),
        candidateContinuationLimit: Option.some(CandidateContinuationLimit.make(2)),
        candidateCorrectionLimit: Option.some(CandidateCorrectionLimit.make(1)),
        targetLineageByAttemptId: new Map([
          [
            attempt.attemptId,
            TargetLineageObservation.make({
              plannedBaseIsAncestorOfTargetHead: true,
              plannedBaseSha: attempt.baseSha,
              targetHeadSha: GitCommitSha.make("f".repeat(40))
            })
          ]
        ])
      }).transitions
    ).toMatchObject([{ _tag: "ContinueStartedIntegrationCandidate" }])
    expect(
      deriveIntegrationFrontier(noCandidate, {
        ...common,
        heldResponsibilityPositions: new Set([started.queuedAt]),
        targetLineageByAttemptId: new Map([
          [
            attempt.attemptId,
            TargetLineageObservation.make({
              plannedBaseIsAncestorOfTargetHead: false,
              plannedBaseSha: attempt.baseSha,
              targetHeadSha: GitCommitSha.make("f".repeat(40))
            })
          ]
        ])
      }).transitions
    ).toEqual([])
  }).pipe(Effect.provide(protocolTestLayer))
)

it.effect("releases stale and non-convergent promotions from the exact held responsibility", () =>
  Effect.gen(function* () {
    const attempt = plannedAttempt("C", 1)
    const result = acceptedResult("c")
    yield* beginRun
    yield* recordAcceptedTerminal(attempt, result)
    const queued = yield* queueAcceptedResultIntegrationResponsibility(attempt, result, integrationTarget)
    yield* startQueuedIntegration(queued)

    const journal = yield* JournalStore
    const reconstructed = reconstructRunState(runId, yield* journal.read(runId))
    if (reconstructed._tag !== "ValidReconstructedRun") return yield* Effect.die("expected started run")
    const started = deriveIntegrationAdmission(reconstructed.state.workflowHistory.records).responsibilities.find(
      (responsibility): responsibility is StartedIntegrationResponsibility =>
        responsibility._tag === "StartedIntegrationResponsibility"
    )
    if (started === undefined) return yield* Effect.die("expected started integration responsibility")
    const candidateState = candidateFrontierRecordsFor(
      reconstructed.state.workflowHistory.records,
      started,
      "promotion-terminal-matrix"
    )
    const verified = targetVerificationRecordsFor(candidateState.records, candidateState.candidate)
    const promotion = targetPromotionRequestFor(candidateState.candidate, {
      correlation: verified.correlation,
      manifest: evidenceReferenceFixture
    })
    const promotionIntent = frontierRecord(
      runId,
      Math.max(...verified.records.map(({ position }) => Number(position))) + 1,
      TargetPromotionIntendedEvent.make({ correlation: promotion, version: workflowJournalEventVersion })
    )
    const stale = frontierRecord(
      runId,
      Number(promotionIntent.position) + 1,
      TargetPromotionStaleEvent.make({
        basis: { _tag: "BeforeFirstAttempt" },
        correlation: promotion,
        observation: TargetPromotionStaleObservation.cases.ReconciledCandidateNotInAncestry.make({
          observedHeadSha: GitCommitSha.make("a".repeat(40))
        }),
        version: workflowJournalEventVersion
      })
    )
    const nonConvergent = frontierRecord(
      runId,
      Number(promotionIntent.position) + 1,
      TargetPromotionNonConvergenceEvent.make({
        attemptLimit: TargetPromotionAttemptLimit.make(3),
        attemptOrdinal: TargetPromotionAttemptOrdinal.make(3),
        correlation: promotion,
        lastObservation: TargetPromotionNonConvergenceObservation.cases.ExpectedHeadStillObserved.make({
          observedHeadSha: promotion.expectedTargetHead
        }),
        version: workflowJournalEventVersion
      })
    )
    const baseFacts = {
      currentTrackerTaskIds: new Set([attempt.taskId]),
      integrationTarget: Option.some(integrationTarget),
      heldResponsibilityPositions: new Set([started.queuedAt]),
      targetLineageByAttemptId: new Map([
        [
          attempt.attemptId,
          TargetLineageObservation.make({
            plannedBaseIsAncestorOfTargetHead: true,
            plannedBaseSha: attempt.baseSha,
            targetHeadSha: candidateState.candidate.correlation.expectedTargetHead
          })
        ]
      ]),
      targetPromotionConfigured: true,
      targetVerificationPlan: Option.some(
        TargetVerificationPlan.make({ planId: verified.correlation.planId, target: integrationTarget })
      ),
      taskClaimAuthorityByAttemptId: exactClaimAuthorities(attempt.attemptId)
    }
    expect(
      deriveIntegrationFrontier(
        { ...reconstructed.state, workflowHistory: { records: [...verified.records, promotionIntent, stale] } },
        baseFacts
      ).transitions
    ).toMatchObject([{ _tag: "ReleaseStartedIntegrationTarget" }])
    expect(
      deriveIntegrationFrontier(
        { ...reconstructed.state, workflowHistory: { records: [...verified.records, promotionIntent, nonConvergent] } },
        baseFacts
      ).transitions
    ).toMatchObject([{ _tag: "ReleaseStartedIntegrationTarget" }])
    expect(
      deriveIntegrationFrontier(
        { ...reconstructed.state, workflowHistory: { records: [...verified.records, promotionIntent, nonConvergent] } },
        { ...baseFacts, heldResponsibilityPositions: new Set() }
      ).transitions
    ).toEqual([])
  }).pipe(Effect.provide(protocolTestLayer))
)
