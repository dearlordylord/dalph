import { join } from "node:path"
import * as NodeCrypto from "@effect/platform-node/NodeCrypto"
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient"
import {
  AttemptId,
  GitCommitSha,
  RunId,
  TaskBranchRef,
  TaskId,
  WorktreeLocator
} from "@dalph/contracts"
import {
  currentSignalFromCurrentFirstStream,
  DeliveryActionExecutor,
  type DeliveryActionExecutorService,
  deliveryRuntime,
  deterministicPlannedTaskAttemptLayer,
  JournalDatabaseLocator,
  JournalPosition,
  JournalStore,
  makeCompleteTaskTrackerFactsObserved,
  makeTrackerGraphObservationOperation,
  memoryJournalStoreLayer,
  OperationId,
  OperationIdAllocator,
  plannedAttemptProtocolControllerLayer,
  RunnableFrontierTransition,
  RunControlPolicy,
  sqliteJournalStoreLayer,
  TaskDagSnapshot,
  TaskLifecycle,
  TaskWorkCapacity,
  TrackerRevision,
  TrackerSnapshot,
  taskTrackerFactsObservedEvent,
  taskTrackerReadIntent,
  workflowJournalEventVersion,
  initialRunPolicyRevision,
  FixtureTarget,
  RunLifecycleJournal
} from "@dalph/orchestrator"
import {
  Effect,
  Layer,
  Schema,
  SubscriptionRef
} from "effect"
import { ClusterWorkflowEngine, SingleRunner } from "effect/unstable/cluster"
import { Activity, Workflow, WorkflowEngine } from "effect/unstable/workflow"
import { runDeliveryRuntime } from "@dalph/orchestrator"
import {
  deterministicDeliveryRuntimeSupport,
  makeDeliveryRelationsLayer
} from "../../../packages/orchestrator/dist/src/coordination/delivery/in-memory-relations.js"
import type {
  DeliveryRelationInputBundle,
} from "@dalph/orchestrator"
import type { TrackerGraphState } from "../../../packages/orchestrator/dist/src/coordination/delivery/relations.js"
import type {
  DeliveryActionExecutionError,
  DeliveryActionResult
} from "../../../packages/orchestrator/dist/src/coordination/delivery/delivery-action-executor.js"
import { deliveryProposalsOf } from "../../../packages/orchestrator/dist/src/coordination/delivery/delivery-proposal-derivation.js"
import { makeApplicationExitLifecycle } from "../../../packages/orchestrator/dist/src/coordination/application-exit/lifecycle.js"
import { deliveryRuntimeResourcesLayer } from "../../../packages/orchestrator/dist/src/coordination/delivery/delivery-runtime-resources.js"
import { reduceWorkflowJournalHistory } from "../../../packages/orchestrator/dist/src/coordination/reconstruction/history.js"
import { intentRecordKey, outcomeRecordKey } from "../../../packages/orchestrator/dist/src/workflow-journal/record-key.js"
import { makeJournal } from "../../../packages/orchestrator/dist/src/coordination/delivery/journal.js"
import {
  appendReady
} from "./journal.ts"
import {
  changeFactsDuringDowntime,
  createPlannedWorktree,
  readPlannedWorktree,
  readControlledWorld,
  recordActivityResultAvailable,
  recordDecisionEvidence,
  recordProposalObservation
} from "./controlled-world.ts"
import {
  FaultName,
  fixture,
  type WorktreeDecision,
  type WorktreeProcessInstance,
  type WorktreeScenario
} from "./contracts.ts"
import type { ControlledWorktreeObservation } from "./contracts.ts"

interface WorkflowReconciliationInput {
  readonly onReady: (executionId: string) => Promise<void>
  readonly onFault: (fault: FaultName) => Promise<never>
  readonly onPublicationSuppressed: () => Promise<never>
  readonly processInstance: WorktreeProcessInstance
  readonly publicationMode: "Publish" | "Suppress"
  readonly scenario: WorktreeScenario
  readonly workspace: string
}

const policy = RunControlPolicy.make({
  revision: initialRunPolicyRevision,
  taskExecutionCapacity: TaskWorkCapacity.make(1)
})
const graphTarget = FixtureTarget.make("issue-234-controlled-graph")

const graphStateFor = Effect.gen(function* () {
  const snapshotResult = TaskDagSnapshot.project(
    TrackerSnapshot.make({
      revision: TrackerRevision.make("controlled-graph-revision-234"),
      tasks: [
        {
          id: TaskId.make(fixture.taskId),
          lifecycle: TaskLifecycle.cases.Open.make({}),
          parentTaskId: null,
          prerequisiteIds: []
        }
      ]
    })
  )
  if (snapshotResult._tag === "Invalid") return yield* Effect.die("controlled graph fixture must project")
  const store = yield* JournalStore
  const graphRunId = RunId.make("run-234-controlled-graph")
  const graphOperation = makeTrackerGraphObservationOperation(
    OperationId.make("operation-234-graph-0001"),
    graphTarget,
    [],
    [fixture.taskId]
  )
  const initial = yield* store.read(graphRunId)
  if (initial.length === 0) {
    yield* store.beginRun(graphRunId, graphTarget, {
      taskExecutionCapacity: TaskWorkCapacity.make(1)
    })
  }
  const records = yield* store.read(graphRunId)
  const reduced = reduceWorkflowJournalHistory(graphRunId, records)
  if (reduced._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die(reduced)
  const journal = yield* makeJournal(graphRunId, graphTarget, reduced, store).pipe(Effect.orDie)
  if ((yield* journal.state.get).graph._tag === "GraphNotEstablished") {
    yield* journal.append(graphRunId, intentRecordKey(graphOperation.operationId), taskTrackerReadIntent(graphOperation))
    yield* journal.append(
      graphRunId,
      outcomeRecordKey(graphOperation.operationId),
      taskTrackerFactsObservedEvent(
        graphOperation.operationId,
        makeCompleteTaskTrackerFactsObserved(graphOperation, snapshotResult.snapshot)
      )
    )
  }
  const state = yield* journal.state.get
  return state.graph
}).pipe(Effect.provide(memoryJournalStoreLayer))

const workflowRuntimeLayer = (
  databasePath: string,
  handler: Layer.Layer<never, never, WorkflowEngine.WorkflowEngine | JournalStore>,
  journalLayer: Layer.Layer<JournalStore | RunLifecycleJournal, never, never>
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
  return handler.pipe(
    Layer.provide(journalLayer),
    Layer.provideMerge(ClusterWorkflowEngine.layer.pipe(Layer.provideMerge(cluster)))
  )
}

const WorktreeWorkflow = Workflow.make("DalphWorktreeReconciliation234", {
  error: Schema.Never,
  idempotencyKey: ({ runId }) => runId,
  payload: {
    attemptId: AttemptId,
    baseSha: GitCommitSha,
    branch: TaskBranchRef,
    operationId: OperationId,
    runId: RunId,
    scenario: Schema.Literals([
      "UnstoredActivityResult",
      "StoredResultBeforeJournal",
      "FactsChangedDuringDowntime",
      "BlindRetry",
      "ReplayHistoricalRead"
    ]),
    worktree: WorktreeLocator
  },
  success: Schema.Literals(["ContinueWorktreeReady", "WaitWorktreeNotReady"])
})

const operationAllocation = OperationIdAllocator.of({
  allocate: () => Effect.die("the accepted worktree proposal must not allocate a new OperationId")
})

const currentDecision = async (
  workspace: string,
  processInstance: WorktreeProcessInstance
): Promise<WorktreeDecision> => {
  const observation = await readPlannedWorktree({
    operationId: fixture.operationId,
    processInstance,
    workspace
  })
  const decision =
    observation._tag === "PlannedWorktreeReady" &&
    observation.baseSha === fixture.baseSha &&
    observation.branch === fixture.branch &&
    observation.worktree === fixture.worktree
      ? "ContinueWorktreeReady"
      : "WaitWorktreeNotReady"
  await recordDecisionEvidence(workspace, processInstance, decision)
  return decision
}

const asReadyProof = (observation: ControlledWorktreeObservation) => {
  if (observation._tag !== "PlannedWorktreeReady") throw new Error(`controlled Git did not prove readiness: ${observation._tag}`)
  if (
    observation.baseSha !== fixture.baseSha ||
    observation.branch !== fixture.branch ||
    observation.worktree !== fixture.worktree
  ) {
    throw new Error("controlled Git returned a proof for a different planned resource")
  }
  return observation
}

const bundleFor = (
  graph: TrackerGraphState,
  contributions: ReturnType<typeof deliveryProposalsOf>,
  acceptedAt: JournalPosition
): DeliveryRelationInputBundle => ({
  actionInputs: {
    proposalContributions: contributions,
    reflectionProposals: [],
    runtimeFacts: {
      acceptedAt,
      pauseCoverage: {
        _tag: "PauseCoverageGraphNotEstablished",
        applied: { run: { _tag: "RunUnpaused" }, tasks: { _tag: "NoTaskPauses" } }
      },
      quiescence: { _tag: "TrackerReconfirmationAllowed" },
      taskWork: { capacity: policy.taskExecutionCapacity, held: [] }
    },
    trackerGraphProposals: []
  },
  publication: { exactEvidence: [], graph, policy }
})

const emptyContributions = (): ReturnType<typeof deliveryProposalsOf> => ({
  deliverySettlement: [],
  issues: [],
  ticketDelivery: []
})

export const runWorkflowReconciliation = async (
  input: WorkflowReconciliationInput
): Promise<WorktreeDecision> => {
  // Application Exit is process-wide and is constructed by the child shell,
  // outside the Run Workflow handler. The handler receives only its admission
  // capability through the local runtime resource layer.
  const applicationExitAdmission = await Effect.runPromise(
    makeApplicationExitLifecycle().pipe(Effect.map(({ admission }) => admission))
  )
  const journalLayer = Layer.orDie(
    sqliteJournalStoreLayer({
      filename: JournalDatabaseLocator.make(join(input.workspace, "journal.sqlite"))
    })
  )
  const handler = WorktreeWorkflow.toLayer((payload, executionId) =>
    Effect.gen(function* () {
      const journal = yield* JournalStore
      const graph = yield* graphStateFor.pipe(Effect.orDie)
      const transition = RunnableFrontierTransition.ReconcileTaskWorktree({
        operationId: fixture.operationId,
        taskId: fixture.taskId
      })
      const contributions = deliveryProposalsOf({
        acceptedAt: JournalPosition.make(3),
        acceptedOperationIds: new Set([fixture.operationId]),
        fresh: [],
        runId: fixture.runId,
        transitions: [transition]
      })
      const current = yield* SubscriptionRef.make(bundleFor(graph, contributions, JournalPosition.make(3)))
      yield* Effect.promise(() => input.onReady(executionId))
      yield* Effect.promise(() =>
        recordProposalObservation(
          input.workspace,
          input.processInstance === "process-1"
            ? { _tag: "PresentBeforeActivity", processInstance: input.processInstance }
            : { _tag: "PresentAfterRestartBeforeJournal", processInstance: input.processInstance }
        )
      )
      const coherent = currentSignalFromCurrentFirstStream(SubscriptionRef.changes(current))
      const relations = makeDeliveryRelationsLayer({
        ...deterministicDeliveryRuntimeSupport(policy),
        coherent
      })
      const workflowContext = yield* Effect.context<WorkflowEngine.WorkflowEngine | WorkflowEngine.WorkflowInstance>()
      const executor: DeliveryActionExecutorService = {
        execute: (action, lease): Effect.Effect<DeliveryActionResult, DeliveryActionExecutionError> =>
          Effect.gen(function* () {
            if (
              action._tag !== "AcceptedOperationAction" ||
              action.proposal.route._tag !== "AcceptedWorkflowRoute" ||
              action.proposal.route.transition._tag !== "ReconcileTaskWorktree"
            ) {
              return yield* Effect.die("delivery proposed a non-worktree action")
            }
            yield* lease.recordIntent(fixture.operationId)
            const activity = Activity.make({
              error: Schema.Never,
              execute: Effect.promise(async () => {
                const context = {
                  operationId: fixture.operationId,
                  processInstance: input.processInstance,
                  workspace: input.workspace
                }
                if (payload.scenario === "BlindRetry") {
                  await createPlannedWorktree(
                    context,
                    payload.scenario === "BlindRetry" && input.processInstance === "process-1"
                      ? () => input.onFault("AfterCreateBeforeActivityStorage")
                      : undefined
                  )
                  const ready = asReadyProof(await readPlannedWorktree(context))
                  return {
                    attemptId: payload.attemptId,
                    baseSha: ready.baseSha,
                    branch: ready.branch,
                    headSha: ready.headSha,
                    operationId: payload.operationId,
                    runId: payload.runId,
                    worktree: ready.worktree
                  }
                }
                const observed = await readPlannedWorktree(context)
                if (observed._tag === "PlannedWorktreeReady") {
                  const ready = asReadyProof(observed)
                  return {
                    attemptId: payload.attemptId,
                    baseSha: ready.baseSha,
                    branch: ready.branch,
                    headSha: ready.headSha,
                    operationId: payload.operationId,
                    runId: payload.runId,
                    worktree: ready.worktree
                  }
                }
                if (observed._tag !== "PlannedWorktreeAbsent") {
                  throw new Error(`controlled Git refused reconciliation: ${observed.detail}`)
                }
                await createPlannedWorktree(
                  context,
                  input.processInstance === "process-1" && payload.scenario === "UnstoredActivityResult"
                    ? () => input.onFault("AfterCreateBeforeActivityStorage")
                    : undefined
                )
                const ready = asReadyProof(await readPlannedWorktree(context))
                return {
                  attemptId: payload.attemptId,
                  baseSha: ready.baseSha,
                  branch: ready.branch,
                  headSha: ready.headSha,
                  operationId: payload.operationId,
                  runId: payload.runId,
                  worktree: ready.worktree
                }
              }),
              name: fixture.activityName,
              success: Schema.Struct({
                attemptId: AttemptId,
                baseSha: GitCommitSha,
                branch: TaskBranchRef,
                headSha: GitCommitSha,
                operationId: OperationId,
                runId: RunId,
                worktree: WorktreeLocator
              })
            })
            const activityResult = yield* activity.pipe(Effect.provide(workflowContext))
            const proof = {
              baseSha: activityResult.baseSha,
              branch: activityResult.branch,
              headSha: activityResult.headSha,
              worktree: activityResult.worktree
            }
            yield* Effect.promise(() => recordActivityResultAvailable(input.workspace, input.processInstance))
            if (
              input.processInstance === "process-1" &&
              (payload.scenario === "StoredResultBeforeJournal" ||
                payload.scenario === "FactsChangedDuringDowntime" ||
                payload.scenario === "ReplayHistoricalRead")
            ) {
              return yield* Effect.promise(() => input.onFault("AfterActivityStorageBeforeJournal"))
            }
            if (input.publicationMode === "Suppress") {
              return yield* Effect.promise(input.onPublicationSuppressed)
            }
            const outcome = yield* appendReady(journal, {
              operationId: fixture.operationId,
              proof,
              version: workflowJournalEventVersion
            }).pipe(Effect.orDie)
            yield* SubscriptionRef.set(current, bundleFor(graph, emptyContributions(), outcome.position))
            if (payload.scenario === "ReplayHistoricalRead") {
              yield* Effect.promise(() =>
                recordDecisionEvidence(
                  input.workspace,
                  input.processInstance,
                  "ContinueWorktreeReady",
                  "ReplayedWorkflowResult"
                )
              )
            } else {
              yield* Effect.promise(() =>
                recordProposalObservation(input.workspace, {
                  _tag: "AbsentAfterJournalPublication",
                  processInstance: input.processInstance
                })
              )
            }
            return { _tag: "ActionCompleted", proposalId: action.proposal.id } satisfies DeliveryActionResult
          }).pipe(Effect.orDie)
      }
      const runtimeDependencies = Layer.mergeAll(
        deliveryRuntimeResourcesLayer(applicationExitAdmission),
        plannedAttemptProtocolControllerLayer,
        deterministicPlannedTaskAttemptLayer({
          baseSha: fixture.baseSha,
          executor: fixture.executor,
          runId: fixture.runId,
          worktreeRoot: fixture.worktree
        }),
        Layer.succeed(OperationIdAllocator, operationAllocation),
        Layer.succeed(DeliveryActionExecutor, DeliveryActionExecutor.of(executor))
      )
      yield* runDeliveryRuntime(yield* deliveryRuntime.pipe(Effect.provide(relations))).pipe(
        Effect.provide(runtimeDependencies),
        Effect.orDie
      )
      if (payload.scenario === "ReplayHistoricalRead" || payload.scenario === "StoredResultBeforeJournal") {
        return "ContinueWorktreeReady"
      }
      return yield* Effect.promise(() => currentDecision(input.workspace, input.processInstance))
    })
  )
  const runtime = workflowRuntimeLayer(join(input.workspace, "workflow.sqlite"), handler, journalLayer)
  return Effect.runPromise(
    WorktreeWorkflow.execute({
      attemptId: fixture.attemptId,
      baseSha: fixture.baseSha,
      branch: fixture.branch,
      operationId: fixture.operationId,
      runId: fixture.runId,
      scenario: input.scenario,
      worktree: fixture.worktree
    }).pipe(Effect.provide(runtime), Effect.scoped)
  )
}

export const mutateDowntimeFacts = changeFactsDuringDowntime

export const controlledWorldAtEnd = (workspace: string) => readControlledWorld(workspace)
