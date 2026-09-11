import { it } from "@effect/vitest"
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
  WorktreeLocator,
  plannedAttemptExecutorCorrelation,
  makeTaskWorkSpecification
} from "@dalph/contracts"
import { Cause, Deferred, Effect, Fiber, Layer, Option, Ref, Stream } from "effect"
import { expect } from "vitest"
import { PlannedWorktreeReady } from "../../authorities/git/worktree.js"
import { validSnapshot } from "../../../test/task-dag.js"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { ClaimOwner, ClaimToken } from "../../authorities/task-tracker/claim.js"
import { ActiveTaskClaim } from "../../authorities/task-tracker/claim-mutation.js"
import { projectTrackerSnapshot } from "../../authorities/task-tracker/graph.js"
import { InitialControlPolicy } from "../../control/policy.js"
import { TrackerRevision } from "../../authorities/task-tracker/task.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import { OperationId } from "../../workflow/identity.js"
import {
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  TaskWorktreeReadyEvent,
  TaskWorktreeReconciliationIntendedEvent,
  taskTrackerReadIntent
} from "../../workflow/registry/event.js"
import {
  makeTaskAttemptPlanOperation,
  makeTaskClaimAcquisitionOperation,
  makeTaskClaimReleaseOperation,
  makeTrackerGraphObservationOperation,
  makeTaskWorkSpecificationObservationOperation,
  makeTaskWorktreeReconciliationOperation,
  TaskClaimReleaseAuthority
} from "../../workflow/registry/operation.js"
import {
  makeCompleteTaskTrackerFactsObserved,
  makeFocusedTaskWorkSpecificationFactsObserved,
  taskTrackerFactsObservedEvent
} from "../../workflow/task-tracker-facts/observation.js"
import { makeTaskTrackerFactsObservedFromRead } from "../../workflow/protocols/task-tracker-read/protocol.js"
import { memoryJournalStoreLayer } from "../../workflow-journal/adapters/memory-store.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import {
  attemptPlanRecordKey,
  controlDirectionAppliedRecordKey,
  intentRecordKey,
  outcomeRecordKey,
  plannedAttemptExecutorCommandIntendedRecordKey,
  plannedAttemptExecutorCommandProjectionObservedRecordKey,
  plannedAttemptExecutorCommandResponseObservedRecordKey,
  plannedAttemptExecutorStateObservedRecordKey,
  plannedAttemptExecutorWorkReportedRecordKey,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey
} from "../../workflow-journal/record-key.js"
import { InRunJournal, JournalHistoryInvalid, type JournalRecord, JournalStore } from "../../workflow-journal/store.js"
import {
  ControlDirectionApplicationOrdinal,
  ControlDirectionAppliedEvent
} from "../../workflow/protocols/control-direction-application/events.js"
import {
  PlannedAttemptExecutorCommandIntendedEvent,
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorCommandProjectionObservedEvent,
  PlannedAttemptExecutorCommandProjectionObservation,
  PlannedAttemptExecutorCommandProjectionOrdinal,
  PlannedAttemptExecutorCommandResponseObservedEvent,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorStateObservation,
  PlannedAttemptExecutorStateObservationOrdinal,
  PlannedAttemptExecutorStateObservedEvent,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent
} from "../../workflow/protocols/planned-attempt-executor-work/events.js"
import { plannedAttemptProtocolControllerLayer } from "../../workflow/protocols/planned-attempt-executor-work/protocol-controller.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { makeIntegrationTargetResourceController } from "../admission/integration-target-resource.js"
import { RunnableFrontierTransition } from "../frontier/frontier.js"
import { hasUnconsumedAcceptedSafeTaskReopenFromExecutingWorkAuthorityCheck } from "../frontier/safe-continuation-revalidation-eligibility.js"
import { reduceWorkflowJournalHistory } from "../reconstruction/history.js"
import {
  makeRunRecoveryProjection,
  readDeliveryProjectionFrom,
  RunRecoveryProjectionRunMismatch,
  type RunRecoveryProjectionSource
} from "../run/recovery-activation.js"
import { type JournalState, makeJournal } from "./journal.js"
import { delivery } from "./delivery.js"
import { DeliveryAcceptedFactPublication } from "./delivery-accepted-fact-publication.js"
import {
  DeliveryRelationPublicationObserver,
  evaluateDeliveryRelationInputBundle
} from "./delivery-publication-observer.js"
import { deliveryProposalsOf } from "./delivery-proposal-derivation.js"
import { makeDeliveryRuntimeAdmissionController } from "./delivery-runtime-admission.js"
import { makeApplicationExitLifecycle } from "../application-exit/lifecycle.js"
import { deliveryRuntime } from "./delivery-runtime-adapter.js"
import { journalEvidenceFrom } from "../../workflow-journal/record-evidence.js"
import {
  materializeJournalRecords,
  observeJournalRecordSequenceOperations
} from "../../workflow-journal/record-sequence.js"
import { deliveryRuntimeResourcesLayer } from "./delivery-runtime-resources.js"
import {
  DeliveryControlPolicyMissing,
  makeReactiveDeliveryRelationsLayer as makeProductionReactiveDeliveryRelationsLayer,
  reactiveDeliveryRelationsLayer
} from "./reactive-delivery-relations.js"
import { DeliveryRelationReconciliationError } from "./relations.js"
import type { DeliveryRelationInputBundle } from "./relations.js"

const runId = RunId.make("reactive-delivery-coherent-reconstruction")
const target = FixtureTarget.make("reactive-delivery-coherent-reconstruction-target")
const integrationTarget = IntegrationTarget.make({
  ref: IntegrationTargetRef.make("refs/heads/main"),
  repository: GitRepositoryLocator.make("/repositories/reactive-delivery.git")
})
const policy = InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
const recoveredSpecification = makeTaskWorkSpecification({
  body: "Continue the recovered reactive-delivery task.",
  taskId: TaskId.make("recovered-task"),
  title: "Recovered reactive-delivery task"
})
const recoveredAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("reactive-delivery-recovered-attempt"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/reactive-delivery-recovered"),
  executor: TaskExecutorLocator.make("executor:reactive-delivery-test"),
  runId,
  taskId: TaskId.make("recovered-task"),
  taskRevision: TaskRevision.make(recoveredSpecification.fingerprint),
  worktree: WorktreeLocator.make("/worktrees/reactive-delivery-recovered")
})
const recoveredClaim = ActiveTaskClaim.make({
  operationId: OperationId.make("reactive-delivery-recovered-claim"),
  owner: ClaimOwner.make("reactive-delivery-test"),
  taskId: recoveredAttempt.taskId,
  token: ClaimToken.make("reactive-delivery-recovered-token")
})
const recoveredClaimOperation = makeTaskClaimAcquisitionOperation({
  acquisition: recoveredClaim,
  predecessorOperationIds: []
})
const recoveredGraphOperation = makeTrackerGraphObservationOperation(
  { _tag: "WorkflowEstablishment" },
  OperationId.make("reactive-delivery-recovered-graph"),
  target,
  [recoveredClaim.operationId],
  [recoveredAttempt.taskId]
)
const recoveredSpecificationOperation = makeTaskWorkSpecificationObservationOperation(
  OperationId.make("reactive-delivery-recovered-specification"),
  target,
  recoveredAttempt.taskId,
  [recoveredGraphOperation.operationId]
)
const recoveredPlanOperation = makeTaskAttemptPlanOperation({
  operationId: OperationId.make("reactive-delivery-recovered-plan"),
  plannedAttempt: recoveredAttempt,
  predecessorOperationIds: [recoveredSpecificationOperation.operationId]
})
const recoveredWorktreeOperation = makeTaskWorktreeReconciliationOperation({
  operationId: OperationId.make("reactive-delivery-recovered-worktree"),
  plannedAttempt: recoveredAttempt,
  predecessorOperationIds: [recoveredPlanOperation.operationId]
})

type ExecutorResponsibilityFixture = {
  readonly attempt: PlannedTaskAttempt
  readonly claim: ActiveTaskClaim
  readonly claimOperation: ReturnType<typeof makeTaskClaimAcquisitionOperation>
  readonly graphOperation: ReturnType<typeof makeTrackerGraphObservationOperation>
  readonly planOperation: ReturnType<typeof makeTaskAttemptPlanOperation>
  readonly specification: typeof recoveredSpecification
  readonly specificationOperation: ReturnType<typeof makeTaskWorkSpecificationObservationOperation>
  readonly worktreeOperation: ReturnType<typeof makeTaskWorktreeReconciliationOperation>
}

const recoveredExecutorResponsibilityFixture: ExecutorResponsibilityFixture = {
  attempt: recoveredAttempt,
  claim: recoveredClaim,
  claimOperation: recoveredClaimOperation,
  graphOperation: recoveredGraphOperation,
  planOperation: recoveredPlanOperation,
  specification: recoveredSpecification,
  specificationOperation: recoveredSpecificationOperation,
  worktreeOperation: recoveredWorktreeOperation
}

const makeJournalService = Effect.gen(function* () {
  const storage = yield* JournalStore
  yield* storage.beginRun(runId, target, policy)
  const initial = reduceWorkflowJournalHistory(runId, yield* storage.read(runId))
  if (initial._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die(initial)
  return yield* makeJournal(runId, target, initial, storage)
})

const appendExecutorResponsibility = Effect.fn("ReactiveDeliveryTest.appendExecutorResponsibility")(function* (
  journal: Effect.Success<typeof makeJournalService>,
  fixture: ExecutorResponsibilityFixture = recoveredExecutorResponsibilityFixture
) {
  const worktreeProof = PlannedWorktreeReady.make({
    baseSha: fixture.attempt.baseSha,
    branch: fixture.attempt.branch,
    headSha: fixture.attempt.baseSha,
    worktree: fixture.attempt.worktree
  })
  yield* journal.append(
    runId,
    intentRecordKey(fixture.claim.operationId),
    TaskClaimAcquisitionIntendedEvent.make({ operation: fixture.claimOperation, version: workflowJournalEventVersion })
  )
  yield* journal.append(
    runId,
    outcomeRecordKey(fixture.claim.operationId),
    TaskClaimAcquiredEvent.make({ claim: fixture.claim, version: workflowJournalEventVersion })
  )
  yield* journal.append(
    runId,
    intentRecordKey(fixture.graphOperation.operationId),
    taskTrackerReadIntent(fixture.graphOperation)
  )
  yield* journal.append(
    runId,
    outcomeRecordKey(fixture.graphOperation.operationId),
    taskTrackerFactsObservedEvent(
      fixture.graphOperation.operationId,
      makeCompleteTaskTrackerFactsObserved(
        fixture.graphOperation,
        validSnapshot({
          revision: `${fixture.graphOperation.operationId}-revision`,
          tasks: [{ id: fixture.attempt.taskId, lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }]
        })
      )
    )
  )
  yield* journal.append(
    runId,
    intentRecordKey(fixture.specificationOperation.operationId),
    taskTrackerReadIntent(fixture.specificationOperation)
  )
  yield* journal.append(
    runId,
    outcomeRecordKey(fixture.specificationOperation.operationId),
    taskTrackerFactsObservedEvent(
      fixture.specificationOperation.operationId,
      makeFocusedTaskWorkSpecificationFactsObserved(fixture.specificationOperation, fixture.specification)
    )
  )
  yield* journal.append(
    runId,
    attemptPlanRecordKey(fixture.attempt.attemptId),
    TaskAttemptPlannedEvent.make({ operation: fixture.planOperation, version: workflowJournalEventVersion })
  )
  yield* journal.append(
    runId,
    intentRecordKey(fixture.worktreeOperation.operationId),
    TaskWorktreeReconciliationIntendedEvent.make({
      operation: fixture.worktreeOperation,
      version: workflowJournalEventVersion
    })
  )
  yield* journal.append(
    runId,
    outcomeRecordKey(fixture.worktreeOperation.operationId),
    TaskWorktreeReadyEvent.make({
      operationId: fixture.worktreeOperation.operationId,
      proof: worktreeProof,
      version: workflowJournalEventVersion
    })
  )
  yield* journal.append(
    runId,
    plannedAttemptExecutorWorkResponsibilityBeganRecordKey(fixture.attempt.attemptId),
    PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
      plannedAttempt: fixture.attempt,
      version: workflowJournalEventVersion
    })
  )
})

const appendExecutorCommand = Effect.fn("ReactiveDeliveryTest.appendExecutorCommand")(function* (
  journal: Effect.Success<typeof makeJournalService>,
  ordinal: number,
  command: "Begin" | "Resume" | "Suspend",
  plannedAttempt: PlannedTaskAttempt = recoveredAttempt
) {
  const commandOrdinal = PlannedAttemptExecutorCommandOrdinal.make(ordinal)
  yield* journal.append(
    runId,
    plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, commandOrdinal),
    PlannedAttemptExecutorCommandIntendedEvent.make({
      command,
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      ordinal: commandOrdinal,
      plannedAttempt,
      version: workflowJournalEventVersion
    })
  )
})

const appendCommandResponse = Effect.fn("ReactiveDeliveryTest.appendCommandResponse")(function* (
  journal: Effect.Success<typeof makeJournalService>,
  report: PlannedAttemptExecutorReport,
  commandOrdinalValue = 1,
  plannedAttempt: PlannedTaskAttempt = recoveredAttempt
) {
  const commandOrdinal = PlannedAttemptExecutorCommandOrdinal.make(commandOrdinalValue)
  yield* journal.append(
    runId,
    plannedAttemptExecutorCommandResponseObservedRecordKey(plannedAttempt.attemptId, commandOrdinal),
    PlannedAttemptExecutorCommandResponseObservedEvent.make({
      commandOrdinal,
      occurrenceClassification: "NonActionOccurrence",
      plannedAttempt,
      report,
      version: workflowJournalEventVersion
    })
  )
})

const appendDirectExecutorReport = Effect.fn("ReactiveDeliveryTest.appendDirectExecutorReport")(function* (
  journal: Effect.Success<typeof makeJournalService>,
  report: PlannedAttemptExecutorReport,
  ordinal: number,
  plannedAttempt: PlannedTaskAttempt = recoveredAttempt
) {
  const reportOrdinal = PlannedAttemptExecutorReportOrdinal.make(ordinal)
  yield* journal.append(
    runId,
    plannedAttemptExecutorWorkReportedRecordKey(plannedAttempt.attemptId, reportOrdinal),
    PlannedAttemptExecutorWorkReportedEvent.make({
      ordinal: reportOrdinal,
      report,
      version: workflowJournalEventVersion
    })
  )
})

const appendAcceptedExecutingExecutorHistory = Effect.fn("ReactiveDeliveryTest.appendAcceptedExecutingExecutorHistory")(
  function* (
    journal: Effect.Success<typeof makeJournalService>,
    fixture: ExecutorResponsibilityFixture = recoveredExecutorResponsibilityFixture
  ) {
    yield* appendExecutorResponsibility(journal, fixture)
    yield* appendExecutorCommand(journal, 1, "Begin", fixture.attempt)
    const executingReport = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
      correlation: plannedAttemptExecutorCorrelation(fixture.attempt)
    })
    yield* appendCommandResponse(journal, executingReport, 1, fixture.attempt)
    yield* appendDirectExecutorReport(journal, executingReport, 1, fixture.attempt)
  }
)

const appendRecoveredTaskGraph = Effect.fn("ReactiveDeliveryTest.appendRecoveredTaskGraph")(function* (
  journal: Effect.Success<typeof makeJournalService>,
  operationId: OperationId,
  predecessorOperationId: OperationId,
  lifecycle: "Open" | "TerminalWithoutSuccess",
  cause: Parameters<typeof makeTrackerGraphObservationOperation>[0] = { _tag: "ExecutingWorkAuthorityCheck" },
  explicitlyCoveredTaskIds: ReadonlyArray<TaskId> = [
    lifecycle === "Open" ? TaskId.make("unrelated-active-task") : recoveredAttempt.taskId
  ]
) {
  const operation = makeTrackerGraphObservationOperation(
    cause,
    operationId,
    target,
    [predecessorOperationId],
    explicitlyCoveredTaskIds
  )
  yield* journal.append(runId, intentRecordKey(operation.operationId), taskTrackerReadIntent(operation))
  yield* journal.append(
    runId,
    outcomeRecordKey(operation.operationId),
    taskTrackerFactsObservedEvent(
      operation.operationId,
      makeCompleteTaskTrackerFactsObserved(
        operation,
        validSnapshot({
          revision: `${operationId}-revision`,
          tasks: [
            { id: recoveredAttempt.taskId, lifecycle: { _tag: lifecycle }, parentTaskId: null, prerequisiteIds: [] }
          ]
        })
      )
    )
  )
  return operation
})

const appendCommandProjection = Effect.fn("ReactiveDeliveryTest.appendCommandProjection")(function* (
  journal: Effect.Success<typeof makeJournalService>,
  report: PlannedAttemptExecutorReport,
  commandOrdinalValue = 1
) {
  const commandOrdinal = PlannedAttemptExecutorCommandOrdinal.make(commandOrdinalValue)
  const projectionOrdinal = PlannedAttemptExecutorCommandProjectionOrdinal.make(1)
  yield* journal.append(
    runId,
    plannedAttemptExecutorCommandProjectionObservedRecordKey(
      recoveredAttempt.attemptId,
      commandOrdinal,
      projectionOrdinal
    ),
    PlannedAttemptExecutorCommandProjectionObservedEvent.make({
      commandOrdinal,
      observation: PlannedAttemptExecutorCommandProjectionObservation.cases.ExactExecutorReport.make({ report }),
      occurrenceClassification: "NonActionOccurrence",
      plannedAttempt: recoveredAttempt,
      projectionOrdinal,
      version: workflowJournalEventVersion
    })
  )
})

const appendStateProjection = Effect.fn("ReactiveDeliveryTest.appendStateProjection")(function* (
  journal: Effect.Success<typeof makeJournalService>,
  observation: PlannedAttemptExecutorStateObservation
) {
  const ordinal = PlannedAttemptExecutorStateObservationOrdinal.make(1)
  yield* journal.append(
    runId,
    plannedAttemptExecutorStateObservedRecordKey(recoveredAttempt.attemptId, ordinal),
    PlannedAttemptExecutorStateObservedEvent.make({
      observation,
      occurrenceClassification: "NonActionOccurrence",
      ordinal,
      plannedAttempt: recoveredAttempt,
      version: workflowJournalEventVersion
    })
  )
})

const nextAttemptProposal = () => {
  const nextAttempt = PlannedTaskAttempt.make({
    ...recoveredAttempt,
    attemptId: AttemptId.make("reactive-delivery-next-attempt"),
    branch: TaskBranchRef.make("refs/heads/dalph/reactive-delivery-next"),
    worktree: WorktreeLocator.make("/worktrees/reactive-delivery-next")
  })
  const transition = RunnableFrontierTransition.ObservePlannedAttemptExecutorWork({
    acceptedProgress: { _tag: "ExecutorResponsibilityBegan", acceptedAt: JournalPosition.make(1) },
    plannedAttempt: nextAttempt
  })
  const proposals = deliveryProposalsOf({
    acceptedOperationIds: new Set(),
    fresh: [],
    runId,
    transitions: [transition]
  })
  return Option.getOrThrow(Option.fromUndefinedOr(proposals.ticketDelivery[0]))
}

const currentProjection = (stateGet: Effect.Effect<JournalState>) => ({
  readDeliveryProjection: stateGet.pipe(
    Effect.map((journalState) => ({
      evidence: {
        _tag: "AvailableDeliveryProjectionEvidence" as const,
        acceptedAt: journalState.position,
        facts: [],
        integrationWaits: []
      },
      frontier: { explanations: [], transitions: [] }
    }))
  ),
  reconstructedPlannedAttemptPositions: []
})

const unavailableProjection = {
  readDeliveryProjection: Effect.succeed({
    evidence: { _tag: "UnavailableDeliveryProjectionEvidence" as const },
    frontier: { explanations: [], transitions: [] }
  }),
  reconstructedPlannedAttemptPositions: []
}

const makeReactiveDeliveryRelationsLayer = (
  runId: Parameters<typeof makeProductionReactiveDeliveryRelationsLayer>[0],
  target: Parameters<typeof makeProductionReactiveDeliveryRelationsLayer>[1],
  journal: Parameters<typeof makeProductionReactiveDeliveryRelationsLayer>[2],
  recovery: Parameters<typeof makeProductionReactiveDeliveryRelationsLayer>[3]
) =>
  Effect.gen(function* () {
    const integrationTargets = yield* makeIntegrationTargetResourceController()
    // These subscription-level fixtures all enter their single activation at
    // WorkflowRunBegan (p1), including subscriptions acquired after a graph.
    return yield* makeProductionReactiveDeliveryRelationsLayer(
      runId,
      target,
      journal,
      recovery,
      integrationTargets,
      JournalPosition.make(1)
    )
  })

const testDeliveryRuntimeResourcesLayer = Layer.unwrap(
  makeApplicationExitLifecycle().pipe(Effect.map((lifecycle) => deliveryRuntimeResourcesLayer(lifecycle.admission)))
)

it.effect("records the initial and later exact production bundles without changing their delivery source chain", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const journal = yield* makeJournalService
      const observed = yield* Ref.make<ReadonlyArray<DeliveryRelationInputBundle>>([])
      const establishedSeen = yield* Deferred.make<void>()
      const observer = DeliveryRelationPublicationObserver.of({
        observe: (bundle) =>
          Ref.update(observed, (bundles) => [...bundles, bundle]).pipe(
            Effect.andThen(
              bundle.publication.graph._tag === "GraphEstablished"
                ? Deferred.succeed(establishedSeen, undefined)
                : Effect.void
            )
          )
      })
      const layer = yield* makeReactiveDeliveryRelationsLayer(
        runId,
        target,
        journal,
        currentProjection(journal.state.get.pipe(Effect.orDie))
      ).pipe(Effect.provideService(DeliveryRelationPublicationObserver, observer))
      const operation = makeTrackerGraphObservationOperation(
        { _tag: "WorkflowEstablishment" },
        OperationId.make("observed-production-bundle"),
        target
      )
      const projected = projectTrackerSnapshot({
        revision: "observed-production-revision",
        tasks: [{ id: TaskId.make("A"), lifecycle: { _tag: "Open" as const }, parentTaskId: null, prerequisiteIds: [] }]
      })
      if (projected._tag === "Invalid") return yield* Effect.die(projected)

      yield* journal.append(runId, intentRecordKey(operation.operationId), taskTrackerReadIntent(operation))
      yield* journal.append(
        runId,
        outcomeRecordKey(operation.operationId),
        taskTrackerFactsObservedEvent(
          operation.operationId,
          makeCompleteTaskTrackerFactsObserved(operation, projected.snapshot)
        )
      )
      yield* Deferred.await(establishedSeen)

      const bundles = yield* Ref.get(observed)
      expect(bundles[0]?.publication.graph._tag).toBe("GraphNotEstablished")
      const established = bundles.find(({ publication }) => publication.graph._tag === "GraphEstablished")
      if (established === undefined) return expect.fail("expected established production bundle")
      const consequences = yield* evaluateDeliveryRelationInputBundle(established)
      expect(consequences.graph).toBe(established.publication.graph)
      expect(consequences.frontier.source).toBe(consequences.graph)
      expect(consequences.tickets.source).toBe(consequences.frontier)
      expect(consequences.ticketDeliveries.source).toBe(consequences.tickets)
      expect(consequences.settlements.source).toBe(consequences.ticketDeliveries)
      expect(consequences.trackerConsequences.source).toBe(consequences.settlements)
      const current = yield* delivery.pipe(
        Effect.provide(layer),
        Effect.flatMap((signal) => signal.get)
      )
      expect(current.graph._tag).toBe("GraphEstablished")
    }).pipe(Effect.provide(memoryJournalStoreLayer))
  )
)

it.effect("requires a new activation graph without discarding the shared accepted prefix", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const journal = yield* makeJournalService
      const appendGraph = Effect.fn("ReactiveDeliveryTest.appendActivationGraph")(function* (id: string) {
        const operation = makeTrackerGraphObservationOperation(
          { _tag: "WorkflowEstablishment" },
          OperationId.make(id),
          target
        )
        const projected = projectTrackerSnapshot({
          revision: id,
          tasks: [
            { id: TaskId.make("A"), lifecycle: { _tag: "Open" as const }, parentTaskId: null, prerequisiteIds: [] }
          ]
        })
        if (projected._tag === "Invalid") return yield* Effect.die(projected)
        yield* journal.append(runId, intentRecordKey(operation.operationId), taskTrackerReadIntent(operation))
        return yield* journal.append(
          runId,
          outcomeRecordKey(operation.operationId),
          taskTrackerFactsObservedEvent(
            operation.operationId,
            makeCompleteTaskTrackerFactsObserved(operation, projected.snapshot)
          )
        )
      })
      yield* appendGraph("prior-activation-graph")
      const before = yield* journal.readAccepted(runId)
      const integrationTargets = yield* makeIntegrationTargetResourceController()
      const layer = yield* makeProductionReactiveDeliveryRelationsLayer(
        runId,
        target,
        journal,
        currentProjection(journal.state.get.pipe(Effect.orDie)),
        integrationTargets,
        (yield* journal.state.get).position
      )
      const relation = yield* delivery.pipe(Effect.provide(layer))
      expect((yield* relation.get).graph._tag).toBe("GraphNotEstablished")
      expect(yield* journal.readAccepted(runId)).toBe(before)
      expect((yield* journal.state.get).graph._tag).toBe("GraphEstablished")
      yield* appendGraph("current-activation-graph")
      const publication = yield* DeliveryAcceptedFactPublication.pipe(Effect.provide(layer))
      yield* publication.awaitCurrent
      expect((yield* relation.get).graph._tag).toBe("GraphEstablished")
    }).pipe(Effect.provide(memoryJournalStoreLayer))
  )
)

it.effect("keeps foreign tracker facts out of the target-bound public delivery relation", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const journal = yield* makeJournalService
      const foreignTarget = FixtureTarget.make("reactive-delivery-foreign-target")
      const appendGraph = Effect.fn("ReactiveDeliveryTest.appendTargetGraph")(function* (
        operationId: OperationId,
        graphTarget: typeof target,
        revision: string,
        taskIds: ReadonlyArray<string>
      ) {
        const operation = makeTrackerGraphObservationOperation(
          { _tag: "WorkflowEstablishment" },
          operationId,
          graphTarget
        )
        const projected = projectTrackerSnapshot({
          revision,
          tasks: taskIds.map((id) => ({
            id: TaskId.make(id),
            lifecycle: { _tag: "Open" as const },
            parentTaskId: null,
            prerequisiteIds: []
          }))
        })
        if (projected._tag === "Invalid") return yield* Effect.die(projected)
        yield* journal.append(runId, intentRecordKey(operation.operationId), taskTrackerReadIntent(operation))
        yield* journal.append(
          runId,
          outcomeRecordKey(operation.operationId),
          taskTrackerFactsObservedEvent(
            operation.operationId,
            makeCompleteTaskTrackerFactsObserved(operation, projected.snapshot)
          )
        )
      })

      yield* appendGraph(OperationId.make("reactive-delivery-target-A"), target, "target-A", ["A"])
      yield* appendGraph(OperationId.make("reactive-delivery-target-B"), foreignTarget, "target-B", ["B"])

      const layer = yield* makeReactiveDeliveryRelationsLayer(
        runId,
        target,
        journal,
        currentProjection(journal.state.get.pipe(Effect.orDie))
      )
      const relation = yield* deliveryRuntime.pipe(Effect.provide(layer))
      const evaluation = yield* relation.get

      expect(evaluation.current.trackerGraph._tag).toBe("GraphEstablished")
      if (evaluation.current.trackerGraph._tag === "GraphEstablished") {
        expect(evaluation.current.trackerGraph.observation.snapshot.revision).toBe("target-A")
        expect(evaluation.current.trackerGraph.observation.operationId).toBe(
          OperationId.make("reactive-delivery-target-A")
        )
      }
      expect(evaluation.pauseCoverage._tag).toBe("PauseCoverageGraphEstablished")
      if (evaluation.pauseCoverage._tag === "PauseCoverageGraphEstablished") {
        expect(evaluation.pauseCoverage.snapshot.revision).toBe("target-A")
        expect(evaluation.pauseCoverage.observedAt).toBe(JournalPosition.make(3))
      }
      expect(evaluation.proposedActions).toMatchObject({
        _tag: "DeliveryProposalsAvailable",
        freshTaskCandidates: [
          {
            _tag: "FreshTaskCandidate",
            decision: {
              step: {
                _tag: "ReadCurrentTaskGraph",
                predecessorOperationId: OperationId.make("reactive-delivery-target-A"),
                task: { id: TaskId.make("A") }
              }
            },
            taskId: TaskId.make("A")
          }
        ],
        proposals: []
      })
    }).pipe(Effect.provide(memoryJournalStoreLayer))
  )
)

it.effect("retains the exact task-work position after a safe report when a later resume remains unresolved", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const journal = yield* makeJournalService
      yield* appendAcceptedExecutingExecutorHistory(journal)
      const safeReport = PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({
        correlation: plannedAttemptExecutorCorrelation(recoveredAttempt)
      })
      yield* appendExecutorCommand(journal, 2, "Suspend")
      yield* appendCommandResponse(journal, safeReport, 2)
      yield* appendDirectExecutorReport(journal, safeReport, 2)
      yield* appendExecutorCommand(journal, 3, "Resume")

      const integrationResources = yield* makeIntegrationTargetResourceController()
      const recovery = yield* makeRunRecoveryProjection(runId, integrationTarget, integrationResources).pipe(
        Effect.provideService(InRunJournal, journal)
      )
      const reconstructed = (yield* journal.state.get).reconstructed
      const firstProjection = yield* readDeliveryProjectionFrom(recovery, reconstructed)
      const repeatedProjection = yield* readDeliveryProjectionFrom(recovery, reconstructed)
      expect(repeatedProjection).toBe(firstProjection)
      expect(yield* recovery.readDeliveryProjection).toBe(yield* recovery.readDeliveryProjection)
      expect(
        yield* readDeliveryProjectionFrom(recovery, {
          ...reconstructed,
          runId: RunId.make("another-reactive-delivery-run")
        }).pipe(Effect.flip)
      ).toMatchObject({
        _tag: "RunRecoveryProjectionRunMismatch",
        expectedRunId: runId,
        receivedRunId: "another-reactive-delivery-run"
      })
      const unrelatedOwnership = {
        integrationTarget,
        plannedAttempt: recoveredAttempt,
        queuedAt: JournalPosition.make(99)
      }
      yield* integrationResources.acquire(unrelatedOwnership)
      yield* integrationResources.publishAcceptedOwnership(unrelatedOwnership)
      const ownershipChangedProjection = yield* readDeliveryProjectionFrom(recovery, reconstructed)
      expect(ownershipChangedProjection).not.toBe(firstProjection)
      yield* integrationResources.release(unrelatedOwnership)
      expect(yield* readDeliveryProjectionFrom(recovery, reconstructed)).not.toBe(ownershipChangedProjection)
      const layer = yield* makeReactiveDeliveryRelationsLayer(runId, target, journal, recovery)
      const relation = yield* deliveryRuntime.pipe(Effect.provide(layer))
      const current = yield* relation.get
      const expectedPosition = {
        correlation: plannedAttemptExecutorCorrelation(recoveredAttempt),
        taskId: recoveredAttempt.taskId
      }

      expect(recovery.reconstructedPlannedAttemptPositions).toEqual([
        { attemptId: recoveredAttempt.attemptId, runId, taskId: recoveredAttempt.taskId }
      ])
      expect(current.taskWork.held).toEqual([expectedPosition])
      const admission = yield* makeDeliveryRuntimeAdmissionController(
        current.taskWork,
        yield* makeIntegrationTargetResourceController(),
        (yield* makeApplicationExitLifecycle()).admission
      ).pipe(Effect.provide(Layer.fresh(plannedAttemptProtocolControllerLayer)))
      expect(yield* admission.tryReserve(nextAttemptProposal())).toMatchObject({
        _tag: "Deferred",
        reason: "TaskWorkPositionUnavailable"
      })
    }).pipe(Effect.provide(memoryJournalStoreLayer))
  )
)

it.effect("reconstructs the exact position when the process stops after responsibility and before Begin", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const journal = yield* makeJournalService
      yield* appendExecutorResponsibility(journal)

      const records = materializeJournalRecords((yield* journal.state.get).prefix.records)
      expect(records.some(({ event }) => event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan")).toBe(true)
      expect(records.some(({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended")).toBe(false)

      const recovery = yield* makeRunRecoveryProjection(runId).pipe(Effect.provideService(InRunJournal, journal))
      const layer = yield* makeReactiveDeliveryRelationsLayer(runId, target, journal, recovery)
      const relation = yield* deliveryRuntime.pipe(Effect.provide(layer))
      const current = yield* relation.get

      expect(recovery.reconstructedPlannedAttemptPositions).toEqual([
        { attemptId: recoveredAttempt.attemptId, runId, taskId: recoveredAttempt.taskId }
      ])
      expect(current.taskWork.held).toEqual([
        { correlation: plannedAttemptExecutorCorrelation(recoveredAttempt), taskId: recoveredAttempt.taskId }
      ])
      const admission = yield* makeDeliveryRuntimeAdmissionController(
        current.taskWork,
        yield* makeIntegrationTargetResourceController(),
        (yield* makeApplicationExitLifecycle()).admission
      ).pipe(Effect.provide(Layer.fresh(plannedAttemptProtocolControllerLayer)))
      expect(yield* admission.tryReserve(nextAttemptProposal())).toMatchObject({
        _tag: "Deferred",
        reason: "TaskWorkPositionUnavailable"
      })
    }).pipe(Effect.provide(memoryJournalStoreLayer))
  )
)

it.effect("releases the exact position after accepting a safely suspended command projection", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const journal = yield* makeJournalService
      yield* appendAcceptedExecutingExecutorHistory(journal)
      yield* appendExecutorCommand(journal, 2, "Suspend")
      const safeReport = PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({
        correlation: plannedAttemptExecutorCorrelation(recoveredAttempt)
      })
      yield* appendCommandProjection(journal, safeReport, 2)
      yield* appendDirectExecutorReport(journal, safeReport, 2)

      const recovery = yield* makeRunRecoveryProjection(runId).pipe(Effect.provideService(InRunJournal, journal))
      const layer = yield* makeReactiveDeliveryRelationsLayer(runId, target, journal, recovery)
      const relation = yield* deliveryRuntime.pipe(Effect.provide(layer))
      const current = yield* relation.get

      expect(recovery.reconstructedPlannedAttemptPositions).toEqual([])
      expect(current.taskWork.held).toEqual([])
      const admission = yield* makeDeliveryRuntimeAdmissionController(
        current.taskWork,
        yield* makeIntegrationTargetResourceController(),
        (yield* makeApplicationExitLifecycle()).admission
      ).pipe(Effect.provide(Layer.fresh(plannedAttemptProtocolControllerLayer)))
      expect((yield* admission.tryReserve(nextAttemptProposal()))._tag).toBe("Admitted")
    }).pipe(Effect.provide(memoryJournalStoreLayer))
  )
)

it.effect("releases the exact position after accepting a terminal command projection", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const journal = yield* makeJournalService
      yield* appendAcceptedExecutingExecutorHistory(journal)
      yield* appendExecutorCommand(journal, 2, "Suspend")
      const terminalReport = PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
        correlation: plannedAttemptExecutorCorrelation(recoveredAttempt),
        result: { _tag: "Failed" }
      })
      yield* appendCommandProjection(journal, terminalReport, 2)
      yield* appendDirectExecutorReport(journal, terminalReport, 2)

      const recovery = yield* makeRunRecoveryProjection(runId).pipe(Effect.provideService(InRunJournal, journal))
      const layer = yield* makeReactiveDeliveryRelationsLayer(runId, target, journal, recovery)
      const relation = yield* deliveryRuntime.pipe(Effect.provide(layer))

      expect(recovery.reconstructedPlannedAttemptPositions).toEqual([])
      expect((yield* relation.get).taskWork.held).toEqual([])
    }).pipe(Effect.provide(memoryJournalStoreLayer))
  )
)

it.effect("releases the exact position from a safely suspended state projection after Suspend intent", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const journal = yield* makeJournalService
      yield* appendAcceptedExecutingExecutorHistory(journal)
      yield* appendExecutorCommand(journal, 2, "Suspend")
      const safeReport = PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({
        correlation: plannedAttemptExecutorCorrelation(recoveredAttempt)
      })
      yield* appendCommandResponse(journal, safeReport, 2)
      yield* appendStateProjection(
        journal,
        PlannedAttemptExecutorStateObservation.cases.ExactExecutorReport.make({ report: safeReport })
      )
      yield* appendDirectExecutorReport(journal, safeReport, 2)

      const recovery = yield* makeRunRecoveryProjection(runId).pipe(Effect.provideService(InRunJournal, journal))
      const layer = yield* makeReactiveDeliveryRelationsLayer(runId, target, journal, recovery)
      const relation = yield* deliveryRuntime.pipe(Effect.provide(layer))

      expect(recovery.reconstructedPlannedAttemptPositions).toEqual([])
      expect((yield* relation.get).taskWork.held).toEqual([])
    }).pipe(Effect.provide(memoryJournalStoreLayer))
  )
)

it.effect("retains the exact position when a command-free state projection is unavailable", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const journal = yield* makeJournalService
      yield* appendExecutorResponsibility(journal)
      yield* appendStateProjection(
        journal,
        PlannedAttemptExecutorStateObservation.cases.ExecutorStateNoCurrentReport.make({})
      )

      const recovery = yield* makeRunRecoveryProjection(runId).pipe(Effect.provideService(InRunJournal, journal))
      const layer = yield* makeReactiveDeliveryRelationsLayer(runId, target, journal, recovery)
      const relation = yield* deliveryRuntime.pipe(Effect.provide(layer))
      const expected = [{ attemptId: recoveredAttempt.attemptId, runId, taskId: recoveredAttempt.taskId }]

      expect(recovery.reconstructedPlannedAttemptPositions).toEqual(expected)
      expect((yield* relation.get).taskWork.held).toEqual([
        { correlation: plannedAttemptExecutorCorrelation(recoveredAttempt), taskId: recoveredAttempt.taskId }
      ])
    }).pipe(Effect.provide(memoryJournalStoreLayer))
  )
)

it.effect("publishes journaled G1 and equal-content G2 through one reactive delivery", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const journal = yield* makeJournalService
      const layer = yield* makeReactiveDeliveryRelationsLayer(
        runId,
        target,
        journal,
        currentProjection(journal.state.get.pipe(Effect.orDie))
      )
      const signal = yield* delivery.pipe(Effect.provide(layer))
      const current = yield* signal.get
      expect(current.graph._tag).toBe("GraphNotEstablished")
      const firstDeliverySeen = yield* Deferred.make<void>()
      const first = makeTrackerGraphObservationOperation(
        { _tag: "WorkflowEstablishment" },
        OperationId.make("integrated-G1"),
        target
      )
      const second = makeTrackerGraphObservationOperation(
        { _tag: "WorkflowEstablishment" },
        OperationId.make("integrated-G2"),
        target
      )
      const observed = yield* signal.changes.pipe(
        Stream.tap((value) =>
          value.graph._tag === "GraphEstablished" && value.graph.observation.operationId === first.operationId
            ? Deferred.succeed(firstDeliverySeen, undefined)
            : Effect.void
        ),
        Stream.filter(({ graph }) => graph._tag === "GraphEstablished"),
        Stream.take(2),
        Stream.runCollect,
        Effect.forkChild
      )
      const projected = projectTrackerSnapshot({
        revision: "integrated-equal-content",
        tasks: [{ id: TaskId.make("A"), lifecycle: { _tag: "Open" as const }, parentTaskId: null, prerequisiteIds: [] }]
      })
      if (projected._tag === "Invalid") return yield* Effect.die(projected)

      yield* journal.append(runId, intentRecordKey(first.operationId), taskTrackerReadIntent(first))
      yield* journal.append(
        runId,
        outcomeRecordKey(first.operationId),
        taskTrackerFactsObservedEvent(
          first.operationId,
          makeCompleteTaskTrackerFactsObserved(first, projected.snapshot)
        )
      )
      yield* Deferred.await(firstDeliverySeen)
      yield* journal.append(runId, intentRecordKey(second.operationId), taskTrackerReadIntent(second))
      const records = yield* journal.read(runId)
      yield* journal.append(
        runId,
        outcomeRecordKey(second.operationId),
        makeTaskTrackerFactsObservedFromRead(
          records.map(({ event }) => ({ event })),
          second,
          projected.snapshot
        )
      )

      const values = Array.from(yield* Fiber.join(observed))
      expect(values).toHaveLength(2)
      expect(
        values.map((value) => (value.graph._tag === "GraphEstablished" ? value.graph.observation.operationId : null))
      ).toEqual([first.operationId, second.operationId])
      expect(
        values.map((value) => (value.graph._tag === "GraphEstablished" ? value.graph.observation.recordedAt : null))
      ).toEqual([JournalPosition.make(3), JournalPosition.make(5)])
      expect(
        values.map((value) =>
          value.graph._tag === "GraphEstablished" ? value.graph.observation.contentIdentity : null
        )
      ).toEqual([TrackerRevision.make("integrated-equal-content"), TrackerRevision.make("integrated-equal-content")])
    }).pipe(Effect.provide(memoryJournalStoreLayer))
  )
)

it.effect("waits for the accepted journal position to reach delivery planning before returning", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const journal = yield* makeJournalService
      const projectionBlocked = yield* Deferred.make<void>()
      const refreshStarted = yield* Deferred.make<void>()
      const projectionReads = yield* Ref.make(0)
      const baseProjection = currentProjection(journal.state.get.pipe(Effect.orDie))
      const recovery: RunRecoveryProjectionSource = {
        ...baseProjection,
        readDeliveryProjection: Ref.getAndUpdate(projectionReads, (count) => count + 1).pipe(
          Effect.flatMap((read) =>
            read === 0
              ? baseProjection.readDeliveryProjection
              : Deferred.succeed(refreshStarted, undefined).pipe(
                  Effect.andThen(Deferred.await(projectionBlocked)),
                  Effect.andThen(baseProjection.readDeliveryProjection)
                )
          )
        )
      }
      const layer = yield* makeReactiveDeliveryRelationsLayer(runId, target, journal, recovery)
      const publication = yield* DeliveryAcceptedFactPublication.pipe(Effect.provide(layer))
      const operation = makeTrackerGraphObservationOperation(
        { _tag: "WorkflowEstablishment" },
        OperationId.make("publication-handshake"),
        target
      )

      const accepted = yield* journal.append(
        runId,
        intentRecordKey(operation.operationId),
        taskTrackerReadIntent(operation)
      )
      yield* Deferred.await(refreshStarted)
      const waiting = yield* publication.awaitCurrent.pipe(Effect.forkChild)
      yield* Effect.yieldNow
      expect(waiting.pollUnsafe()).toBeUndefined()
      yield* Deferred.succeed(projectionBlocked, undefined)
      expect(yield* Fiber.join(waiting)).toEqual({
        _tag: "DeliveryAcceptedPublicationBoundary",
        acceptedThrough: accepted.position,
        runId
      })
    }).pipe(Effect.provide(memoryJournalStoreLayer))
  )
)

it.effect("removes an interrupted accepted-fact waiter before the next publication", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const journal = yield* makeJournalService
      const projectionBlocked = yield* Deferred.make<void>()
      const refreshStarted = yield* Deferred.make<void>()
      const projectionReads = yield* Ref.make(0)
      const baseProjection = currentProjection(journal.state.get.pipe(Effect.orDie))
      const recovery: RunRecoveryProjectionSource = {
        ...baseProjection,
        readDeliveryProjection: Ref.getAndUpdate(projectionReads, (count) => count + 1).pipe(
          Effect.flatMap((read) =>
            read === 0
              ? baseProjection.readDeliveryProjection
              : Deferred.succeed(refreshStarted, undefined).pipe(
                  Effect.andThen(Deferred.await(projectionBlocked)),
                  Effect.andThen(baseProjection.readDeliveryProjection)
                )
          )
        )
      }
      const layer = yield* makeReactiveDeliveryRelationsLayer(runId, target, journal, recovery)
      const publication = yield* DeliveryAcceptedFactPublication.pipe(Effect.provide(layer))
      const operation = makeTrackerGraphObservationOperation(
        { _tag: "WorkflowEstablishment" },
        OperationId.make("interrupted-publication-waiter"),
        target
      )
      yield* journal.append(runId, intentRecordKey(operation.operationId), taskTrackerReadIntent(operation))
      yield* Deferred.await(refreshStarted)

      const waiting = yield* publication.awaitCurrent.pipe(Effect.forkChild)
      yield* Effect.yieldNow
      const surviving = yield* publication.awaitCurrent.pipe(Effect.forkChild)
      yield* Effect.yieldNow
      yield* Fiber.interrupt(waiting)
      yield* Deferred.succeed(projectionBlocked, undefined)
      yield* Fiber.join(surviving)
    }).pipe(Effect.provide(memoryJournalStoreLayer))
  )
)

it.effect("cancels an accepted-fact waiter after it has crossed the publication gate", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const journal = yield* makeJournalService
      const refreshSignal = yield* Deferred.make<void>()
      const quietJournal = {
        ...journal,
        state: {
          ...journal.state,
          changes: Stream.fromEffect(Deferred.await(refreshSignal).pipe(Effect.andThen(journal.state.get)))
        }
      }
      const layer = yield* makeReactiveDeliveryRelationsLayer(
        runId,
        target,
        quietJournal,
        currentProjection(journal.state.get.pipe(Effect.orDie))
      )
      const publication = yield* DeliveryAcceptedFactPublication.pipe(Effect.provide(layer))
      const operation = makeTrackerGraphObservationOperation(
        { _tag: "WorkflowEstablishment" },
        OperationId.make("cancelled-publication-waiter"),
        target
      )
      yield* journal.append(runId, intentRecordKey(operation.operationId), taskTrackerReadIntent(operation))

      const waiting = yield* publication.awaitCurrent.pipe(Effect.forkChild)
      yield* Effect.yieldNow
      expect(waiting.pollUnsafe()).toBeUndefined()
      yield* Fiber.interrupt(waiting)

      const surviving = yield* publication.awaitCurrent.pipe(Effect.forkChild)
      yield* Effect.yieldNow
      yield* Deferred.succeed(refreshSignal, undefined)
      yield* Fiber.join(surviving)
    }).pipe(Effect.provide(memoryJournalStoreLayer))
  )
)

it.effect("constructs the scoped reactive relations layer from shared runtime resources", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const journal = yield* makeJournalService
      const layer = reactiveDeliveryRelationsLayer(
        runId,
        target,
        journal,
        currentProjection(journal.state.get.pipe(Effect.orDie)),
        JournalPosition.make(1)
      ).pipe(Layer.provide(testDeliveryRuntimeResourcesLayer))
      const relation = yield* deliveryRuntime.pipe(Effect.provide(layer))
      expect((yield* relation.get).current.trackerGraph._tag).toBe("GraphNotEstablished")
    }).pipe(Effect.provide(memoryJournalStoreLayer))
  )
)

it.effect("keeps a recovered paused Run passive before its first current graph", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const journal = yield* makeJournalService
      const ordinal = ControlDirectionApplicationOrdinal.make(1)
      yield* journal.append(
        runId,
        controlDirectionAppliedRecordKey(ordinal),
        ControlDirectionAppliedEvent.make({
          direction: "Pause",
          initiatedBy: { _tag: "Operator" },
          occurrenceClassification: "InitiatedAction",
          ordinal,
          subject: { _tag: "Run", runId },
          version: workflowJournalEventVersion
        })
      )
      const layer = yield* makeReactiveDeliveryRelationsLayer(
        runId,
        target,
        journal,
        currentProjection(journal.state.get.pipe(Effect.orDie))
      )
      const relation = yield* deliveryRuntime.pipe(Effect.provide(layer))
      const evaluation = Option.getOrThrow(yield* relation.changes.pipe(Stream.runHead))

      expect(evaluation.current.trackerGraph._tag).toBe("GraphNotEstablished")
      expect(evaluation.proposedActions).toMatchObject({
        _tag: "DeliveryProposalsAvailable",
        freshTaskCandidates: [],
        isolatedIssues: [],
        proposals: []
      })
      if (evaluation.proposedActions._tag !== "DeliveryProposalsAvailable") return
      const frontier = evaluation.proposedActions.freshTaskCandidateFrontier
      if (frontier === undefined) return expect.fail("paused delivery should expose a candidate frontier")
      expect(frontier).toMatchObject({ _tag: "FreshTaskCandidateFrontier", candidates: [] })
      expect(frontier.entryCapableTaskIds.size).toBe(0)
      expect(evaluation.quiescence).toEqual({ _tag: "QuiescencePassive", reason: "RunPaused" })
    }).pipe(Effect.provide(memoryJournalStoreLayer))
  )
)

it.effect("retries reconstruction when a journal append lands during recovery projection", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const journal = yield* makeJournalService
      const journalReads = yield* Ref.make(0)
      const countedJournal = {
        ...journal,
        state: {
          ...journal.state,
          get: Ref.update(journalReads, (count) => count + 1).pipe(Effect.andThen(journal.state.get))
        }
      }
      const journalBefore = yield* journal.state.get
      const firstProjectionRead = yield* Deferred.make<void>()
      const permitFirstProjection = yield* Deferred.make<void>()
      const projectionReads = yield* Ref.make(0)
      const recovery: RunRecoveryProjectionSource = {
        readDeliveryProjection: Effect.gen(function* () {
          const readNumber = yield* Ref.updateAndGet(projectionReads, (count) => count + 1)
          const journalState = yield* journal.state.get.pipe(Effect.orDie)
          if (readNumber === 1) {
            yield* Deferred.succeed(firstProjectionRead, undefined)
            yield* Deferred.await(permitFirstProjection)
          }
          return {
            evidence: {
              _tag: "AvailableDeliveryProjectionEvidence" as const,
              acceptedAt: journalState.position,
              facts: [],
              integrationWaits: []
            },
            frontier: { explanations: [], transitions: [] }
          }
        }),
        reconstructedPlannedAttemptPositions: []
      }
      const layerFiber = yield* makeReactiveDeliveryRelationsLayer(runId, target, countedJournal, recovery).pipe(
        Effect.forkChild
      )

      yield* Deferred.await(firstProjectionRead)
      const operation = makeTrackerGraphObservationOperation(
        { _tag: "WorkflowEstablishment" },
        OperationId.make("coherent-race-read"),
        target
      )
      yield* journal.append(runId, intentRecordKey(operation.operationId), taskTrackerReadIntent(operation))
      const projected = projectTrackerSnapshot({ revision: "coherent-race", tasks: [] })
      if (projected._tag === "Invalid") return yield* Effect.die(new Error("race graph must be valid"))
      const journalOutcome = yield* journal.append(
        runId,
        outcomeRecordKey(operation.operationId),
        taskTrackerFactsObservedEvent(
          operation.operationId,
          makeCompleteTaskTrackerFactsObserved(operation, projected.snapshot)
        )
      )
      yield* Deferred.succeed(permitFirstProjection, undefined)

      const layer = yield* Fiber.join(layerFiber)
      const relation = yield* deliveryRuntime.pipe(Effect.provide(layer))
      const evaluation = Option.getOrThrow(yield* relation.changes.pipe(Stream.runHead))

      expect(journalOutcome.position).toBeGreaterThan(journalBefore.position)
      expect(evaluation.acceptedAt).toBe(journalOutcome.position)
      expect(evaluation.current.trackerGraph._tag).toBe("GraphEstablished")
      expect(yield* Ref.get(journalReads)).toBe(4)
      expect(yield* Ref.get(projectionReads)).toBe(2)
    }).pipe(Effect.provide(memoryJournalStoreLayer))
  )
)

it.effect("does not turn an accepted Running report into tracker graph-read authority", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const journal = yield* makeJournalService
      const graphOperation = makeTrackerGraphObservationOperation(
        { _tag: "WorkflowEstablishment" },
        OperationId.make("report-authority-graph"),
        target
      )
      const projected = projectTrackerSnapshot({ revision: "report-authority-revision", tasks: [] })
      if (projected._tag === "Invalid") return yield* Effect.die(projected)
      yield* journal.append(runId, intentRecordKey(graphOperation.operationId), taskTrackerReadIntent(graphOperation))
      yield* journal.append(
        runId,
        outcomeRecordKey(graphOperation.operationId),
        taskTrackerFactsObservedEvent(
          graphOperation.operationId,
          makeCompleteTaskTrackerFactsObserved(graphOperation, projected.snapshot)
        )
      )
      yield* appendAcceptedExecutingExecutorHistory(journal)
      const continueTransition = RunnableFrontierTransition.ObservePlannedAttemptExecutorWork({
        acceptedProgress: { _tag: "ExecutorReportAccepted", ordinal: PlannedAttemptExecutorReportOrdinal.make(1) },
        plannedAttempt: recoveredAttempt
      })
      const recovery: RunRecoveryProjectionSource = {
        readDeliveryProjection: journal.state.get.pipe(
          Effect.orDie,
          Effect.map((journalState) => ({
            evidence: {
              _tag: "AvailableDeliveryProjectionEvidence" as const,
              acceptedAt: journalState.position,
              facts: [],
              integrationWaits: []
            },
            frontier: { explanations: [], transitions: [continueTransition] }
          }))
        ),
        reconstructedPlannedAttemptPositions: []
      }
      const layer = yield* makeReactiveDeliveryRelationsLayer(runId, target, journal, recovery)
      const relation = yield* deliveryRuntime.pipe(Effect.provide(layer))
      const current = yield* relation.get

      expect(current.proposedActions).toMatchObject({
        _tag: "DeliveryProposalsAvailable",
        proposals: [{ route: { _tag: "IdentityFreeWorkflowRoute", transition: continueTransition } }]
      })
      expect(
        current.proposedActions._tag === "DeliveryProposalsAvailable" &&
          current.proposedActions.proposals.some(({ route }) => route._tag === "TrackerGraphReadRoute")
      ).toBe(false)
    }).pipe(Effect.provide(memoryJournalStoreLayer))
  )
)

it.effect("does not propose the initial graph read while recovered boundary work remains", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const journal = yield* makeJournalService
      const recoveredTransitions = yield* Ref.make<ReadonlyArray<RunnableFrontierTransition>>([
        RunnableFrontierTransition.SuspendPlannedAttemptExecutorWork({ plannedAttempt: recoveredAttempt })
      ])
      const recovery: RunRecoveryProjectionSource = {
        readDeliveryProjection: Effect.all({
          journalState: journal.state.get.pipe(Effect.orDie),
          transitions: Ref.get(recoveredTransitions)
        }).pipe(
          Effect.map(({ journalState, transitions }) => ({
            evidence: {
              _tag: "AvailableDeliveryProjectionEvidence" as const,
              acceptedAt: journalState.position,
              facts: [],
              integrationWaits: []
            },
            frontier: { explanations: [], transitions }
          }))
        ),
        reconstructedPlannedAttemptPositions: [
          { attemptId: recoveredAttempt.attemptId, runId, taskId: recoveredAttempt.taskId }
        ]
      }
      const layer = yield* makeReactiveDeliveryRelationsLayer(runId, target, journal, recovery)
      const relation = yield* deliveryRuntime.pipe(Effect.provide(layer))
      const initial = Option.getOrThrow(yield* relation.changes.pipe(Stream.runHead))
      expect(initial.proposedActions).toMatchObject({
        _tag: "DeliveryProposalsAvailable",
        proposals: [
          { route: { _tag: "IdentityFreeWorkflowRoute", transition: { _tag: "SuspendPlannedAttemptExecutorWork" } } }
        ]
      })
    }).pipe(Effect.provide(memoryJournalStoreLayer))
  )
)

it.effect("establishes the current graph before proposing an external-success claim release", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const journal = yield* makeJournalService
      const claimOperationId = OperationId.make("stale-external-success-claim")
      const claim = ActiveTaskClaim.make({
        operationId: claimOperationId,
        owner: ClaimOwner.make("dalph"),
        taskId: recoveredAttempt.taskId,
        token: ClaimToken.make("stale-external-success-token")
      })
      const release = makeTaskClaimReleaseOperation({
        authority: TaskClaimReleaseAuthority.cases.WorkflowClaimReleaseAuthority.make({}),
        predecessorOperationIds: [claimOperationId],
        release: { claim, operationId: OperationId.make("stale-external-success-release-placeholder") }
      })
      const recovery: RunRecoveryProjectionSource = {
        readDeliveryProjection: journal.state.get.pipe(
          Effect.orDie,
          Effect.map((journalState) => ({
            evidence: {
              _tag: "AvailableDeliveryProjectionEvidence" as const,
              acceptedAt: journalState.position,
              facts: [],
              integrationWaits: []
            },
            frontier: {
              explanations: [],
              transitions: [
                RunnableFrontierTransition.ReleaseExternallyCompletedTaskClaim({
                  operation: release,
                  plannedAttempt: recoveredAttempt
                })
              ]
            }
          }))
        ),
        reconstructedPlannedAttemptPositions: [
          { attemptId: recoveredAttempt.attemptId, runId, taskId: recoveredAttempt.taskId }
        ]
      }
      const layer = yield* makeReactiveDeliveryRelationsLayer(runId, target, journal, recovery)
      const relation = yield* deliveryRuntime.pipe(Effect.provide(layer))
      const initial = Option.getOrThrow(yield* relation.changes.pipe(Stream.runHead))

      expect(initial.current.trackerGraph._tag).toBe("GraphNotEstablished")
      expect(initial.proposedActions).toMatchObject({
        _tag: "DeliveryProposalsAvailable",
        proposals: [{ route: { _tag: "TrackerGraphReadRoute", purpose: "EstablishCurrentGraph" } }]
      })
    }).pipe(Effect.provide(memoryJournalStoreLayer))
  )
)

it.effect("establishes the current graph without scanning unrelated history while a recovered continuation waits", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const priorActivationJournal = yield* makeJournalService
      const activeSpecification = makeTaskWorkSpecification({
        body: "Keep the active task running.",
        taskId: TaskId.make("reactive-delivery-active-task"),
        title: "Active reactive-delivery task"
      })
      const activeAttempt = PlannedTaskAttempt.make({
        ...recoveredAttempt,
        attemptId: AttemptId.make("reactive-delivery-active-attempt"),
        branch: TaskBranchRef.make("refs/heads/dalph/reactive-delivery-active"),
        taskId: activeSpecification.taskId,
        taskRevision: TaskRevision.make(activeSpecification.fingerprint),
        worktree: WorktreeLocator.make("/worktrees/reactive-delivery-active")
      })
      const activeClaim = ActiveTaskClaim.make({
        operationId: OperationId.make("reactive-delivery-active-claim"),
        owner: ClaimOwner.make("reactive-delivery-test"),
        taskId: activeAttempt.taskId,
        token: ClaimToken.make("reactive-delivery-active-token")
      })
      const activeClaimOperation = makeTaskClaimAcquisitionOperation({
        acquisition: activeClaim,
        predecessorOperationIds: []
      })
      const activeGraphOperation = makeTrackerGraphObservationOperation(
        { _tag: "WorkflowEstablishment" },
        OperationId.make("reactive-delivery-active-graph"),
        target,
        [activeClaim.operationId],
        [activeAttempt.taskId]
      )
      const activeSpecificationOperation = makeTaskWorkSpecificationObservationOperation(
        OperationId.make("reactive-delivery-active-specification"),
        target,
        activeAttempt.taskId,
        [activeGraphOperation.operationId]
      )
      const activePlanOperation = makeTaskAttemptPlanOperation({
        operationId: OperationId.make("reactive-delivery-active-plan"),
        plannedAttempt: activeAttempt,
        predecessorOperationIds: [activeSpecificationOperation.operationId]
      })
      const activeFixture: ExecutorResponsibilityFixture = {
        attempt: activeAttempt,
        claim: activeClaim,
        claimOperation: activeClaimOperation,
        graphOperation: activeGraphOperation,
        planOperation: activePlanOperation,
        specification: activeSpecification,
        specificationOperation: activeSpecificationOperation,
        worktreeOperation: makeTaskWorktreeReconciliationOperation({
          operationId: OperationId.make("reactive-delivery-active-worktree"),
          plannedAttempt: activeAttempt,
          predecessorOperationIds: [activePlanOperation.operationId]
        })
      }
      yield* appendAcceptedExecutingExecutorHistory(priorActivationJournal, activeFixture)
      yield* appendAcceptedExecutingExecutorHistory(priorActivationJournal)
      const closedGraphOperation = yield* appendRecoveredTaskGraph(
        priorActivationJournal,
        OperationId.make("reactive-delivery-safe-closed-graph"),
        OperationId.make("reactive-delivery-recovered-plan"),
        "TerminalWithoutSuccess"
      )
      yield* appendExecutorCommand(priorActivationJournal, 2, "Suspend")
      const safeReport = PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({
        correlation: plannedAttemptExecutorCorrelation(recoveredAttempt)
      })
      yield* appendCommandResponse(priorActivationJournal, safeReport, 2)
      yield* appendDirectExecutorReport(priorActivationJournal, safeReport, 2)
      const storage = yield* JournalStore
      expect(
        hasUnconsumedAcceptedSafeTaskReopenFromExecutingWorkAuthorityCheck(
          journalEvidenceFrom(yield* storage.read(runId)),
          recoveredAttempt
        )
      ).toBe(false)
      const globalOpenGraphOperation = yield* appendRecoveredTaskGraph(
        priorActivationJournal,
        OperationId.make("reactive-delivery-global-open-graph"),
        activePlanOperation.operationId,
        "Open",
        { _tag: "ExecutingWorkAuthorityCheck" },
        [activeAttempt.taskId]
      )
      const globallyReopenedRecords = yield* storage.read(runId)
      expect(
        hasUnconsumedAcceptedSafeTaskReopenFromExecutingWorkAuthorityCheck(
          journalEvidenceFrom(globallyReopenedRecords),
          recoveredAttempt
        )
      ).toBe(true)
      const measureIndexedReopenLookup = (paddingCount: number) => {
        const start = Number(globallyReopenedRecords.at(-1)?.position ?? 0) + 1
        const padded = [
          ...globallyReopenedRecords,
          ...Array.from({ length: paddingCount }, (_, index) => {
            const operationId = OperationId.make(`reactive-delivery-unrelated-claim-${paddingCount}-${index}`)
            return {
              event: TaskClaimAcquiredEvent.make({
                claim: ActiveTaskClaim.make({
                  operationId,
                  owner: ClaimOwner.make("reactive-delivery-unrelated"),
                  taskId: TaskId.make(`reactive-delivery-unrelated-task-${index}`),
                  token: ClaimToken.make(`reactive-delivery-unrelated-token-${index}`)
                }),
                version: workflowJournalEventVersion
              }),
              key: outcomeRecordKey(operationId),
              position: JournalPosition.make(start + index),
              runId
            }
          })
        ]
        const evidence = journalEvidenceFrom(padded)
        const operations: Array<string> = []
        const stop = observeJournalRecordSequenceOperations((operation) => operations.push(operation._tag))
        try {
          expect(hasUnconsumedAcceptedSafeTaskReopenFromExecutingWorkAuthorityCheck(evidence, recoveredAttempt)).toBe(
            true
          )
        } finally {
          stop()
        }
        return operations
      }
      const operationsAt64 = measureIndexedReopenLookup(64)
      expect(measureIndexedReopenLookup(256)).toEqual(operationsAt64)
      expect(operationsAt64).toContain("IndexedRecordVisit")
      expect(operationsAt64).not.toContain("HistoricalMaterialization")
      const authorityIntent = globallyReopenedRecords.find(
        ({ event }) =>
          event._tag === "TaskTrackerReadIntentRecorded" &&
          event.operation.operationId === globalOpenGraphOperation.operationId
      )
      if (
        authorityIntent?.event._tag !== "TaskTrackerReadIntentRecorded" ||
        authorityIntent.event.operation._tag !== "ReadTrackerGraph"
      ) {
        return yield* Effect.die("missing #349 authority-check intent")
      }
      const replaceAuthorityIntent = (
        records: ReadonlyArray<JournalRecord>,
        operation: ReturnType<typeof makeTrackerGraphObservationOperation>
      ): ReadonlyArray<JournalRecord> =>
        records.map((record) =>
          record === authorityIntent ? { ...record, event: taskTrackerReadIntent(operation) } : record
        )
      const authorityOperation = authorityIntent.event.operation
      const authorityOperationWith = (
        predecessorOperationIds: ReadonlyArray<OperationId>,
        explicitlyCoveredTaskIds: ReadonlyArray<TaskId>
      ) =>
        makeTrackerGraphObservationOperation(
          { _tag: "ExecutingWorkAuthorityCheck" },
          authorityOperation.operationId,
          target,
          predecessorOperationIds,
          explicitlyCoveredTaskIds
        )
      const missingPlan = replaceAuthorityIntent(
        globallyReopenedRecords.filter(
          ({ event }) =>
            event._tag !== "TaskAttemptPlanned" || event.operation.operationId !== activePlanOperation.operationId
        ),
        authorityOperation
      )
      const foreignAttempt = PlannedTaskAttempt.make({
        ...activeAttempt,
        attemptId: AttemptId.make("reactive-delivery-foreign-attempt"),
        runId: RunId.make("reactive-delivery-foreign-run")
      })
      const foreignPlan = makeTaskAttemptPlanOperation({ ...activePlanOperation, plannedAttempt: foreignAttempt })
      const foreignPlanRecords = globallyReopenedRecords.map((record) =>
        record.event._tag === "TaskAttemptPlanned" &&
        record.event.operation.operationId === activePlanOperation.operationId
          ? {
              ...record,
              event: TaskAttemptPlannedEvent.make({ operation: foreignPlan, version: workflowJournalEventVersion })
            }
          : record
      )
      const coverageMismatch = replaceAuthorityIntent(
        globallyReopenedRecords,
        authorityOperationWith([activePlanOperation.operationId], [TaskId.make("unplanned-active-task")])
      )
      const nonExecutingPredecessor = replaceAuthorityIntent(
        globallyReopenedRecords,
        authorityOperationWith([recoveredPlanOperation.operationId], [recoveredAttempt.taskId])
      )
      const extraNonPlanPredecessor = replaceAuthorityIntent(
        globallyReopenedRecords,
        authorityOperationWith(
          [activePlanOperation.operationId, closedGraphOperation.operationId],
          [activeAttempt.taskId]
        )
      )
      const activePlanRecord = globallyReopenedRecords.find(
        ({ event }) =>
          event._tag === "TaskAttemptPlanned" && event.operation.operationId === activePlanOperation.operationId
      )
      if (activePlanRecord === undefined) return yield* Effect.die("missing active plan record")
      const duplicatePlan = [
        ...globallyReopenedRecords,
        { ...activePlanRecord, position: JournalPosition.make(Number(authorityIntent.position) - 1) }
      ]
      for (const { name, records: invalidRecords } of [
        { name: "missing plan", records: missingPlan },
        { name: "foreign plan", records: foreignPlanRecords },
        { name: "coverage mismatch", records: coverageMismatch },
        { name: "non-executing predecessor", records: nonExecutingPredecessor },
        { name: "extra non-plan predecessor", records: extraNonPlanPredecessor },
        { name: "duplicate plan", records: duplicatePlan }
      ]) {
        expect(
          hasUnconsumedAcceptedSafeTaskReopenFromExecutingWorkAuthorityCheck(
            journalEvidenceFrom(invalidRecords),
            recoveredAttempt
          ),
          name
        ).toBe(false)
      }
      const resumeOrdinal = PlannedAttemptExecutorCommandOrdinal.make(3)
      const resume = PlannedAttemptExecutorCommandIntendedEvent.make({
        command: "Resume",
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        ordinal: resumeOrdinal,
        plannedAttempt: recoveredAttempt,
        version: workflowJournalEventVersion
      })
      expect(
        hasUnconsumedAcceptedSafeTaskReopenFromExecutingWorkAuthorityCheck(
          journalEvidenceFrom([
            ...globallyReopenedRecords,
            {
              event: resume,
              key: plannedAttemptExecutorCommandIntendedRecordKey(recoveredAttempt.attemptId, resumeOrdinal),
              position: JournalPosition.make(Number(globallyReopenedRecords.at(-1)?.position ?? 0) + 1),
              runId
            }
          ]),
          recoveredAttempt
        )
      ).toBe(false)
      const workflowOpen = yield* appendRecoveredTaskGraph(
        priorActivationJournal,
        OperationId.make("reactive-delivery-workflow-open-graph"),
        globalOpenGraphOperation.operationId,
        "Open",
        { _tag: "WorkflowEstablishment" }
      )
      expect(
        hasUnconsumedAcceptedSafeTaskReopenFromExecutingWorkAuthorityCheck(
          journalEvidenceFrom(yield* storage.read(runId)),
          recoveredAttempt
        )
      ).toBe(false)
      const continuationOpen = yield* appendRecoveredTaskGraph(
        priorActivationJournal,
        OperationId.make("reactive-delivery-continuation-open-graph"),
        workflowOpen.operationId,
        "Open",
        { _tag: "AttemptContinuation" },
        [recoveredAttempt.taskId]
      )
      expect(
        hasUnconsumedAcceptedSafeTaskReopenFromExecutingWorkAuthorityCheck(
          journalEvidenceFrom(yield* storage.read(runId)),
          recoveredAttempt
        )
      ).toBe(false)
      const cCoveredActiveOpen = yield* appendRecoveredTaskGraph(
        priorActivationJournal,
        OperationId.make("reactive-delivery-c-covered-active-open-graph"),
        continuationOpen.operationId,
        "Open",
        { _tag: "ExecutingWorkAuthorityCheck" },
        [recoveredAttempt.taskId]
      )
      expect(
        hasUnconsumedAcceptedSafeTaskReopenFromExecutingWorkAuthorityCheck(
          journalEvidenceFrom(yield* storage.read(runId)),
          recoveredAttempt
        )
      ).toBe(false)
      yield* appendRecoveredTaskGraph(
        priorActivationJournal,
        OperationId.make("reactive-delivery-latest-closed-graph"),
        cCoveredActiveOpen.operationId,
        "TerminalWithoutSuccess"
      )
      expect(
        hasUnconsumedAcceptedSafeTaskReopenFromExecutingWorkAuthorityCheck(
          journalEvidenceFrom(yield* storage.read(runId)),
          recoveredAttempt
        )
      ).toBe(false)

      const recoveredHistory = reduceWorkflowJournalHistory(runId, globallyReopenedRecords)
      if (recoveredHistory._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die(recoveredHistory)
      const journal = yield* makeJournal(runId, target, recoveredHistory, storage)
      const recoveredProjection = yield* makeRunRecoveryProjection(runId).pipe(
        Effect.provideService(InRunJournal, journal)
      )
      const projection = yield* recoveredProjection.readDeliveryProjection
      expect(
        projection.frontier.transitions.some(
          (transition) =>
            transition._tag === "ObservePlannedAttemptContinuationGraph" &&
            transition.plannedAttempt.attemptId === recoveredAttempt.attemptId
        )
      ).toBe(true)
      expect(
        projection.evidence._tag === "AvailableDeliveryProjectionEvidence"
          ? projection.evidence.facts.some(
              (facts) =>
                facts._tag === "PlannedAttemptExecutorFreshFacts" &&
                facts.responsibility.plannedAttempt.attemptId === recoveredAttempt.attemptId &&
                facts.safeContinuationRevalidationEligibility === undefined
            )
          : false
      ).toBe(true)
      const layer = yield* makeReactiveDeliveryRelationsLayer(runId, target, journal, recoveredProjection)
      const relation = yield* deliveryRuntime.pipe(Effect.provide(layer))
      const initial = Option.getOrThrow(yield* relation.changes.pipe(Stream.runHead))

      expect(initial.current.trackerGraph._tag).toBe("GraphNotEstablished")
      expect(
        initial.proposedActions._tag === "DeliveryProposalsAvailable"
          ? initial.proposedActions.proposals.filter(({ route }) => route._tag === "TrackerGraphReadRoute")
          : []
      ).toMatchObject([{ route: { purpose: "EstablishCurrentGraph" } }])
    }).pipe(Effect.provide(memoryJournalStoreLayer))
  )
)

it.effect("fails initial reconciliation with the exact missing-policy error", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const journal = yield* makeJournalService
      const journalState = yield* journal.state.get
      const missingPolicy = {
        ...journalState,
        reconstructed: { ...journalState.reconstructed, controlPolicy: Option.none() }
      }
      const missingPolicyJournal = { ...journal, state: { ...journal.state, get: Effect.succeed(missingPolicy) } }

      const failure = yield* makeReactiveDeliveryRelationsLayer(
        runId,
        target,
        missingPolicyJournal,
        currentProjection(Effect.succeed(missingPolicy))
      ).pipe(Effect.flip)

      expect(failure).toBeInstanceOf(DeliveryControlPolicyMissing)
    }).pipe(Effect.provide(memoryJournalStoreLayer))
  )
)

it.effect("publishes a typed relation failure when a later recovery projection fails", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const journal = yield* makeJournalService
      const failProjection = yield* Ref.make(false)
      const recoveryFailure = new RunRecoveryProjectionRunMismatch({
        expectedRunId: runId,
        receivedRunId: RunId.make("projection-failure-other-run")
      })
      const recovery: RunRecoveryProjectionSource = {
        ...currentProjection(journal.state.get.pipe(Effect.orDie)),
        readDeliveryProjection: Ref.get(failProjection).pipe(
          Effect.flatMap((failed) =>
            failed
              ? Effect.fail(recoveryFailure)
              : currentProjection(journal.state.get.pipe(Effect.orDie)).readDeliveryProjection
          )
        )
      }
      const layer = yield* makeReactiveDeliveryRelationsLayer(runId, target, journal, recovery)
      const relation = yield* deliveryRuntime.pipe(Effect.provide(layer))
      const publication = yield* DeliveryAcceptedFactPublication.pipe(Effect.provide(layer))

      yield* Ref.set(failProjection, true)
      const failed = yield* relation.changes.pipe(Stream.drop(1), Stream.runHead, Effect.flip, Effect.forkChild)
      const trigger = makeTrackerGraphObservationOperation(
        { _tag: "WorkflowEstablishment" },
        OperationId.make("projection-failure-trigger"),
        target
      )
      yield* journal.append(runId, intentRecordKey(trigger.operationId), taskTrackerReadIntent(trigger))
      const failure = yield* Fiber.join(failed)
      const currentFailure = yield* relation.get.pipe(Effect.flip)
      const publicationFailure = yield* publication.awaitCurrent.pipe(Effect.flip)

      expect(failure).toBeInstanceOf(DeliveryRelationReconciliationError)
      expect(currentFailure).toEqual(failure)
      expect(publicationFailure).toEqual(failure)
      if (!(failure instanceof DeliveryRelationReconciliationError)) return expect.fail("expected relation failure")
      expect(Cause.squash(failure.cause)).toEqual(recoveryFailure)
    }).pipe(Effect.provide(memoryJournalStoreLayer))
  )
)

it.effect("derives safely when recovery evidence is unavailable before and after graph establishment", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const journal = yield* makeJournalService
      const initialLayer = yield* makeReactiveDeliveryRelationsLayer(runId, target, journal, unavailableProjection)
      const initialRelation = yield* deliveryRuntime.pipe(Effect.provide(initialLayer))
      const initial = Option.getOrThrow(yield* initialRelation.changes.pipe(Stream.runHead))
      expect(initial.current.trackerGraph._tag).toBe("GraphNotEstablished")

      const operation = makeTrackerGraphObservationOperation(
        { _tag: "WorkflowEstablishment" },
        OperationId.make("unavailable-evidence-graph"),
        target
      )
      yield* journal.append(runId, intentRecordKey(operation.operationId), taskTrackerReadIntent(operation))
      const projected = projectTrackerSnapshot({ revision: "unavailable-evidence", tasks: [] })
      if (projected._tag === "Invalid") return yield* Effect.die("unavailable-evidence graph must be valid")
      yield* journal.append(
        runId,
        outcomeRecordKey(operation.operationId),
        taskTrackerFactsObservedEvent(
          operation.operationId,
          makeCompleteTaskTrackerFactsObserved(operation, projected.snapshot)
        )
      )

      const establishedLayer = yield* makeReactiveDeliveryRelationsLayer(runId, target, journal, unavailableProjection)
      const establishedRelation = yield* deliveryRuntime.pipe(Effect.provide(establishedLayer))
      const established = Option.getOrThrow(yield* establishedRelation.changes.pipe(Stream.runHead))
      expect(established.current.trackerGraph._tag).toBe("GraphEstablished")
    }).pipe(Effect.provide(memoryJournalStoreLayer))
  )
)

it.effect("publishes a typed failure when journal-triggered reconciliation cannot read journal state", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const journal = yield* makeJournalService
      const journalState = yield* journal.state.get
      const failRead = yield* Ref.make(false)
      const journalFailure = new JournalHistoryInvalid({
        position: journalState.position,
        detail: "probe read failed",
        runId
      })
      const failingJournal = {
        ...journal,
        state: {
          ...journal.state,
          get: Ref.get(failRead).pipe(
            Effect.flatMap((failed) => (failed ? Effect.fail(journalFailure) : journal.state.get))
          )
        }
      }
      const layer = yield* makeReactiveDeliveryRelationsLayer(
        runId,
        target,
        failingJournal,
        currentProjection(journal.state.get.pipe(Effect.orDie))
      )
      const relation = yield* deliveryRuntime.pipe(Effect.provide(layer))
      const publication = yield* DeliveryAcceptedFactPublication.pipe(Effect.provide(layer))
      yield* Ref.set(failRead, true)
      const publicationFailure = yield* publication.awaitCurrent.pipe(Effect.flip)
      const failed = yield* relation.changes.pipe(Stream.drop(1), Stream.runHead, Effect.flip, Effect.forkChild)
      const trigger = makeTrackerGraphObservationOperation(
        { _tag: "WorkflowEstablishment" },
        OperationId.make("journal-read-failure-trigger"),
        target
      )
      yield* journal.append(runId, intentRecordKey(trigger.operationId), taskTrackerReadIntent(trigger))
      const failure = yield* Fiber.join(failed)

      expect(failure).toBeInstanceOf(DeliveryRelationReconciliationError)
      expect(publicationFailure).toBeInstanceOf(DeliveryRelationReconciliationError)
      if (!(publicationFailure instanceof DeliveryRelationReconciliationError)) {
        return expect.fail("expected publication failure")
      }
      expect(Cause.squash(publicationFailure.cause)).toEqual(journalFailure)
      if (!(failure instanceof DeliveryRelationReconciliationError)) return expect.fail("expected relation failure")
      expect(Cause.squash(failure.cause)).toEqual(journalFailure)
    }).pipe(Effect.provide(memoryJournalStoreLayer))
  )
)

it.effect("publishes a typed failure when the journal signal closes with failure", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const journal = yield* makeJournalService
      const journalState = yield* journal.state.get
      const journalFailure = new JournalHistoryInvalid({
        position: journalState.position,
        detail: "journal signal failed",
        runId
      })
      const failingJournal = {
        ...journal,
        state: {
          ...journal.state,
          changes: Stream.succeed(journalState).pipe(Stream.concat(Stream.fail(journalFailure)))
        }
      }
      const layer = yield* makeReactiveDeliveryRelationsLayer(
        runId,
        target,
        failingJournal,
        currentProjection(journal.state.get.pipe(Effect.orDie))
      )
      const relation = yield* deliveryRuntime.pipe(Effect.provide(layer))
      const failure = yield* relation.changes.pipe(
        Stream.dropWhile(({ current }) => current.trackerGraph._tag === "GraphNotEstablished"),
        Stream.runHead,
        Effect.flip
      )

      expect(failure).toBeInstanceOf(DeliveryRelationReconciliationError)
      if (!(failure instanceof DeliveryRelationReconciliationError)) return expect.fail("expected relation failure")
      expect(Cause.squash(failure.cause)).toEqual(journalFailure)
    }).pipe(Effect.provide(memoryJournalStoreLayer))
  )
)

it.effect("fails an accepted-fact waiter when the journal signal fails", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const journal = yield* makeJournalService
      const journalState = yield* journal.state.get
      const journalFailure = new JournalHistoryInvalid({
        position: journalState.position,
        detail: "journal signal failed with an accepted-fact waiter pending",
        runId
      })
      const failJournalSignal = yield* Deferred.make<void>()
      const failingJournal = {
        ...journal,
        state: {
          ...journal.state,
          changes: Stream.succeed(journalState).pipe(
            Stream.concat(
              Stream.fromEffect(Deferred.await(failJournalSignal).pipe(Effect.andThen(Effect.fail(journalFailure))))
            )
          )
        }
      }
      const layer = yield* makeReactiveDeliveryRelationsLayer(
        runId,
        target,
        failingJournal,
        currentProjection(journal.state.get.pipe(Effect.orDie))
      )
      const publication = yield* DeliveryAcceptedFactPublication.pipe(Effect.provide(layer))
      const trigger = makeTrackerGraphObservationOperation(
        { _tag: "WorkflowEstablishment" },
        OperationId.make("pending-waiter-failure-trigger"),
        target
      )
      yield* journal.append(runId, intentRecordKey(trigger.operationId), taskTrackerReadIntent(trigger))
      const waiting = yield* publication.awaitCurrent.pipe(Effect.flip, Effect.forkChild)
      yield* Effect.yieldNow
      expect(waiting.pollUnsafe()).toBeUndefined()

      yield* Deferred.succeed(failJournalSignal, undefined)
      const failure = yield* Fiber.join(waiting)

      expect(failure).toBeInstanceOf(DeliveryRelationReconciliationError)
      if (!(failure instanceof DeliveryRelationReconciliationError)) return expect.fail("expected waiter failure")
      expect(Cause.squash(failure.cause)).toEqual(journalFailure)
    }).pipe(Effect.provide(memoryJournalStoreLayer))
  )
)
