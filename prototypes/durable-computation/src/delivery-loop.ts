import { join } from "node:path"
import { GitCommitSha, RunId, TaskExecutorLocator, TaskId, WorktreeLocator } from "@dalph/contracts"
import {
  InitialControlPolicy,
  JournalDatabaseLocator,
  JournalStore,
  makeCompleteTaskTrackerFactsObserved,
  makeTrackerGraphObservationOperation,
  memoryJournalStoreLayer,
  reduceWorkflowJournalHistory,
  sqliteJournalStoreLayer,
  taskTrackerFactsObservedEvent,
  taskTrackerReadIntent
} from "@dalph/orchestrator"
import * as NodeCrypto from "@effect/platform-node/NodeCrypto"
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient"
import { Effect, Layer, Ref, Schema, SubscriptionRef } from "effect"
import { ClusterWorkflowEngine, SingleRunner } from "effect/unstable/cluster"
import { Activity, Workflow, WorkflowEngine } from "effect/unstable/workflow"
import { FixtureTarget } from "../../../packages/orchestrator/dist/src/authorities/task-tracker/fixture/target.js"
import { TaskDagSnapshot } from "../../../packages/orchestrator/dist/src/authorities/task-tracker/graph.js"
import {
  TaskLifecycle,
  TrackerRevision,
  TrackerSnapshot
} from "../../../packages/orchestrator/dist/src/authorities/task-tracker/task.js"
import { TaskWorkCapacity } from "../../../packages/orchestrator/dist/src/coordination/admission/capacity.js"
import { makeApplicationExitLifecycle } from "../../../packages/orchestrator/dist/src/coordination/application-exit/lifecycle.js"
import {
  type DeliveryActionExecutorService,
  type DeliveryActionResult
} from "../../../packages/orchestrator/dist/src/coordination/delivery/delivery-action-executor.js"
import { DeliveryActionExecutor } from "../../../packages/orchestrator/dist/src/coordination/delivery/delivery-action-executor.js"
import { trackerGraphReadProposalOf } from "../../../packages/orchestrator/dist/src/coordination/delivery/delivery-action-proposal.js"
import { DeliveryProposalId } from "../../../packages/orchestrator/dist/src/coordination/delivery/delivery-action-proposal.js"
import { deliveryRuntime } from "../../../packages/orchestrator/dist/src/coordination/delivery/delivery-runtime-adapter.js"
import {
  deliveryRuntimeResourcesLayer
} from "../../../packages/orchestrator/dist/src/coordination/delivery/delivery-runtime-resources.js"
import {
  deterministicDeliveryRuntimeSupport,
  makeDeliveryRelationsLayer
} from "../../../packages/orchestrator/dist/src/coordination/delivery/in-memory-relations.js"
import {
  currentSignalFromCurrentFirstStream,
  TrackerGraphState,
  type DeliveryActionProposal,
  type DeliveryRelationInputBundle,
  type TrackerGraphActionProposal
} from "../../../packages/orchestrator/dist/src/coordination/delivery/relations.js"
import { runDeliveryRuntime } from "../../../packages/orchestrator/dist/src/coordination/delivery/run-delivery-runtime.js"
import { makeJournal } from "../../../packages/orchestrator/dist/src/coordination/delivery/journal.js"
import {
  initialRunPolicyRevision,
  RunControlPolicy
} from "../../../packages/orchestrator/dist/src/control/policy.js"
import { JournalPosition } from "../../../packages/orchestrator/dist/src/workflow-journal/identity.js"
import {
  intentRecordKey,
  outcomeRecordKey
} from "../../../packages/orchestrator/dist/src/workflow-journal/record-key.js"
import { OperationId } from "../../../packages/orchestrator/dist/src/workflow/identity.js"
import {
  deterministicPlannedTaskAttemptLayer,
  OperationIdAllocator
} from "../../../packages/orchestrator/dist/src/workflow/protocols/task-attempt-planning/plan.js"
import { plannedAttemptProtocolControllerLayer } from "../../../packages/orchestrator/dist/src/workflow/protocols/planned-attempt-executor-work/protocol-controller.js"
import {
  DeliveryLoopBoundaryCall,
  DeliveryLoopPublication,
  fixture
} from "./contracts.ts"
import {
  readCurrentTaskFacts,
  readTrackerGraphForDelivery,
  recordDeliveryProposalObservation,
  recordDeliveryPublication
} from "./controlled-world.ts"

interface DeliveryLoopInput {
  readonly actionCount: 1 | 2
  readonly adapter: "effect-workflow-v1" | "journal-baseline"
  readonly activityIdentityMode: "ExactOperationId" | "Generic"
  readonly onExecutionStored: (executionId: string) => Promise<void>
  readonly onFault: () => Promise<never>
  readonly processInstance: string
  readonly publicationMode: "Publish" | "Suppress"
  readonly workspace: string
}

const deliveryRunId = RunId.make("run-233-delivery-loop-0001")
const policy = RunControlPolicy.make({
  revision: initialRunPolicyRevision,
  taskExecutionCapacity: TaskWorkCapacity.make(1)
})
const targets = [FixtureTarget.make("delivery-loop-target"), FixtureTarget.make("delivery-loop-target")] as const

const trackerProposal = (): TrackerGraphActionProposal =>
  trackerGraphReadProposalOf({
    acceptedAt: null,
    purpose: "EstablishCurrentGraph",
    runId: deliveryRunId,
    target: targets[0]
  })

const reflectionProposal = (ordinal: number): DeliveryActionProposal => {
  const proposal = trackerGraphReadProposalOf({
    acceptedAt: ordinal === 0 ? null : JournalPosition.make(ordinal),
    purpose: "EstablishCurrentGraph",
    runId: deliveryRunId,
    target: targets[ordinal] ?? targets[0]
  })
  return {
    ...proposal,
    id: DeliveryProposalId.make(`${proposal.id}:reflection:${ordinal}`),
    owner: "DeliveryReflection"
  }
}

const snapshotFor = (result: DeliveryLoopBoundaryCall) => {
  const projected = TaskDagSnapshot.project(
    TrackerSnapshot.make({
      revision: TrackerRevision.make(`tracker-revision-${result.trackerRevision}-${result.operationId}`),
      tasks: [
        {
          id: TaskId.make(`task:${result.target}`),
          lifecycle: TaskLifecycle.cases.Open.make({}),
          parentTaskId: null,
          prerequisiteIds: []
        }
      ]
    })
  )
  if (projected._tag === "Invalid") return Effect.die("controlled tracker graph must project")
  return Effect.succeed(projected.snapshot)
}

const graphStateFor = (result: DeliveryLoopBoundaryCall) => {
  const operationId = OperationId.make(result.operationId)
  return Effect.scoped(
    Effect.gen(function* () {
      const snapshot = yield* snapshotFor(result)
      const storage = yield* JournalStore
      const target = FixtureTarget.make(`accepted-${result.target}`)
      const runId = RunId.make(`accepted:${result.operationId}`)
      const initialPolicy = InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
      yield* storage.beginRun(runId, target, initialPolicy)
      const reconstructed = reduceWorkflowJournalHistory(runId, yield* storage.read(runId))
      if (reconstructed._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die(reconstructed)
      const journal = yield* makeJournal(runId, target, reconstructed, storage)
      const operation = makeTrackerGraphObservationOperation(operationId, target)
      yield* journal.append(runId, intentRecordKey(operationId), taskTrackerReadIntent(operation))
      yield* journal.append(
        runId,
        outcomeRecordKey(operationId),
        taskTrackerFactsObservedEvent(
          operationId,
          makeCompleteTaskTrackerFactsObserved(operation, snapshot)
        )
      )
      const state = yield* journal.state.get
      if (state.graph._tag !== "GraphEstablished") return yield* Effect.die("accepted graph was not established")
      return TrackerGraphState.cases.GraphEstablished.make({ observation: state.graph.observation })
    }).pipe(Effect.provide(memoryJournalStoreLayer))
  )
}

const bundleFor = (
  graph: DeliveryRelationInputBundle["publication"]["graph"],
  nextOrdinal: number,
  actionCount: number
): DeliveryRelationInputBundle => {
  const nextReflection =
    nextOrdinal > 0 && nextOrdinal < actionCount ? reflectionProposal(nextOrdinal) : undefined
  return {
    actionInputs: {
      proposalContributions: { deliverySettlement: [], issues: [], ticketDelivery: [] },
      reflectionProposals: nextReflection === undefined ? [] : [nextReflection],
      runtimeFacts: {
        acceptedAt: nextOrdinal === 0 ? null : JournalPosition.make(nextOrdinal),
        pauseCoverage: {
          _tag: "PauseCoverageGraphNotEstablished",
          applied: { run: { _tag: "RunUnpaused" }, tasks: { _tag: "NoTaskPauses" } }
        },
        quiescence: { _tag: "TrackerReconfirmationAllowed" },
        taskWork: { capacity: policy.taskExecutionCapacity, held: [] }
      },
      trackerGraphProposals: nextOrdinal === 0 ? [trackerProposal()] : []
    },
    publication: { exactEvidence: [], graph, policy }
  }
}

const workflowRuntimeLayer = (
  databasePath: string,
  handler: Layer.Layer<never, never, WorkflowEngine.WorkflowEngine>
) => {
  const sql = SqliteClient.layer({ filename: databasePath })
  const cluster = SingleRunner.layer({
    runnerStorage: "memory",
    shardingConfig: {
      entityMessagePollInterval: "20 millis",
      entityReplyPollInterval: "20 millis",
      refreshAssignmentsInterval: "20 millis",
      sendRetryInterval: "20 millis",
      simulateRemoteSerialization: true
    }
  }).pipe(Layer.provide([sql, NodeCrypto.layer]))
  return handler.pipe(Layer.provideMerge(ClusterWorkflowEngine.layer.pipe(Layer.provideMerge(cluster))))
}

const DeliveryLoopWorkflow = Workflow.make("DalphDeliveryLoop233", {
  error: Schema.Never,
  idempotencyKey: ({ runId }) => runId,
  payload: { runId: Schema.NonEmptyString },
  success: Schema.Void
})

const shouldFault = (processInstance: string, actionOrdinal: number): boolean =>
  (processInstance === "process-1" && actionOrdinal === 0) ||
  (processInstance === "process-2" && actionOrdinal === 1)

export const runEffectWorkflowDeliveryLoop = async (input: DeliveryLoopInput): Promise<void> => {
  const handler = DeliveryLoopWorkflow.toLayer((_payload, executionId) =>
    Effect.gen(function* () {
      yield* Effect.promise(() => input.onExecutionStored(executionId))
      const initial = bundleFor(TrackerGraphState.cases.GraphNotEstablished.make({}), 0, input.actionCount)
      const current = yield* SubscriptionRef.make(initial)
      const coherent = currentSignalFromCurrentFirstStream(SubscriptionRef.changes(current))
      const relations = makeDeliveryRelationsLayer({
        ...deterministicDeliveryRuntimeSupport(policy),
        coherent
      })
      const nextOperation = yield* Ref.make(0)
      const allocator = OperationIdAllocator.of({
        allocate: () =>
          Ref.getAndUpdate(nextOperation, (ordinal) => ordinal + 1).pipe(
            Effect.map((ordinal) =>
              OperationId.make(`delivery-operation-233-${String(ordinal + 1).padStart(4, "0")}`)
            )
          )
      })
      const workflowContext = yield* Effect.context<
        WorkflowEngine.WorkflowEngine | WorkflowEngine.WorkflowInstance
      >()
      const executor: DeliveryActionExecutorService = {
        execute: (action) =>
          Effect.gen(function* () {
            if (action._tag !== "FreshOperationAction") return yield* Effect.die("graph read must have an OperationId")
            const actionOrdinal = Number(String(action.operationId).slice(-4)) - 1
            const target = targets[actionOrdinal] ?? targets[0]
            const activity = Activity.make({
              error: Schema.Never,
              execute: Effect.promise(() =>
                readTrackerGraphForDelivery({
                  operationId: action.operationId,
                  processInstance: input.processInstance,
                  target,
                  workspace: input.workspace
                })
              ),
              name:
                input.activityIdentityMode === "ExactOperationId"
                  ? `ReadTrackerGraph/${action.operationId}`
                  : "ReadTrackerGraph",
              success: DeliveryLoopBoundaryCall
            })
            const result = yield* activity.pipe(Effect.provide(workflowContext))
            if (shouldFault(input.processInstance, actionOrdinal)) {
              return yield* Effect.promise(() => input.onFault())
            }
            if (input.publicationMode === "Suppress") return yield* Effect.never
            const graph = yield* graphStateFor(result).pipe(Effect.orDie)
            yield* SubscriptionRef.set(current, bundleFor(graph, actionOrdinal + 1, input.actionCount))
            yield* Effect.promise(() =>
              recordDeliveryPublication(
                input.workspace,
                DeliveryLoopPublication.make({
                  acceptedOperationId: result.operationId,
                  operationId: action.operationId,
                  processInstance: input.processInstance,
                  target: result.target,
                  trackerRevision: result.trackerRevision
                })
              )
            )
            return {
              _tag: "ActionCompleted",
              proposalId: action.proposal.id
            } satisfies DeliveryActionResult
          })
      }
      const before = yield* deliveryRuntime.pipe(
        Effect.provide(relations),
        Effect.flatMap((runtime) => runtime.get),
        Effect.orDie
      )
      if (before.proposedActions._tag !== "DeliveryProposalsAvailable" || before.proposedActions.proposals.length === 0) {
        return yield* Effect.die("delivery planning did not reproduce the pending proposal")
      }
      yield* Effect.promise(() =>
        recordDeliveryProposalObservation(
          input.workspace,
          input.processInstance === "process-1" ? "PresentBeforeCrash" : "PresentAfterRestartBeforePublication"
        )
      )
      const relation = yield* deliveryRuntime.pipe(Effect.provide(relations))
      const resources = Layer.unwrap(
        makeApplicationExitLifecycle().pipe(
          Effect.map((lifecycle) => deliveryRuntimeResourcesLayer(lifecycle.admission))
        )
      )
      const runtimeDependencies = Layer.mergeAll(
        resources,
        plannedAttemptProtocolControllerLayer,
        deterministicPlannedTaskAttemptLayer({
          baseSha: GitCommitSha.make(fixture.plannedBaseSha),
          executor: TaskExecutorLocator.make("executor:delivery-loop"),
          runId: deliveryRunId,
          worktreeRoot: WorktreeLocator.make("/controlled/no-worktree")
        }),
        Layer.succeed(OperationIdAllocator, allocator),
        Layer.succeed(DeliveryActionExecutor, DeliveryActionExecutor.of(executor))
      )
      yield* runDeliveryRuntime(relation).pipe(
        Effect.provide(runtimeDependencies),
        Effect.orDie
      )
      const after = yield* relation.get.pipe(Effect.orDie)
      if (after.proposedActions._tag !== "DeliveryProposalsAvailable" || after.proposedActions.proposals.length !== 0) {
        return yield* Effect.die("accepted fact publication did not remove the proposal")
      }
      yield* Effect.promise(() =>
        recordDeliveryProposalObservation(input.workspace, "AbsentAfterAcceptedFactPublication")
      )
      yield* Effect.promise(() =>
        readCurrentTaskFacts({
          adapter: "effect-workflow-v1",
          processInstance: input.processInstance,
          workspace: input.workspace
        })
      )
    })
  )
  const runtime = workflowRuntimeLayer(join(input.workspace, "delivery-loop-workflow.sqlite"), handler)
  await Effect.runPromise(
    DeliveryLoopWorkflow.execute({ runId: deliveryRunId }).pipe(Effect.provide(runtime), Effect.scoped)
  )
}

export const runJournalDeliveryLoop = async (input: DeliveryLoopInput): Promise<void> => {
  const journalRunId = RunId.make("run-233-delivery-loop-journal-0001")
  const journalTarget = targets[0]
  const journalLayer = sqliteJournalStoreLayer({
    filename: JournalDatabaseLocator.make(join(input.workspace, "delivery-loop-journal.sqlite"))
  })
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        yield* Effect.promise(() => input.onExecutionStored(journalRunId))
        const storage = yield* JournalStore
        let records = yield* storage.read(journalRunId)
        if (records.length === 0) {
          yield* storage.beginRun(
            journalRunId,
            journalTarget,
            InitialControlPolicy.make({ taskExecutionCapacity: policy.taskExecutionCapacity })
          )
          records = yield* storage.read(journalRunId)
        }
        const history = reduceWorkflowJournalHistory(journalRunId, records)
        if (history._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die(history)
        const journal = yield* makeJournal(journalRunId, journalTarget, history, storage)
        const initial = bundleFor(TrackerGraphState.cases.GraphNotEstablished.make({}), 0, input.actionCount)
        const current = yield* SubscriptionRef.make(initial)
        const coherent = currentSignalFromCurrentFirstStream(SubscriptionRef.changes(current))
        const relations = makeDeliveryRelationsLayer({
          ...deterministicDeliveryRuntimeSupport(policy),
          coherent
        })
        const nextOperation = yield* Ref.make(0)
        const allocator = OperationIdAllocator.of({
          allocate: () =>
            Ref.getAndUpdate(nextOperation, (ordinal) => ordinal + 1).pipe(
              Effect.map((ordinal) =>
                OperationId.make(`delivery-operation-233-${String(ordinal + 1).padStart(4, "0")}`)
              )
            )
        })
        const executor: DeliveryActionExecutorService = {
          execute: (action) =>
            Effect.gen(function* () {
              if (action._tag !== "FreshOperationAction") {
                return yield* Effect.die("graph read must have an OperationId")
              }
              const actionOrdinal = Number(String(action.operationId).slice(-4)) - 1
              const target = targets[actionOrdinal] ?? targets[0]
              const currentRecords = yield* storage.read(journalRunId)
              const outcomeIndex = currentRecords.findIndex(
                ({ event }) => event._tag === "TaskTrackerFactsObserved" && event.operationId === action.operationId
              )
              let graph: Extract<DeliveryRelationInputBundle["publication"]["graph"], { readonly _tag: "GraphEstablished" }>
              let publicationRevision: number
              if (outcomeIndex >= 0) {
                // Journal reconstruction deliberately restores historical graph knowledge without
                // asserting that it is the current graph. The baseline therefore performs the safe
                // tracker read again; Workflow replay instead republishes its stored read result.
                const currentResult = yield* Effect.promise(() =>
                  readTrackerGraphForDelivery({
                    operationId: action.operationId,
                    processInstance: input.processInstance,
                    target,
                    workspace: input.workspace
                  })
                )
                const currentGraph = yield* graphStateFor(currentResult).pipe(Effect.orDie)
                if (currentGraph._tag !== "GraphEstablished") {
                  return yield* Effect.die("current tracker read did not establish a graph")
                }
                graph = currentGraph
                publicationRevision = currentResult.trackerRevision
              } else {
                const operation = makeTrackerGraphObservationOperation(action.operationId, target)
                yield* journal.append(journalRunId, intentRecordKey(action.operationId), taskTrackerReadIntent(operation))
                const result = yield* Effect.promise(() =>
                  readTrackerGraphForDelivery({
                    operationId: action.operationId,
                    processInstance: input.processInstance,
                    target,
                    workspace: input.workspace
                  })
                )
                const snapshot = yield* snapshotFor(result)
                yield* journal.append(
                  journalRunId,
                  outcomeRecordKey(action.operationId),
                  taskTrackerFactsObservedEvent(
                    action.operationId,
                    makeCompleteTaskTrackerFactsObserved(operation, snapshot)
                  )
                )
                const accepted = yield* journal.state.get
                if (accepted.graph._tag !== "GraphEstablished") {
                  return yield* Effect.die("journal did not publish the accepted tracker result")
                }
                graph = accepted.graph
                publicationRevision = result.trackerRevision
              }
              if (shouldFault(input.processInstance, actionOrdinal)) {
                return yield* Effect.promise(() => input.onFault())
              }
              if (input.publicationMode === "Suppress") return yield* Effect.never
              yield* SubscriptionRef.set(current, bundleFor(graph, actionOrdinal + 1, input.actionCount))
              yield* Effect.promise(() =>
                recordDeliveryPublication(
                  input.workspace,
                  DeliveryLoopPublication.make({
                    acceptedOperationId: action.operationId,
                    operationId: action.operationId,
                    processInstance: input.processInstance,
                    target,
                    trackerRevision: publicationRevision
                  })
                )
              )
              return {
                _tag: "ActionCompleted",
                proposalId: action.proposal.id
              } satisfies DeliveryActionResult
            }).pipe(Effect.orDie)
        }
        const before = yield* deliveryRuntime.pipe(
          Effect.provide(relations),
          Effect.flatMap((runtime) => runtime.get),
          Effect.orDie
        )
        if (before.proposedActions._tag !== "DeliveryProposalsAvailable" || before.proposedActions.proposals.length === 0) {
          return yield* Effect.die("delivery planning did not reproduce the pending proposal")
        }
        yield* Effect.promise(() =>
          recordDeliveryProposalObservation(
            input.workspace,
            input.processInstance === "process-1" ? "PresentBeforeCrash" : "PresentAfterRestartBeforePublication"
          )
        )
        const relation = yield* deliveryRuntime.pipe(Effect.provide(relations))
        const resources = Layer.unwrap(
          makeApplicationExitLifecycle().pipe(
            Effect.map((lifecycle) => deliveryRuntimeResourcesLayer(lifecycle.admission))
          )
        )
        const runtimeDependencies = Layer.mergeAll(
          resources,
          plannedAttemptProtocolControllerLayer,
          deterministicPlannedTaskAttemptLayer({
            baseSha: GitCommitSha.make(fixture.plannedBaseSha),
            executor: TaskExecutorLocator.make("executor:delivery-loop"),
            runId: journalRunId,
            worktreeRoot: WorktreeLocator.make("/controlled/no-worktree")
          }),
          Layer.succeed(OperationIdAllocator, allocator),
          Layer.succeed(DeliveryActionExecutor, DeliveryActionExecutor.of(executor))
        )
        yield* runDeliveryRuntime(relation).pipe(Effect.provide(runtimeDependencies), Effect.orDie)
        const after = yield* relation.get.pipe(Effect.orDie)
        if (after.proposedActions._tag !== "DeliveryProposalsAvailable" || after.proposedActions.proposals.length !== 0) {
          return yield* Effect.die("accepted fact publication did not remove the proposal")
        }
        yield* Effect.promise(() =>
          recordDeliveryProposalObservation(input.workspace, "AbsentAfterAcceptedFactPublication")
        )
        yield* Effect.promise(() =>
          readCurrentTaskFacts({
            adapter: "journal-baseline",
            processInstance: input.processInstance,
            workspace: input.workspace
          })
        )
      }).pipe(Effect.provide(journalLayer), Effect.orDie)
    )
  )
}
