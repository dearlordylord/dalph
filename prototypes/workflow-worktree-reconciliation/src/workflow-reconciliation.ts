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
  GitWorktree,
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
  FixtureTarget
} from "@dalph/orchestrator"
import type { CoordinatorOwnershipError } from "../../../packages/orchestrator/dist/src/authorities/coordinator-ownership/ownership.js"
import type {
  GitWorktreeCreateFailure,
  GitWorktreeObservationError,
  GitWorktreeService
} from "../../../packages/orchestrator/dist/src/authorities/git/worktree.js"
import type { ResponsibilityFreshFacts } from "../../../packages/orchestrator/dist/src/coordination/frontier/fresh-facts.js"
import type { ReconstructedRunState } from "../../../packages/orchestrator/dist/src/coordination/reconstruction/state.js"
import { Effect, Layer, Schema, SubscriptionRef } from "effect"
import { ClusterWorkflowEngine, SingleRunner } from "effect/unstable/cluster"
import { Activity, Workflow, WorkflowEngine } from "effect/unstable/workflow"
import { runDeliveryRuntime } from "@dalph/orchestrator"
import {
  deterministicDeliveryRuntimeSupport,
  makeDeliveryRelationsLayer
} from "../../../packages/orchestrator/dist/src/coordination/delivery/in-memory-relations.js"
import type { DeliveryRelationInputBundle } from "@dalph/orchestrator"
import type { TrackerGraphState } from "../../../packages/orchestrator/dist/src/coordination/delivery/relations.js"
import type {
  DeliveryActionExecutionError,
  DeliveryActionResult
} from "../../../packages/orchestrator/dist/src/coordination/delivery/delivery-action-executor.js"
import { deliveryProposalsOf } from "../../../packages/orchestrator/dist/src/coordination/delivery/delivery-proposal-derivation.js"
import { makeApplicationExitLifecycle } from "../../../packages/orchestrator/dist/src/coordination/application-exit/lifecycle.js"
import { deliveryRuntimeResourcesLayer } from "../../../packages/orchestrator/dist/src/coordination/delivery/delivery-runtime-resources.js"
import { reduceWorkflowJournalHistory } from "../../../packages/orchestrator/dist/src/coordination/reconstruction/history.js"
import { deriveJournalResponsibilityFacts } from "@dalph/orchestrator"
import { intentRecordKey, outcomeRecordKey } from "../../../packages/orchestrator/dist/src/workflow-journal/record-key.js"
import { makeJournal } from "../../../packages/orchestrator/dist/src/coordination/delivery/journal.js"
import { appendReady, loadJournalRecords } from "./journal.ts"
import { executorBoundaryTrapLayer } from "./executor-trap.ts"
import {
  controlledGitWorktreeLayer,
  runBlindControlledGitRetry,
  runControlledGitWorktreeReconciliation
} from "./controlled-git-worktree.ts"
import {
  loadActivityEvidence,
  loadExecutorBoundaryContacts,
  recordActivityResultAvailable,
  recordDecisionEvidence,
  recordProposalObservation,
  recordResponsibilityProjection
} from "./controlled-world.ts"
import {
  activityResultFor,
  FaultName,
  fixture,
  plannedAttempt,
  WorktreeActivityError,
  WorktreeActivityResult,
  type WorktreeActivityFailureReason,
  type WorktreeDecision as WorktreeDecisionType,
  WorktreeScenario,
  type WorktreeProcessInstance,
  type WorktreeScenario as WorktreeScenarioType
} from "./contracts.ts"

interface WorkflowReconciliationInput {
  readonly onReady: (executionId: string) => Promise<void>
  readonly onFault: (fault: FaultName) => Promise<never>
  readonly onPublicationSuppressed: () => Promise<never>
  readonly processInstance: WorktreeProcessInstance
  readonly publicationMode: "Publish" | "Suppress"
  readonly scenario: WorktreeScenarioType
  readonly workspace: string
}

const policy = RunControlPolicy.make({
  revision: initialRunPolicyRevision,
  taskExecutionCapacity: TaskWorkCapacity.make(1)
})
const graphTarget = FixtureTarget.make("issue-234-controlled-graph")

/** The ordinary planning graph is rebuilt in every process from controlled Journal facts. */
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
  handler: Layer.Layer<never, never, WorkflowEngine.WorkflowEngine | GitWorktree>,
  gitLayer: Layer.Layer<GitWorktree, never, never>
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
  const engine = ClusterWorkflowEngine.layer.pipe(Layer.provideMerge(cluster))
  return handler.pipe(Layer.provide(gitLayer), Layer.provideMerge(engine))
}

/** Workflow serializes only the exact Activity result; planning and Journal publication stay outside it. */
const WorktreeWorkflowPayload = Schema.Struct({
  attemptId: AttemptId,
  baseSha: GitCommitSha,
  branch: TaskBranchRef,
  operationId: OperationId,
  runId: RunId,
  scenario: WorktreeScenario,
  worktree: WorktreeLocator
})

const WorktreeWorkflow = Workflow.make("DalphWorktreeReconciliation234", {
  error: WorktreeActivityError,
  idempotencyKey: ({ runId }) => runId,
  payload: WorktreeWorkflowPayload.fields,
  success: WorktreeActivityResult
})

const operationAllocation = OperationIdAllocator.of({
  allocate: () => Effect.die("the accepted worktree proposal must not allocate a new OperationId")
})

type WorktreeActivityCause = CoordinatorOwnershipError | GitWorktreeCreateFailure | GitWorktreeObservationError

const unreachableActivityCause = (cause: never): never => {
  throw new Error(`unreachable controlled Git Activity failure: ${String(cause)}`)
}

export const mapWorktreeActivityFailure = (
  cause: WorktreeActivityCause,
  worktree: WorktreeLocator
): WorktreeActivityError => {
  const reason: WorktreeActivityFailureReason = (() => {
    switch (cause._tag) {
      case "CompetingWorktreeRegistrations":
      case "ConflictingWorktreeRegistration":
      case "ContradictoryWorktreeState":
      case "ForeignWorktreeRegistration":
      case "UntrackedWorktreePath":
      case "WorktreeBaseMismatch":
      case "GitWorktreeReadFailure":
      case "CoordinatorLockObservationContradiction":
      case "CoordinatorOwnershipLost":
      case "GitWorktreeCreateFailure":
        return cause._tag
      default:
        return unreachableActivityCause(cause)
    }
  })()
  return WorktreeActivityError.make({
    detail: cause.message,
    reason,
    worktree
  })
}

type WorktreeWorkflowPayloadType = typeof WorktreeWorkflowPayload.Type

const activityFor = (payload: WorktreeWorkflowPayloadType, git: GitWorktreeService) => {
  const proof =
    payload.scenario === "BlindRetry"
      ? runBlindControlledGitRetry(git, plannedAttempt)
      : runControlledGitWorktreeReconciliation(git, plannedAttempt)
  return proof.pipe(
    Effect.map((ready) => activityResultFor(payload, ready)),
    Effect.mapError((cause) => mapWorktreeActivityFailure(cause, payload.worktree))
  )
}

type WorktreeResponsibilityFreshFacts = Extract<
  ResponsibilityFreshFacts,
  { readonly _tag: "WorkflowOperationFreshFacts" }
> & {
  readonly responsibility: Extract<
    Extract<ResponsibilityFreshFacts, { readonly _tag: "WorkflowOperationFreshFacts" }>["responsibility"],
    { readonly _tag: "TaskWorktreeResponsibility" }
  >
}

interface FoldedJournal {
  readonly accepted: boolean
  readonly position: JournalPosition
  readonly responsibility: WorktreeResponsibilityFreshFacts
  readonly runState: ReconstructedRunState
}

/** Folds the production Journal; only the exact TaskWorktreeReady outcome settles this responsibility. */
const foldedJournalOf = (records: Awaited<ReturnType<typeof loadJournalRecords>>): FoldedJournal => {
  const reduced = reduceWorkflowJournalHistory(fixture.runId, records)
  if (reduced._tag === "InvalidWorkflowJournalHistory") {
    throw new Error(`controlled Journal history is invalid: ${String(reduced)}`)
  }
  const responsibility = deriveJournalResponsibilityFacts(reduced.runState).find(
    (facts): facts is WorktreeResponsibilityFreshFacts =>
      facts._tag === "WorkflowOperationFreshFacts" &&
      facts.responsibility._tag === "TaskWorktreeResponsibility" &&
      facts.responsibility.operation.operationId === fixture.operationId &&
      facts.responsibility.operation.plannedAttempt.attemptId === fixture.attemptId &&
      facts.responsibility.operation.plannedAttempt.runId === fixture.runId &&
      facts.responsibility.operation.plannedAttempt.taskId === fixture.taskId &&
      facts.responsibility.operation.plannedAttempt.baseSha === fixture.baseSha &&
      facts.responsibility.operation.plannedAttempt.branch === fixture.branch &&
      facts.responsibility.operation.plannedAttempt.worktree === fixture.worktree
  )
  if (responsibility === undefined) {
    throw new Error("controlled Journal has no exact reconstructed worktree responsibility")
  }
  const position = reduced.runState.appliedThrough ?? responsibility.responsibility.beganAt
  return {
    accepted: responsibility.disposition._tag === "Settled",
    position,
    responsibility,
    runState: reduced.runState
  }
}

/** Ordinary planning already acknowledged this proposal; Journal folding only removes it after settlement. */
const acknowledgedProposal = RunnableFrontierTransition.ReconcileTaskWorktree({
  operationId: fixture.operationId,
  taskId: fixture.taskId
})

const proposalContributionsFor = (history: FoldedJournal): ReturnType<typeof deliveryProposalsOf> =>
  deliveryProposalsOf({
    acceptedAt: history.position,
    acceptedOperationIds: new Set([fixture.operationId]),
    fresh: [],
    runId: fixture.runId,
    transitions: history.accepted ? [] : [acknowledgedProposal]
  })

const bundleFor = (graph: TrackerGraphState, history: FoldedJournal): DeliveryRelationInputBundle => ({
  actionInputs: {
    proposalContributions: proposalContributionsFor(history),
    reflectionProposals: [],
    runtimeFacts: {
      acceptedAt: history.position,
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

const currentDecision = (
  git: GitWorktreeService,
  input: WorkflowReconciliationInput
): Effect.Effect<WorktreeDecisionType> =>
  git.readPlannedWorktree(plannedAttempt).pipe(
    Effect.map((observation): WorktreeDecisionType =>
      observation._tag === "PlannedWorktreeReady" &&
          observation.baseSha === fixture.baseSha &&
          observation.branch === fixture.branch &&
          observation.worktree === fixture.worktree
        ? "ContinueWorktreeReady"
        : "WaitWorktreeNotReady"
    ),
    Effect.orElseSucceed(() => "WaitWorktreeNotReady" as const),
    Effect.tap((decision) =>
      Effect.promise(async () => {
        const contacts = await loadExecutorBoundaryContacts(input.workspace)
        await recordDecisionEvidence(
          input.workspace,
          input.processInstance,
          decision,
          "ControlledGitFreshRead",
          contacts.length
        )
      })
    )
  )

export const runWorkflowReconciliation = async (
  input: WorkflowReconciliationInput
): Promise<WorktreeDecisionType> => {
  // Application Exit is process-wide and is constructed by the ordinary child
  // program, outside both Run Workflow and the Workflow handler.
  const applicationExitAdmission = await Effect.runPromise(
    makeApplicationExitLifecycle().pipe(Effect.map(({ admission }) => admission))
  )
  const priorActivityEvidence = await loadActivityEvidence(input.workspace)
  const priorExecutionId = priorActivityEvidence.at(-1)?.executionId
  let executionIdSeen: string | undefined
  const journalLayer = Layer.orDie(
    sqliteJournalStoreLayer({
      filename: JournalDatabaseLocator.make(join(input.workspace, "journal.sqlite"))
    })
  )
  const afterCreate =
    input.processInstance === "process-1" &&
    (input.scenario === "UnstoredActivityResult" || input.scenario === "BlindRetry")
      ? () => input.onFault("AfterCreateBeforeActivityStorage")
      : undefined
  const gitLayer = controlledGitWorktreeLayer({
    ...(afterCreate === undefined ? {} : { afterCreate }),
    processInstance: input.processInstance,
    workspace: input.workspace
  })
  const handler = WorktreeWorkflow.toLayer((payload, executionId) =>
    Effect.gen(function* () {
      const git = yield* GitWorktree
      const workflowContext = yield* Effect.context<WorkflowEngine.WorkflowEngine | WorkflowEngine.WorkflowInstance>()
      // This callback reports execution identity only; ordinary proposal planning remains below the handler.
      executionIdSeen = executionId
      yield* Effect.promise(() => input.onReady(executionId))
      const activity = Activity.make({
        error: WorktreeActivityError,
        execute: activityFor(payload, git),
        name: fixture.activityName,
        success: WorktreeActivityResult
      })
      const activityResult = yield* activity.pipe(Effect.provide(workflowContext))
      return activityResult
    })
  )
  const runtime = workflowRuntimeLayer(join(input.workspace, "workflow.sqlite"), handler, gitLayer)
  const fullRuntime = Layer.mergeAll(runtime, journalLayer, gitLayer)
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const journal = yield* JournalStore
        const initialRecords = yield* journal.read(fixture.runId)
        const initialHistory = foldedJournalOf(initialRecords)
        const graph = yield* graphStateFor.pipe(Effect.orDie)
        const current = yield* SubscriptionRef.make(bundleFor(graph, initialHistory))
        const initialDisposition = initialHistory.responsibility.disposition._tag
        if (initialDisposition !== "WorkflowOperationTaskClaimConstraint" && initialDisposition !== "Settled") {
          return yield* Effect.die(
            `unexpected initial responsibility disposition: ${initialDisposition}`
          )
        }
        yield* Effect.promise(() =>
          recordResponsibilityProjection(input.workspace, {
            disposition: initialDisposition,
            operationId: fixture.operationId,
            position: initialHistory.position,
            processInstance: input.processInstance,
            runId: fixture.runId
          })
        )
        if (!initialHistory.accepted) {
          yield* Effect.promise(() =>
            recordProposalObservation(input.workspace, {
              _tag:
                input.processInstance === "process-1"
                  ? "PresentBeforeActivity"
                  : "PresentAfterRestartBeforeJournal",
              processInstance: input.processInstance
            })
          )
        }
        const coherent = currentSignalFromCurrentFirstStream(SubscriptionRef.changes(current))
        const relations = makeDeliveryRelationsLayer({
          ...deterministicDeliveryRuntimeSupport(policy),
          coherent
        })
        const workflowContext = yield* Effect.context<WorkflowEngine.WorkflowEngine>()
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
              const workflowResult = yield* WorktreeWorkflow.execute({
                attemptId: fixture.attemptId,
                baseSha: fixture.baseSha,
                branch: fixture.branch,
                operationId: fixture.operationId,
                runId: fixture.runId,
                scenario: input.scenario,
                worktree: fixture.worktree
              }).pipe(Effect.provide(workflowContext))
              const executionId = executionIdSeen ?? priorExecutionId
              if (executionId === undefined) return yield* Effect.die("Workflow completed without an execution identity")
              if (executionIdSeen === undefined) yield* Effect.promise(() => input.onReady(executionId))
              yield* Effect.promise(() =>
                recordActivityResultAvailable(input.workspace, input.processInstance, executionId)
              )
              if (
                input.processInstance === "process-1" &&
                (input.scenario === "StoredResultBeforeJournal" ||
                  input.scenario === "FactsChangedDuringDowntime" ||
                  input.scenario === "ReplayHistoricalRead")
              ) {
                return yield* Effect.promise(() => input.onFault("AfterActivityStorageBeforeJournal"))
              }
              if (input.publicationMode === "Suppress") {
                return yield* Effect.promise(input.onPublicationSuppressed)
              }

              // Ordinary executor code appends through the persistent Journal and
              // then folds that Journal again before changing its process-local signal.
              const beforeAppend = yield* journal.read(fixture.runId)
              const beforeHistory = foldedJournalOf(beforeAppend)
              if (!beforeHistory.accepted) {
                yield* appendReady(journal, {
                  operationId: fixture.operationId,
                  proof: workflowResult.proof,
                  version: workflowJournalEventVersion
                }).pipe(Effect.orDie)
              }
              const publishedRecords = yield* journal.read(fixture.runId)
              const publishedHistory = foldedJournalOf(publishedRecords)
              if (!publishedHistory.accepted) return yield* Effect.die("Journal publication did not fold as accepted")
              yield* SubscriptionRef.set(current, bundleFor(graph, publishedHistory))
              yield* Effect.promise(() =>
                recordResponsibilityProjection(input.workspace, {
                  disposition: "Settled",
                  operationId: fixture.operationId,
                  position: publishedHistory.position,
                  processInstance: input.processInstance,
                  runId: fixture.runId
                })
              )
              yield* Effect.promise(() =>
                recordProposalObservation(input.workspace, {
                  _tag: "AbsentAfterJournalPublication",
                  processInstance: input.processInstance
                })
              )
              if (input.scenario === "ReplayHistoricalRead") {
                const contacts = yield* Effect.promise(() => loadExecutorBoundaryContacts(input.workspace))
                const replayedProofDecision: WorktreeDecisionType =
                  workflowResult.proof.baseSha === fixture.baseSha &&
                  workflowResult.proof.branch === fixture.branch &&
                  workflowResult.proof.worktree === fixture.worktree
                    ? "ContinueWorktreeReady"
                    : "WaitWorktreeNotReady"
                yield* Effect.promise(() =>
                  recordDecisionEvidence(
                    input.workspace,
                    input.processInstance,
                    replayedProofDecision,
                    "ReplayedWorkflowResult",
                    contacts.length
                  )
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
          executorBoundaryTrapLayer(input.workspace, input.processInstance),
          Layer.succeed(OperationIdAllocator, operationAllocation),
          Layer.succeed(DeliveryActionExecutor, DeliveryActionExecutor.of(executor))
        )
        yield* runDeliveryRuntime(yield* deliveryRuntime.pipe(Effect.provide(relations))).pipe(
          Effect.provide(runtimeDependencies),
          Effect.orDie
        )
        if (
          input.scenario === "ReplayHistoricalRead" ||
          input.scenario === "StoredResultBeforeJournal" ||
          input.scenario === "BlindRetry"
        ) {
          return "ContinueWorktreeReady" as const
        }
        const git = yield* GitWorktree
        return yield* currentDecision(git, input)
      }).pipe(Effect.provide(fullRuntime))
    )
  )
}
