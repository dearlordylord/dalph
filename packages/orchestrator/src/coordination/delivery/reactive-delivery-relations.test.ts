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
  plannedAttemptExecutorCorrelation
} from "@dalph/contracts"
import { Cause, Deferred, Effect, Fiber, Layer, Option, Ref, Stream } from "effect"
import { expect } from "vitest"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { ClaimOwner, ClaimToken } from "../../authorities/task-tracker/claim.js"
import { ActiveTaskClaim } from "../../authorities/task-tracker/claim-mutation.js"
import { projectTrackerSnapshot } from "../../authorities/task-tracker/graph.js"
import { InitialControlPolicy } from "../../control/policy.js"
import { TrackerRevision } from "../../authorities/task-tracker/task.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import { OperationId } from "../../workflow/identity.js"
import { TaskAttemptPlannedEvent, taskTrackerReadIntent } from "../../workflow/registry/event.js"
import {
  makeTaskAttemptPlanOperation,
  makeTaskClaimReleaseOperation,
  makeTrackerGraphObservationOperation,
  TaskClaimReleaseAuthority
} from "../../workflow/registry/operation.js"
import {
  makeCompleteTaskTrackerFactsObserved,
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
import { InRunJournal, JournalHistoryInvalid, JournalStore } from "../../workflow-journal/store.js"
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
import { reduceWorkflowJournalHistory } from "../reconstruction/history.js"
import type { InvalidWorkflowJournalHistory } from "../reconstruction/history-result.js"
import { makeRunRecoveryProjection, readDeliveryProjectionFrom } from "../run/recovery-activation.js"
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
const recoveredAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("reactive-delivery-recovered-attempt"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/reactive-delivery-recovered"),
  executor: TaskExecutorLocator.make("executor:reactive-delivery-test"),
  runId,
  taskId: TaskId.make("recovered-task"),
  taskRevision: TaskRevision.make("reactive-delivery-recovered-revision"),
  worktree: WorktreeLocator.make("/worktrees/reactive-delivery-recovered")
})

const makeJournalService = Effect.gen(function* () {
  const storage = yield* JournalStore
  yield* storage.beginRun(runId, target, policy)
  const initial = reduceWorkflowJournalHistory(runId, yield* storage.read(runId))
  if (initial._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die(initial)
  return yield* makeJournal(runId, target, initial, storage)
})

const appendExecutorResponsibility = Effect.fn("ReactiveDeliveryTest.appendExecutorResponsibility")(function* (
  journal: Effect.Success<typeof makeJournalService>
) {
  const plan = makeTaskAttemptPlanOperation({
    operationId: OperationId.make("reactive-delivery-recovered-plan"),
    plannedAttempt: recoveredAttempt,
    predecessorOperationIds: []
  })
  yield* journal.append(
    runId,
    attemptPlanRecordKey(recoveredAttempt.attemptId),
    TaskAttemptPlannedEvent.make({ operation: plan, version: workflowJournalEventVersion })
  )
  yield* journal.append(
    runId,
    plannedAttemptExecutorWorkResponsibilityBeganRecordKey(recoveredAttempt.attemptId),
    PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
      plannedAttempt: recoveredAttempt,
      version: workflowJournalEventVersion
    })
  )
})

const appendExecutorCommand = Effect.fn("ReactiveDeliveryTest.appendExecutorCommand")(function* (
  journal: Effect.Success<typeof makeJournalService>,
  ordinal: number,
  command: "Begin" | "Resume" | "Suspend"
) {
  const commandOrdinal = PlannedAttemptExecutorCommandOrdinal.make(ordinal)
  yield* journal.append(
    runId,
    plannedAttemptExecutorCommandIntendedRecordKey(recoveredAttempt.attemptId, commandOrdinal),
    PlannedAttemptExecutorCommandIntendedEvent.make({
      command,
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      ordinal: commandOrdinal,
      plannedAttempt: recoveredAttempt,
      version: workflowJournalEventVersion
    })
  )
})

const appendCommandResponse = Effect.fn("ReactiveDeliveryTest.appendCommandResponse")(function* (
  journal: Effect.Success<typeof makeJournalService>,
  report: PlannedAttemptExecutorReport,
  commandOrdinalValue = 1
) {
  const commandOrdinal = PlannedAttemptExecutorCommandOrdinal.make(commandOrdinalValue)
  yield* journal.append(
    runId,
    plannedAttemptExecutorCommandResponseObservedRecordKey(recoveredAttempt.attemptId, commandOrdinal),
    PlannedAttemptExecutorCommandResponseObservedEvent.make({
      commandOrdinal,
      occurrenceClassification: "NonActionOccurrence",
      plannedAttempt: recoveredAttempt,
      report,
      version: workflowJournalEventVersion
    })
  )
})

const appendDirectExecutorReport = Effect.fn("ReactiveDeliveryTest.appendDirectExecutorReport")(function* (
  journal: Effect.Success<typeof makeJournalService>,
  report: PlannedAttemptExecutorReport,
  ordinal: number
) {
  const reportOrdinal = PlannedAttemptExecutorReportOrdinal.make(ordinal)
  yield* journal.append(
    runId,
    plannedAttemptExecutorWorkReportedRecordKey(recoveredAttempt.attemptId, reportOrdinal),
    PlannedAttemptExecutorWorkReportedEvent.make({
      ordinal: reportOrdinal,
      report,
      version: workflowJournalEventVersion
    })
  )
})

const appendAcceptedExecutingExecutorHistory = Effect.fn("ReactiveDeliveryTest.appendAcceptedExecutingExecutorHistory")(
  function* (journal: Effect.Success<typeof makeJournalService>) {
    yield* appendExecutorResponsibility(journal)
    yield* appendExecutorCommand(journal, 1, "Begin")
    const executingReport = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
      correlation: plannedAttemptExecutorCorrelation(recoveredAttempt)
    })
    yield* appendCommandResponse(journal, executingReport)
    yield* appendDirectExecutorReport(journal, executingReport, 1)
  }
)

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
    return yield* makeProductionReactiveDeliveryRelationsLayer(runId, target, journal, recovery, integrationTargets)
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
      const operation = makeTrackerGraphObservationOperation(OperationId.make("observed-production-bundle"), target)
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
        const operation = makeTrackerGraphObservationOperation(operationId, graphTarget)
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
        proposals: [
          {
            route: {
              _tag: "FreshWorkflowRoute",
              step: {
                _tag: "ReadCurrentTaskGraph",
                predecessorOperationId: OperationId.make("reactive-delivery-target-A"),
                task: { id: TaskId.make("A") }
              }
            }
          }
        ]
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
      const unrelatedOwnership = { integrationTarget, queuedAt: JournalPosition.make(99) }
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
      const first = makeTrackerGraphObservationOperation(OperationId.make("integrated-G1"), target)
      const second = makeTrackerGraphObservationOperation(OperationId.make("integrated-G2"), target)
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
      const recovery = {
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
      const operation = makeTrackerGraphObservationOperation(OperationId.make("publication-handshake"), target)

      yield* journal.append(runId, intentRecordKey(operation.operationId), taskTrackerReadIntent(operation))
      yield* Deferred.await(refreshStarted)
      const waiting = yield* publication.awaitCurrent.pipe(Effect.forkChild)
      yield* Effect.yieldNow
      expect(waiting.pollUnsafe()).toBeUndefined()
      yield* Deferred.succeed(projectionBlocked, undefined)
      yield* Fiber.join(waiting)
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
      const recovery = {
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
      const operation = makeTrackerGraphObservationOperation(OperationId.make("interrupted-publication-waiter"), target)
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
      const operation = makeTrackerGraphObservationOperation(OperationId.make("cancelled-publication-waiter"), target)
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
        currentProjection(journal.state.get.pipe(Effect.orDie))
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
      expect(evaluation.proposedActions).toEqual({
        _tag: "DeliveryProposalsAvailable",
        isolatedIssues: [],
        proposals: []
      })
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
      const recovery = {
        readDeliveryProjection: Effect.gen(function* () {
          const readNumber = yield* Ref.updateAndGet(projectionReads, (count) => count + 1)
          const journalState = yield* journal.state.get
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
      const operation = makeTrackerGraphObservationOperation(OperationId.make("coherent-race-read"), target)
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

it.effect("does not propose the initial graph read while recovered boundary work remains", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const journal = yield* makeJournalService
      const recoveredTransitions = yield* Ref.make<ReadonlyArray<RunnableFrontierTransition>>([
        RunnableFrontierTransition.SuspendPlannedAttemptExecutorWork({ plannedAttempt: recoveredAttempt })
      ])
      const recovery = {
        readDeliveryProjection: Effect.all({
          journalState: journal.state.get,
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
      const recovery = {
        readDeliveryProjection: journal.state.get.pipe(
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
      const recoveryFailure: InvalidWorkflowJournalHistory = {
        _tag: "InvalidWorkflowJournalHistory",
        issues: [],
        records: [],
        runId
      }
      const recovery = {
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
      const trigger = makeTrackerGraphObservationOperation(OperationId.make("projection-failure-trigger"), target)
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

      const operation = makeTrackerGraphObservationOperation(OperationId.make("unavailable-evidence-graph"), target)
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
      const trigger = makeTrackerGraphObservationOperation(OperationId.make("journal-read-failure-trigger"), target)
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
      const trigger = makeTrackerGraphObservationOperation(OperationId.make("pending-waiter-failure-trigger"), target)
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
