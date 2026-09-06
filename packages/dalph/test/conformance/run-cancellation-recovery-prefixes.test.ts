import { NodeCrypto } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Context, Effect, Layer } from "effect"
import { expect } from "vitest"
import {
  GitCommitSha,
  PlannedAttemptExecutor,
  PlannedAttemptExecutorProjection,
  type RunId,
  TaskExecutorLocator,
  WorktreeLocator
} from "@dalph/contracts"
import { idleRunCancellationRecoveryAuthoredCassette, runAuthoredScenarioCassette } from "../../src/cassettes/index.js"
import { controlledSynchronousPlannedAttemptExecutorLayer } from "../../test-support/controlled-synchronous-planned-attempt-executor.js"
import { AllocatedWorkflowRunId } from "../../../orchestrator/src/coordination/run/fresh-run-identity.js"
import { JournaledRunBootstrap } from "../../../orchestrator/src/coordination/run/run.js"
import { RunRecoveryProjection } from "../../../orchestrator/src/coordination/run/recovery-activation.js"
import { validatedRunActivationLayer } from "../../../orchestrator/src/coordination/run/startup-recovery.js"
import { journaledRunBootstrapLayer } from "../../../orchestrator/src/coordination/run/journaled-run-bootstrap.js"
import { noopJournalMaintenanceObservation } from "../../../orchestrator/src/workflow-journal/maintenance.js"
import { runStabilizedDelivery } from "../../../orchestrator/src/coordination/run/run-stabilization.js"
import { DeliveryActionExecutor } from "../../../orchestrator/src/coordination/delivery/delivery-action-executor.js"
import { DeliveryAcceptedFactPublication } from "../../../orchestrator/src/coordination/delivery/delivery-accepted-fact-publication.js"
import { deliveryRuntime } from "../../../orchestrator/src/coordination/delivery/delivery-runtime-adapter.js"
import { DeliveryRuntimeResources } from "../../../orchestrator/src/coordination/delivery/delivery-runtime-resources.js"
import { makeReactiveDeliveryRelationsLayer } from "../../../orchestrator/src/coordination/delivery/reactive-delivery-relations.js"
import { executeFreshTrackerGraphRead } from "../../../orchestrator/src/coordination/delivery/delivery-action-adapter-common.js"
import { Journal } from "../../../orchestrator/src/coordination/delivery/journal.js"
import {
  projectTrackerSnapshot,
  type TaskDagSnapshot
} from "../../../orchestrator/src/authorities/task-tracker/graph.js"
import { WorkflowInterpreter, WorkflowTrace } from "../../../orchestrator/src/workflow/interpretation/interpreter.js"
import { journaledWorkflowInterpreterLayer } from "../../../orchestrator/src/workflow-journal/journaled-interpreter.js"
import {
  journalStoreCapabilities,
  JournalStore,
  RunLifecycleJournal,
  type JournalRecord
} from "../../../orchestrator/src/workflow-journal/store.js"
import { CoordinatorOwnership } from "../../../orchestrator/src/authorities/coordinator-ownership/ownership.js"
import { makeApplicationExitShell } from "../../../orchestrator/src/coordination/application-exit/application-shell.js"
import { attemptChoiceControlLayer } from "../../../orchestrator/src/workflow/protocols/attempt-choice/control.js"
import { controlDirectionApplicationLayer } from "../../../orchestrator/src/workflow/protocols/control-direction-application/protocol.js"
import { taskClaimReacquisitionControlLayer } from "../../../orchestrator/src/workflow/protocols/task-claim-reacquisition/control.js"
import { taskWorkCapacityControlLayer } from "../../../orchestrator/src/control/task-work-capacity.js"
import {
  deterministicOperationIdAllocatorLayer,
  deterministicPlannedTaskAttemptLayer,
  PlannedTaskAttemptPlanner
} from "../../../orchestrator/src/workflow/protocols/task-attempt-planning/plan.js"
import {
  expectedRecoveryPrefix,
  prefixThrough,
  replayRecoveryPrefix,
  recoveryPrefixMismatch,
  type RecoveryPrefix,
  withRecoveryPrefixStore
} from "./recovery-store-lanes.js"

const graphReadIntent = (record: JournalRecord): boolean =>
  record.event._tag === "TaskTrackerReadIntentRecorded" && record.event.operation._tag === "ReadTrackerGraph"

const graphReadOperationId = (record: JournalRecord | undefined): string | undefined => {
  if (record?.event._tag !== "TaskTrackerReadIntentRecorded" || record.event.operation._tag !== "ReadTrackerGraph") {
    return undefined
  }
  return record.event.operation.operationId
}

const graphReadObservation = (record: JournalRecord, operationId: string): boolean =>
  record.event._tag === "TaskTrackerFactsObserved" && record.event.operationId === operationId

type ProductionRecoveryOutcome =
  | { readonly _tag: "Activated"; readonly decision: string; readonly records: ReadonlyArray<JournalRecord> }
  | { readonly _tag: "Rejected"; readonly failureTag: string; readonly records: ReadonlyArray<JournalRecord> }

const tagOf = (value: unknown): string =>
  typeof value === "object" && value !== null && "_tag" in value && typeof value._tag === "string"
    ? value._tag
    : "UnknownFailure"

const cancellationRecoveryExecutorLayer = () => {
  const executor = PlannedAttemptExecutor.of({
    observe: (correlation) => Effect.succeed(PlannedAttemptExecutorProjection.cases.NoReport.make({ correlation })),
    requestSuspension: () => Effect.die("cancellation recovery has no executor responsibility"),
    resume: () => Effect.die("cancellation recovery has no executor responsibility"),
    begin: () => Effect.die("cancellation recovery has no executor responsibility")
  })
  return controlledSynchronousPlannedAttemptExecutorLayer(Layer.succeed(PlannedAttemptExecutor, executor))
}

const productionRuntimeLayer = (
  runId: RunId,
  graph: TaskDagSnapshot,
  executorLayer: ReturnType<typeof cancellationRecoveryExecutorLayer>
) => {
  const interpreter = WorkflowInterpreter.of({
    acquireTaskClaim: () => Effect.die("cancellation recovery does not acquire a task claim"),
    readTaskClaim: () => Effect.die("cancellation recovery does not read a task claim"),
    readTaskWorktree: () => Effect.die("cancellation recovery does not read Git worktrees"),
    readTargetLineage: () => Effect.die("cancellation recovery does not read Git lineage"),
    readTrackerGraph: () => Effect.succeed(graph),
    readTaskWorkSpecification: () => Effect.die("cancellation recovery does not read task specifications"),
    reconcileTaskWorktree: () => Effect.die("cancellation recovery does not reconcile Git worktrees"),
    recordTaskAttemptPlan: () => Effect.die("cancellation recovery does not plan task work"),
    releaseTaskClaim: () => Effect.die("cancellation recovery does not release task claims")
  })
  const controls = Layer.mergeAll(
    attemptChoiceControlLayer,
    controlDirectionApplicationLayer,
    taskClaimReacquisitionControlLayer,
    taskWorkCapacityControlLayer
  )
  return validatedRunActivationLayer(runId, undefined).pipe(
    Layer.provide(journaledWorkflowInterpreterLayer(runId, Layer.succeed(WorkflowInterpreter, interpreter))),
    Layer.provide(controls),
    Layer.provide(deterministicOperationIdAllocatorLayer(`cancellation-recovery:${runId}`)),
    Layer.provide(
      deterministicPlannedTaskAttemptLayer({
        baseSha: GitCommitSha.make("1".repeat(40)),
        executor: TaskExecutorLocator.make("executor:cancellation-recovery"),
        runId,
        worktreeRoot: WorktreeLocator.make("/worktrees/cancellation-recovery")
      })
    ),
    Layer.provide(executorLayer),
    Layer.provide(Layer.succeed(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })))
  )
}

const runProductionRecovery = (prefix: RecoveryPrefix, lane: "memory" | "sqlite", graph: TaskDagSnapshot) =>
  withRecoveryPrefixStore(prefix, lane, (storage) =>
    Effect.gen(function* () {
      const first = prefix.records[0]
      if (first.event._tag !== "WorkflowRunBegan") {
        return yield* Effect.die("production recovery prefix has no Run beginning")
      }
      const runId = first.runId
      const target = first.event.target
      const ownership = CoordinatorOwnership.of({ release: Effect.void, runMutation: (mutation) => mutation })
      const executorLayer = cancellationRecoveryExecutorLayer()
      const journalContext = yield* Layer.build(journalStoreCapabilities(Layer.succeed(JournalStore, storage)))
      const dependencies = Layer.mergeAll(
        Layer.succeed(JournalStore, storage),
        Layer.succeed(RunLifecycleJournal, Context.get(journalContext, RunLifecycleJournal)),
        Layer.succeed(CoordinatorOwnership, ownership)
      )
      const applicationExit = yield* makeApplicationExitShell(ownership, { requestEnd: () => Effect.void })
      const bootstrapContext = yield* Layer.build(
        journaledRunBootstrapLayer(
          runId,
          ({ runId: activeRunId }) => productionRuntimeLayer(activeRunId, graph, executorLayer),
          applicationExit,
          noopJournalMaintenanceObservation
        ).pipe(Layer.provide(dependencies), Layer.provide(executorLayer))
      )
      const bootstrap = Context.get(bootstrapContext, JournaledRunBootstrap)
      const program = Effect.gen(function* () {
        if (prefix.cut === "P0") {
          yield* bootstrap.operatorControl.applyRunCancellation({ runId })
        }
        const journal = yield* Journal
        const recovery = yield* RunRecoveryProjection
        const resources = yield* DeliveryRuntimeResources
        const relations = yield* makeReactiveDeliveryRelationsLayer(
          runId,
          target,
          journal,
          recovery,
          resources.integrationTargets
        )
        const relation = yield* deliveryRuntime.pipe(Effect.provide(relations))
        const acceptedFactPublication = yield* DeliveryAcceptedFactPublication.pipe(Effect.provide(relations))
        const interpreter = yield* WorkflowInterpreter
        const trace = yield* WorkflowTrace
        const finalityExecutor = DeliveryActionExecutor.of({
          execute: (action, lease) =>
            action._tag === "FreshOperationAction" && action.proposal.route._tag === "TrackerGraphReadRoute"
              ? executeFreshTrackerGraphRead(action, action.proposal.route, lease).pipe(
                  Effect.provideService(WorkflowInterpreter, interpreter),
                  Effect.provideService(WorkflowTrace, trace)
                )
              : Effect.succeed({
                  _tag: "ActionDeferred" as const,
                  proposalId: action.proposal.id,
                  reason: "TrackerGraphReadUnavailable" as const
                })
        })
        return yield* runStabilizedDelivery(target, runId, relation).pipe(
          Effect.provideService(DeliveryActionExecutor, finalityExecutor),
          Effect.provideService(DeliveryAcceptedFactPublication, acceptedFactPublication),
          Effect.provideService(
            PlannedTaskAttemptPlanner,
            PlannedTaskAttemptPlanner.of({ plan: () => Effect.die("cancellation recovery planned task work") })
          )
        )
      })
      if (prefix.cut === "P6") {
        const failure = yield* bootstrap
          .activate(
            target,
            Effect.die("terminal recovery must not evaluate the initial policy"),
            AllocatedWorkflowRunId.make(runId),
            Effect.die("terminal recovery must not enter the runtime")
          )
          .pipe(Effect.flip)
        return { _tag: "Rejected" as const, failureTag: tagOf(failure), records: yield* storage.read(runId) }
      }
      const decision = yield* bootstrap.activate(
        target,
        Effect.die("recovery must not evaluate a replacement initial policy"),
        AllocatedWorkflowRunId.make(runId),
        program
      )
      return { _tag: "Activated" as const, decision: decision._tag, records: yield* storage.read(runId) }
    })
  )

const assertProductionRecovery = (
  prefix: RecoveryPrefix,
  outcome: ProductionRecoveryOutcome,
  graph: TaskDagSnapshot
): void => {
  const retainedGraphIntentCount = prefix.records.filter(graphReadIntent).length
  const newRecords = outcome.records.slice(prefix.records.length)
  const newGraphIntents = newRecords.filter(graphReadIntent)
  const cancellationRecords = outcome.records.filter((record) => record.event._tag === "RunCancellationApplied")
  const terminalRecords = outcome.records.filter((record) => record.event._tag === "WorkflowRunTerminated")

  expect(cancellationRecords).toHaveLength(1)
  expect(terminalRecords).toHaveLength(1)
  if (prefix.cut === "P6") {
    expect(outcome).toMatchObject({ _tag: "Rejected", failureTag: "WorkflowRunAlreadyTerminated" })
    expect(outcome._tag).toBe("Rejected")
    expect(newGraphIntents).toHaveLength(0)
    expect(terminalRecords).toHaveLength(1)
    return
  }

  expect(outcome).toMatchObject({ _tag: "Activated", decision: "RunMayTerminate" })
  expect(outcome._tag).toBe("Activated")
  expect(newGraphIntents.length).toBeGreaterThanOrEqual(1)
  expect(outcome.records.filter(graphReadIntent)).toHaveLength(retainedGraphIntentCount + newGraphIntents.length)
  const freshIntent = newGraphIntents.at(-1)
  if (
    freshIntent === undefined ||
    freshIntent.event._tag !== "TaskTrackerReadIntentRecorded" ||
    freshIntent.event.operation._tag !== "ReadTrackerGraph"
  )
    return

  const freshOperationId = freshIntent.event.operation.operationId
  const freshReadShape = freshIntent.event.operation.readShape
  const observations = newRecords.filter((record) => graphReadObservation(record, freshOperationId))
  expect(observations).toHaveLength(1)
  const observation = observations[0]
  if (observation === undefined || observation.event._tag !== "TaskTrackerFactsObserved") return
  expect(["CompleteTaskTrackerFacts", "UnchangedTaskTrackerFactsReconfirmed"]).toContain(
    observation.event.observation._tag
  )
  if (
    observation.event.observation._tag !== "CompleteTaskTrackerFacts" &&
    observation.event.observation._tag !== "UnchangedTaskTrackerFactsReconfirmed"
  )
    return

  const expectedTarget = prefix.records[0]
  if (expectedTarget.event._tag !== "WorkflowRunBegan") return
  expect(observation.event.observation.rootTaskId).toBe(graph.rootTaskId)
  for (const family of observation.event.observation.factFamilies) {
    expect(family.contentIdentity).toBe(graph.revision)
    expect(family.coverage.target).toEqual(expectedTarget.event.target)
    expect(family.coverage.explicitlyCoveredTaskIds).toEqual(freshReadShape.explicitlyCoveredTaskIds)
  }

  const terminal = terminalRecords[0]
  if (terminal === undefined || terminal.event._tag !== "WorkflowRunTerminated") return
  expect(terminal.event.disposition).toBe("Cancelled")
  expect(terminal.event.evidence.operationId).toBe(freshOperationId)
  expect(terminal.event.evidence.observedAt).toBe(observation.position)
  expect(terminal.position).toBeGreaterThan(terminal.event.evidence.observedAt)
  expect(terminal.event.evidence.rootTaskId).toBe(graph.rootTaskId)
  expect(terminal.event.evidence.contentIdentity).toBe(graph.revision)
  expect(terminal.event.evidence.coverage.target).toEqual(expectedTarget.event.target)
  expect(terminal.event.evidence.coverage.explicitlyCoveredTaskIds).toEqual(freshReadShape.explicitlyCoveredTaskIds)
}

const cancellationRecoveryPrefixes = (records: ReadonlyArray<JournalRecord>): ReadonlyArray<RecoveryPrefix> => {
  const cancellationIndex = records.findIndex((record) => record.event._tag === "RunCancellationApplied")
  const terminalIndex = records.findIndex((record) => record.event._tag === "WorkflowRunTerminated")
  if (cancellationIndex < 1 || terminalIndex < 0) {
    return []
  }

  const postCancellationIntentIndices = records.flatMap((record, index) =>
    index > cancellationIndex && graphReadIntent(record) ? [index] : []
  )
  if (postCancellationIntentIndices.length < 2) {
    return []
  }

  const firstFreshIntentIndex = postCancellationIntentIndices[0]
  const finalFreshIntentIndex = postCancellationIntentIndices[postCancellationIntentIndices.length - 1]
  if (firstFreshIntentIndex === undefined || finalFreshIntentIndex === undefined) {
    return []
  }
  const firstFreshOperationId = graphReadOperationId(records[firstFreshIntentIndex])
  const finalFreshOperationId = graphReadOperationId(records[finalFreshIntentIndex])
  if (firstFreshOperationId === undefined || finalFreshOperationId === undefined) {
    return []
  }

  const firstFreshObservationIndex = records.findIndex(
    (record, index) => index > firstFreshIntentIndex && graphReadObservation(record, firstFreshOperationId)
  )
  const finalFreshObservationIndex = records.findIndex(
    (record, index) => index > finalFreshIntentIndex && graphReadObservation(record, finalFreshOperationId)
  )
  if (firstFreshObservationIndex < 0 || finalFreshObservationIndex < 0) {
    return []
  }

  return [
    prefixThrough(records, "P0", "the record before RunCancellationApplied", cancellationIndex - 1),
    prefixThrough(records, "P1", "RunCancellationApplied", cancellationIndex),
    prefixThrough(records, "P2", "fresh G2 graph read intent before the first recovery crash", firstFreshIntentIndex),
    prefixThrough(
      records,
      "P3",
      "fresh G2 graph observation before the first recovery crash",
      firstFreshObservationIndex
    ),
    prefixThrough(records, "P4", "fresh G2 graph read intent after coordinator re-entry", finalFreshIntentIndex),
    prefixThrough(
      records,
      "P5",
      "fresh G2 graph observation proving cancellation finality",
      finalFreshObservationIndex
    ),
    prefixThrough(records, "P6", "WorkflowRunTerminated", terminalIndex)
  ].filter((prefix): prefix is RecoveryPrefix => prefix !== undefined)
}

it.effect("replays cancellation recovery prefixes P0-P6 through memory and SQLite", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(idleRunCancellationRecoveryAuthoredCassette)
    const cancellationRecords = run.records.filter((record) => record.event._tag === "RunCancellationApplied")
    const terminalRecords = run.records.filter((record) => record.event._tag === "WorkflowRunTerminated")

    expect(run.activationOrdinals).toEqual([1, 2, 3])
    expect(cancellationRecords).toHaveLength(1)
    expect(terminalRecords).toHaveLength(1)
    expect(terminalRecords[0]?.event).toMatchObject({ _tag: "WorkflowRunTerminated", disposition: "Cancelled" })

    const prefixes = cancellationRecoveryPrefixes(run.records)
    expect(prefixes).toHaveLength(7)
    if (prefixes.length !== 7) return yield* Effect.die("cancellation recovery cassette lacks P0-P6 endpoints")
    const graphProjection = projectTrackerSnapshot(
      idleRunCancellationRecoveryAuthoredCassette.startingFacts.trackerGraph
    )
    if (graphProjection._tag !== "Valid") return yield* Effect.die("cancellation recovery graph fixture is invalid")
    for (const prefix of prefixes) {
      const expected = yield* expectedRecoveryPrefix(prefix)
      for (const lane of ["memory", "sqlite"] as const) {
        const actual = yield* replayRecoveryPrefix(prefix, lane)
        expect(recoveryPrefixMismatch(prefix.cut, lane, expected, actual)).toBeUndefined()
        const production = yield* runProductionRecovery(prefix, lane, graphProjection.snapshot)
        assertProductionRecovery(prefix, production, graphProjection.snapshot)
      }
    }
  }).pipe(Effect.provide(NodeCrypto.layer))
)
