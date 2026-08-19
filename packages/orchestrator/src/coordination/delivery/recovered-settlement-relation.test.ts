import {
  acceptedResultEvidenceLayer,
  acceptedResultFixture,
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
import { Effect, Layer, Option, Stream } from "effect"
import { expect } from "vitest"
import { ClaimOwner, ClaimToken } from "../../authorities/task-tracker/claim.js"
import { ActiveTaskClaim } from "../../authorities/task-tracker/claim-mutation.js"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { projectTrackerSnapshot } from "../../authorities/task-tracker/graph.js"
import { InitialControlPolicy } from "../../control/policy.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import {
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  taskTrackerReadIntent
} from "../../workflow/registry/event.js"
import {
  makeTaskAttemptPlanOperation,
  makeTaskClaimAcquisitionOperation,
  makeTaskClaimObservationOperation,
  makeTrackerGraphObservationOperation
} from "../../workflow/registry/operation.js"
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
import { memoryJournalTestLayer } from "../../workflow-journal/adapters/memory-store.js"
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
const acceptedCommit = GitCommitSha.make("3".repeat(40))
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
const settlementTestLayer = Layer.merge(acceptedResultEvidenceLayer, memoryJournalTestLayer)

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

const recoveredDeliveryEvaluation = Effect.fn("RecoveredSettlementTest.readDelivery")(function* () {
  const journal = yield* JournalStore
  const initial = reduceWorkflowJournalHistory(runId, yield* journal.read(runId))
  if (initial._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die(initial)
  const journalService = yield* makeJournal(runId, trackerTarget, initial, journal)
  const integrationResources = yield* makeIntegrationTargetResourceController()
  const recovery = yield* makeRunRecoveryProjection(runId, integrationTarget, integrationResources)
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
