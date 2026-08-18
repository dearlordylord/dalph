import {
  acceptedResultEvidenceLayer,
  acceptedResultFixture,
  evidenceReferenceFixture,
  registerAcceptedResultEvidence
} from "../../../test/support/evidence.js"
import {
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
import { it } from "@effect/vitest"
import { Effect, Layer, Option, Ref, Stream } from "effect"
import { expect } from "vitest"
import { ClaimOwner, ClaimToken } from "../../authorities/task-tracker/claim.js"
import { ActiveTaskClaim } from "../../authorities/task-tracker/claim-mutation.js"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { projectTrackerSnapshot } from "../../authorities/task-tracker/graph.js"
import { TargetLineageObservation } from "../../authorities/git/target-lineage.js"
import { InitialControlPolicy } from "../../control/policy.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import {
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  GitReadIntentRecordedEvent,
  TargetLineageObservedEvent,
  taskTrackerReadIntent
} from "../../workflow/registry/event.js"
import {
  makeTaskAttemptPlanOperation,
  makeTaskClaimAcquisitionOperation,
  makeTaskClaimObservationOperation,
  makeTargetLineageObservationOperation,
  makeTrackerGraphObservationOperation
} from "../../workflow/registry/operation.js"
import {
  CandidateContinuationLimit,
  CandidateCorrectionLimit,
  continueIntegrationCandidateConstruction,
  IntegrationCandidateAgent,
  IntegrationCandidateAgentReport,
  IntegrationCandidateGit,
  IntegrationCandidateGitObservation
} from "../../workflow/protocols/integration-candidate-construction/protocol.js"
import {
  deriveIntegrationAdmission,
  queueAcceptedResultIntegrationResponsibility,
  startQueuedIntegration
} from "../../workflow/protocols/integration-admission/protocol.js"
import {
  PlannedAttemptExecutorCommandIntendedEvent,
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent
} from "../../workflow/protocols/planned-attempt-executor-work/events.js"
import {
  makeCompleteTaskTrackerFactsObserved,
  makeFocusedTaskClaimFactsObserved,
  taskTrackerFactsObservedEvent
} from "../../workflow/task-tracker-facts/observation.js"
import { legacyMemoryJournalStoreLayer } from "../../workflow-journal/adapters/memory-store.js"
import {
  attemptPlanRecordKey,
  intentRecordKey,
  outcomeRecordKey,
  plannedAttemptExecutorCommandIntendedRecordKey,
  plannedAttemptExecutorWorkReportedRecordKey,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey
} from "../../workflow-journal/record-key.js"
import { JournalStore } from "../../workflow-journal/store.js"
import { OperationId } from "../../workflow/identity.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { makeIntegrationTargetResourceController } from "../admission/integration-target-resource.js"
import { reduceWorkflowJournalHistory } from "../reconstruction/history.js"
import { makeRunRecoveryProjection } from "../run/recovery-activation.js"
import { makeJournal } from "./journal.js"
import { deliveryRuntime } from "./delivery-runtime-adapter.js"
import { makeReactiveDeliveryRelationsLayer } from "./reactive-delivery-relations.js"

const runId = RunId.make("recovered-settlement-relation")
const trackerTarget = FixtureTarget.make("recovered-settlement-target")
const taskId = TaskId.make("A")
const baseSha = GitCommitSha.make("1".repeat(40))
const targetHead = GitCommitSha.make("2".repeat(40))
const acceptedCommit = GitCommitSha.make("3".repeat(40))
const candidateCommit = GitCommitSha.make("4".repeat(40))
const integrationTarget = IntegrationTarget.make({
  repository: GitRepositoryLocator.make("/repositories/recovered-settlement.git"),
  ref: IntegrationTargetRef.make("refs/heads/master")
})
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("recovered-settlement-attempt"),
  baseSha,
  branch: TaskBranchRef.make("refs/heads/dalph/recovered-settlement"),
  executor: TaskExecutorLocator.make("executor:recovered-settlement"),
  runId,
  taskId,
  taskRevision: TaskRevision.make("recovered-settlement-revision"),
  worktree: WorktreeLocator.make("/worktrees/recovered-settlement")
})
const claim = ActiveTaskClaim.make({
  operationId: OperationId.make("recovered-settlement-claim"),
  owner: ClaimOwner.make("dalph"),
  taskId,
  token: ClaimToken.make("recovered-settlement-token")
})
const acceptedResult = acceptedResultFixture(acceptedCommit)
const settlementTestLayer = Layer.merge(acceptedResultEvidenceLayer, legacyMemoryJournalStoreLayer)

const seedTerminalAccepted = Effect.gen(function* () {
  const journal = yield* JournalStore
  yield* journal.beginRun(
    runId,
    trackerTarget,
    InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
  )
  const claimOperation = makeTaskClaimAcquisitionOperation({ acquisition: claim, predecessorOperationIds: [] })
  yield* journal.append(
    runId,
    intentRecordKey(claim.operationId),
    TaskClaimAcquisitionIntendedEvent.make({ operation: claimOperation, version: workflowJournalEventVersion })
  )
  yield* journal.append(
    runId,
    outcomeRecordKey(claim.operationId),
    TaskClaimAcquiredEvent.make({ claim, version: workflowJournalEventVersion })
  )
  yield* journal.append(
    runId,
    attemptPlanRecordKey(plannedAttempt.attemptId),
    TaskAttemptPlannedEvent.make({
      operation: makeTaskAttemptPlanOperation({
        operationId: OperationId.make("recovered-settlement-plan"),
        plannedAttempt,
        predecessorOperationIds: [claim.operationId]
      }),
      version: workflowJournalEventVersion
    })
  )
  yield* journal.append(
    runId,
    plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId),
    PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({ plannedAttempt, version: workflowJournalEventVersion })
  )
  const commandOrdinal = PlannedAttemptExecutorCommandOrdinal.make(1)
  yield* journal.append(
    runId,
    plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, commandOrdinal),
    PlannedAttemptExecutorCommandIntendedEvent.make({
      command: "StartOrContinue",
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      ordinal: commandOrdinal,
      plannedAttempt,
      version: workflowJournalEventVersion
    })
  )
  const ordinal = PlannedAttemptExecutorReportOrdinal.make(1)
  yield* journal.append(
    runId,
    plannedAttemptExecutorWorkReportedRecordKey(plannedAttempt.attemptId, ordinal),
    PlannedAttemptExecutorWorkReportedEvent.make({
      ordinal,
      report: PlannedAttemptExecutorReport.cases.Terminal.make({
        correlation: { attemptId: plannedAttempt.attemptId, runId },
        result: { _tag: "Accepted", acceptedResult }
      }),
      version: workflowJournalEventVersion
    })
  )
  yield* registerAcceptedResultEvidence(plannedAttempt, acceptedResult)
  return journal
})

const installFreshTrackerFacts = Effect.fn("RecoveredSettlementTest.installFreshTrackerFacts")(function* (
  journalService: Effect.Success<ReturnType<typeof makeJournal>>
) {
  const graphRead = makeTrackerGraphObservationOperation(OperationId.make("recovered-settlement-graph"), trackerTarget)
  const projected = projectTrackerSnapshot({
    revision: "recovered-settlement-current",
    tasks: [{ id: taskId, lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }]
  })
  if (projected._tag === "Invalid") return yield* Effect.die("expected a valid current graph")
  yield* journalService.append(runId, intentRecordKey(graphRead.operationId), taskTrackerReadIntent(graphRead))
  yield* journalService.append(
    runId,
    outcomeRecordKey(graphRead.operationId),
    taskTrackerFactsObservedEvent(
      graphRead.operationId,
      makeCompleteTaskTrackerFactsObserved(graphRead, projected.snapshot)
    )
  )
  const claimRead = makeTaskClaimObservationOperation(
    OperationId.make("recovered-settlement-claim-read"),
    trackerTarget,
    taskId
  )
  yield* journalService.append(runId, intentRecordKey(claimRead.operationId), taskTrackerReadIntent(claimRead))
  yield* journalService.append(
    runId,
    outcomeRecordKey(claimRead.operationId),
    taskTrackerFactsObservedEvent(claimRead.operationId, makeFocusedTaskClaimFactsObserved(claimRead, claim))
  )
})

const recoveredDeliveryEvaluation = Effect.fn("RecoveredSettlementTest.readDelivery")(function* (
  holdStartedIntegration = false
) {
  const journal = yield* JournalStore
  const initial = reduceWorkflowJournalHistory(runId, yield* journal.read(runId))
  if (initial._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die(initial)
  const journalService = yield* makeJournal(runId, trackerTarget, initial, journal)
  const integrationResources = yield* makeIntegrationTargetResourceController()
  if (holdStartedIntegration) {
    const responsibility = deriveIntegrationAdmission(initial.runState.workflowHistory.records).responsibilities.find(
      (candidate) => candidate._tag === "StartedIntegrationResponsibility"
    )
    if (responsibility?._tag !== "StartedIntegrationResponsibility") return yield* Effect.die("missing start")
    yield* integrationResources.acquire(responsibility)
    yield* integrationResources.publishAcceptedOwnership(responsibility)
  }
  const recovery = yield* makeRunRecoveryProjection(
    runId,
    integrationTarget,
    CandidateCorrectionLimit.make(1),
    CandidateContinuationLimit.make(2),
    integrationResources
  )
  yield* installFreshTrackerFacts(journalService)
  const relations = yield* makeReactiveDeliveryRelationsLayer(
    runId,
    trackerTarget,
    journalService,
    recovery,
    integrationResources
  )
  const relation = yield* deliveryRuntime.pipe(Effect.provide(relations))
  return Option.getOrThrow(yield* relation.changes.pipe(Stream.runHead))
})

it.effect("restart after terminal append advances settlement proposals without repeating executor work", () =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* seedTerminalAccepted
      const evaluation = yield* recoveredDeliveryEvaluation()
      const proposals =
        evaluation.proposedActions._tag === "DeliveryProposalsAvailable" ? evaluation.proposedActions.proposals : []

      expect(proposals).toContainEqual(
        expect.objectContaining({
          route: expect.objectContaining({
            _tag: "IdentityFreeWorkflowRoute",
            transition: expect.objectContaining({ _tag: "QueueAcceptedResultIntegrationResponsibility" })
          })
        })
      )
      expect(
        proposals.some(
          ({ route }) =>
            route._tag === "IdentityFreeWorkflowRoute" &&
            (route.transition._tag === "ContinuePlannedAttemptExecutorWork" ||
              route.transition._tag === "SuspendPlannedAttemptExecutorWork")
        )
      ).toBe(false)
      expect(
        (yield* (yield* JournalStore).read(runId)).filter(
          ({ event }) => event._tag === "PlannedAttemptExecutorWorkReported"
        )
      ).toHaveLength(1)
    }).pipe(Effect.provide(settlementTestLayer))
  )
)

it.effect("legacy candidate construction cannot authorize an outer Integrator release", () =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* seedTerminalAccepted
      const queued = yield* queueAcceptedResultIntegrationResponsibility(
        plannedAttempt,
        acceptedResult,
        integrationTarget
      )
      const started = yield* startQueuedIntegration(queued)
      yield* continueIntegrationCandidateConstruction(
        started,
        TargetLineageObservation.make({
          plannedBaseIsAncestorOfTargetHead: true,
          plannedBaseSha: baseSha,
          targetHeadSha: targetHead
        }),
        CandidateCorrectionLimit.make(1),
        CandidateContinuationLimit.make(2)
      ).pipe(
        Effect.provideService(
          IntegrationCandidateAgent,
          IntegrationCandidateAgent.of({
            startOrContinue: (request) =>
              Effect.succeed(
                IntegrationCandidateAgentReport.cases.Submitted.make({
                  candidateCommit,
                  correlation: request.correlation,
                  reviewManifest: evidenceReferenceFixture
                })
              )
          })
        ),
        Effect.provideService(
          IntegrationCandidateGit,
          IntegrationCandidateGit.of({
            readSubmittedCommit: () =>
              Effect.succeed(
                IntegrationCandidateGitObservation.cases.Commit.make({ directParents: [targetHead, acceptedCommit] })
              )
          })
        )
      )
      const evaluation = yield* recoveredDeliveryEvaluation(true)
      const proposals =
        evaluation.proposedActions._tag === "DeliveryProposalsAvailable" ? evaluation.proposedActions.proposals : []
      expect(proposals).toEqual([])
    }).pipe(Effect.provide(settlementTestLayer))
  )
)

it.effect(
  "settlement relation reconstructs a recorded candidate outcome without another integration-agent request",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        yield* seedTerminalAccepted
        const queued = yield* queueAcceptedResultIntegrationResponsibility(
          plannedAttempt,
          acceptedResult,
          integrationTarget
        )
        const started = yield* startQueuedIntegration(queued)
        const agentRequests = yield* Ref.make(0)
        const constructed = yield* continueIntegrationCandidateConstruction(
          started,
          TargetLineageObservation.make({
            plannedBaseIsAncestorOfTargetHead: true,
            plannedBaseSha: baseSha,
            targetHeadSha: targetHead
          }),
          CandidateCorrectionLimit.make(1),
          CandidateContinuationLimit.make(2)
        ).pipe(
          Effect.provideService(
            IntegrationCandidateAgent,
            IntegrationCandidateAgent.of({
              startOrContinue: (request) =>
                Ref.update(agentRequests, (count) => count + 1).pipe(
                  Effect.as(
                    IntegrationCandidateAgentReport.cases.Submitted.make({
                      candidateCommit,
                      correlation: request.correlation,
                      reviewManifest: evidenceReferenceFixture
                    })
                  )
                )
            })
          ),
          Effect.provideService(
            IntegrationCandidateGit,
            IntegrationCandidateGit.of({
              readSubmittedCommit: () =>
                Effect.succeed(
                  IntegrationCandidateGitObservation.cases.Commit.make({ directParents: [targetHead, acceptedCommit] })
                )
            })
          )
        )
        expect(constructed._tag).toBe("CandidateConstructed")
        expect(yield* Ref.get(agentRequests)).toBe(1)

        const evaluation = yield* recoveredDeliveryEvaluation()
        const proposals =
          evaluation.proposedActions._tag === "DeliveryProposalsAvailable" ? evaluation.proposedActions.proposals : []
        expect(
          proposals.some(
            ({ route }) =>
              route._tag === "IdentityFreeWorkflowRoute" &&
              route.transition._tag === "ContinueStartedIntegrationCandidate"
          )
        ).toBe(false)
        expect(evaluation.current.settlements.settlements).toEqual([])
        expect(yield* Ref.get(agentRequests)).toBe(1)
      }).pipe(Effect.provide(settlementTestLayer))
    )
)

it.effect("restart uses the outer Integrator at a fresh target head instead of legacy candidate verification", () =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* seedTerminalAccepted
      const queued = yield* queueAcceptedResultIntegrationResponsibility(
        plannedAttempt,
        acceptedResult,
        integrationTarget
      )
      const started = yield* startQueuedIntegration(queued)
      yield* continueIntegrationCandidateConstruction(
        started,
        TargetLineageObservation.make({
          plannedBaseIsAncestorOfTargetHead: true,
          plannedBaseSha: baseSha,
          targetHeadSha: targetHead
        }),
        CandidateCorrectionLimit.make(1),
        CandidateContinuationLimit.make(2)
      ).pipe(
        Effect.provideService(
          IntegrationCandidateAgent,
          IntegrationCandidateAgent.of({
            startOrContinue: (request) =>
              Effect.succeed(
                IntegrationCandidateAgentReport.cases.Submitted.make({
                  candidateCommit,
                  correlation: request.correlation,
                  reviewManifest: evidenceReferenceFixture
                })
              )
          })
        ),
        Effect.provideService(
          IntegrationCandidateGit,
          IntegrationCandidateGit.of({
            readSubmittedCommit: () =>
              Effect.succeed(
                IntegrationCandidateGitObservation.cases.Commit.make({ directParents: [targetHead, acceptedCommit] })
              )
          })
        )
      )

      const journal = yield* JournalStore
      const initial = reduceWorkflowJournalHistory(runId, yield* journal.read(runId))
      if (initial._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die(initial)
      const journalService = yield* makeJournal(runId, trackerTarget, initial, journal)
      const resources = yield* makeIntegrationTargetResourceController()
      const responsibility = deriveIntegrationAdmission(initial.runState.workflowHistory.records).responsibilities.find(
        (candidate) => candidate._tag === "StartedIntegrationResponsibility"
      )
      if (responsibility?._tag !== "StartedIntegrationResponsibility") return yield* Effect.die("missing start")
      const recovery = yield* makeRunRecoveryProjection(
        runId,
        integrationTarget,
        CandidateCorrectionLimit.make(1),
        CandidateContinuationLimit.make(2),
        resources
      )
      yield* installFreshTrackerFacts(journalService)
      expect((yield* recovery.readDeliveryProjection).frontier.transitions).toContainEqual(
        expect.objectContaining({ _tag: "AcquireStartedIntegrationTarget" })
      )
      yield* resources.acquire(responsibility)
      yield* resources.publishAcceptedOwnership(responsibility)
      const blockedRead = makeTrackerGraphObservationOperation(
        OperationId.make("recovered-verification-blocked-graph"),
        trackerTarget
      )
      const blocked = projectTrackerSnapshot({
        revision: "recovered-verification-blocked",
        tasks: [
          { id: TaskId.make("B"), lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] },
          { id: taskId, lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [TaskId.make("B")] }
        ]
      })
      if (blocked._tag === "Invalid") return yield* Effect.die("expected valid blocked graph")
      yield* journalService.append(runId, intentRecordKey(blockedRead.operationId), taskTrackerReadIntent(blockedRead))
      yield* journalService.append(
        runId,
        outcomeRecordKey(blockedRead.operationId),
        taskTrackerFactsObservedEvent(
          blockedRead.operationId,
          makeCompleteTaskTrackerFactsObserved(blockedRead, blocked.snapshot)
        )
      )
      expect((yield* recovery.readDeliveryProjection).frontier.transitions).toContainEqual(
        expect.objectContaining({ _tag: "ReleaseStartedIntegrationTarget" })
      )
      yield* resources.release(responsibility)
      const waitingWithoutLease = (yield* recovery.readDeliveryProjection).frontier.transitions
      expect(waitingWithoutLease).not.toContainEqual(
        expect.objectContaining({ _tag: "AcquireStartedIntegrationTarget" })
      )
      const reconfirmRead = makeTrackerGraphObservationOperation(
        OperationId.make("recovered-verification-graph-after-claim"),
        trackerTarget
      )
      const reconfirmed = projectTrackerSnapshot({
        revision: "recovered-verification-current",
        tasks: [{ id: taskId, lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }]
      })
      if (reconfirmed._tag === "Invalid") return yield* Effect.die("expected valid reconfirmed graph")
      yield* journalService.append(
        runId,
        intentRecordKey(reconfirmRead.operationId),
        taskTrackerReadIntent(reconfirmRead)
      )
      yield* journalService.append(
        runId,
        outcomeRecordKey(reconfirmRead.operationId),
        taskTrackerFactsObservedEvent(
          reconfirmRead.operationId,
          makeCompleteTaskTrackerFactsObserved(reconfirmRead, reconfirmed.snapshot)
        )
      )
      expect((yield* recovery.readDeliveryProjection).frontier.transitions).toContainEqual(
        expect.objectContaining({ _tag: "AcquireStartedIntegrationTarget" })
      )
      yield* resources.acquire(responsibility)
      yield* resources.publishAcceptedOwnership(responsibility)
      expect((yield* recovery.readDeliveryProjection).frontier.transitions).toContainEqual(
        expect.objectContaining({ _tag: "ObservePlannedAttemptContinuationTargetLineage" })
      )

      const lineageRead = makeTargetLineageObservationOperation({
        integrationTarget,
        operationId: OperationId.make("recovered-verification-current-head"),
        plannedAttempt,
        predecessorOperationIds: []
      })
      yield* journalService.append(
        runId,
        intentRecordKey(lineageRead.operationId),
        GitReadIntentRecordedEvent.make({
          initiatedBy: { _tag: "DalphCoordinator" },
          occurrenceClassification: "InitiatedAction",
          operation: lineageRead,
          version: workflowJournalEventVersion
        })
      )
      yield* journalService.append(
        runId,
        outcomeRecordKey(lineageRead.operationId),
        TargetLineageObservedEvent.make({
          observation: TargetLineageObservation.make({
            plannedBaseIsAncestorOfTargetHead: true,
            plannedBaseSha: baseSha,
            targetHeadSha: targetHead
          }),
          occurrenceClassification: "NonActionOccurrence",
          operationId: lineageRead.operationId,
          plannedAttempt,
          version: workflowJournalEventVersion
        })
      )
      const rewrittenLineageRead = makeTargetLineageObservationOperation({
        integrationTarget,
        operationId: OperationId.make("recovered-verification-rewritten-head"),
        plannedAttempt,
        predecessorOperationIds: []
      })
      yield* journalService.append(
        runId,
        intentRecordKey(rewrittenLineageRead.operationId),
        GitReadIntentRecordedEvent.make({
          initiatedBy: { _tag: "DalphCoordinator" },
          occurrenceClassification: "InitiatedAction",
          operation: rewrittenLineageRead,
          version: workflowJournalEventVersion
        })
      )
      yield* journalService.append(
        runId,
        outcomeRecordKey(rewrittenLineageRead.operationId),
        TargetLineageObservedEvent.make({
          observation: TargetLineageObservation.make({
            plannedBaseIsAncestorOfTargetHead: true,
            plannedBaseSha: baseSha,
            targetHeadSha: GitCommitSha.make("5".repeat(40))
          }),
          occurrenceClassification: "NonActionOccurrence",
          operationId: rewrittenLineageRead.operationId,
          plannedAttempt,
          version: workflowJournalEventVersion
        })
      )
      const current = yield* recovery.readDeliveryProjection
      expect(current.frontier.transitions).toContainEqual(
        expect.objectContaining({
          _tag: "RunIntegrator",
          lineage: expect.objectContaining({ targetHeadSha: GitCommitSha.make("5".repeat(40)) })
        })
      )
      expect(current.frontier.transitions).not.toContainEqual(
        expect.objectContaining({ _tag: "ContinueStartedIntegrationCandidate" })
      )
      expect(current.frontier.transitions).not.toContainEqual(
        expect.objectContaining({ _tag: "RunTargetVerification" })
      )
      expect(reduceWorkflowJournalHistory(runId, yield* journal.read(runId))._tag).toBe("ValidWorkflowJournalHistory")
    }).pipe(Effect.provide(settlementTestLayer))
  )
)
