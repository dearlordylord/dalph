import { sha256 } from "@noble/hashes/sha2.js"
import { bytesToHex } from "@noble/hashes/utils.js"
import { Effect, Schema as S } from "effect"
import {
  Effect as ProductionEffect,
  Layer as ProductionLayer
} from "../../../node_modules/effect/dist/index.js"
import {
  AuthenticatedOperatorIdentity,
  ClaimOwner,
  ClaimToken,
  ControlCommandId,
  FailedProcessExitCode,
  FixtureTarget,
  JournalPosition,
  OperationId,
  ProviderObservationId,
  ProviderRequestId,
  ReviewFindingId,
  RunId,
  type Task,
  TaskId,
  TaskWorkSessionId,
  TaskWorkCapacity,
  TechnicalRetryNotBefore,
  TrackerRevision,
  WorkerProcessId
} from "../../../packages/orchestrator/src/domain.ts"
import { ControlService, controlServiceLayer } from "../../../packages/orchestrator/src/control-service.ts"
import {
  ExecutorOuterInvocationOutcome,
  ExecutorOuterInvocationWait
} from "../../../packages/orchestrator/src/executor-boundary.ts"
import { PlannedWorktreeReady } from "../../../packages/orchestrator/src/git-worktree.ts"
import {
  JournalStore,
  type JournalRecord
} from "../../../packages/orchestrator/src/journal-store.ts"
import { journaledWorkflowInterpreterLayer } from "../../../packages/orchestrator/src/journaled-workflow-interpreter.ts"
import {
  EvidenceDigest,
  EvidenceReference,
  EvidenceStore,
  EvidenceStoreFailure,
  ImplementationEvidenceSource
} from "../../../packages/orchestrator/src/implementation-evidence.ts"
import {
  ImplementationReviewDisposition,
  ImplementationReviewer,
  ImplementationReviewInvocationFailure,
  ReviewFindingsHandback,
  ReviewFindingsHandbackAcknowledged,
  ReviewFindingsHandbackFailure
} from "../../../packages/orchestrator/src/implementation-review.ts"
import { reduceManagedHistory } from "../../../packages/orchestrator/src/managed-history.ts"
import {
  activateRecoveredResponsibilities,
  makeManagedRecoveryActivation
} from "../../../packages/orchestrator/src/managed-activation.ts"
import {
  type WorkflowResponsibilityEntry,
  workflowResponsibilityOperationId
} from "../../../packages/orchestrator/src/reconstructed-managed-run-state.ts"
import {
  deriveRunFinalityDecision,
  deriveRunnableFrontier,
  ResponsibilityDisposition,
  runnableTransitionOperationId,
  runnableTransitionTaskId,
  type RunnableFrontier,
  type FrontierExplanation as ProductionFrontierExplanation,
  type RunnableFrontierTransition
} from "../../../packages/orchestrator/src/runnable-frontier.ts"
import { makeTaskAdmissionController } from "../../../packages/orchestrator/src/task-admission-controller.ts"
import {
  projectTrackerSnapshot,
  GraphProjectionError,
  taskRevisionFor,
  type ProjectionIssue,
  type TaskDagSnapshot
} from "../../../packages/orchestrator/src/task-dag.ts"
import {
  ActiveTaskClaim,
  isExactTaskClaim,
  TaskClaimAcquisition,
  TaskClaimConflict
} from "../../../packages/orchestrator/src/tracker-mutation.ts"
import {
  FailedTaskExecutionReported,
  InterruptedTaskExecutionReported,
  ResourceEmergencyTaskExecutionReported,
  SuccessfulTaskExecutionReported,
  TaskExecutionObservationFailure,
  TaskExecutionRequestAcknowledgement,
  TaskExecutionRequestFailure,
  TaskExecutor
} from "../../../packages/orchestrator/src/task-execution.ts"
import {
  MatchingTaskWorkSessionReported,
  NoMatchingTaskWorkSessionReported,
  TaskRunner,
  TaskWorkSessionLookupFailure,
  TaskWorkStartRequestAcknowledgement,
  TaskWorkStartRequestFailure
} from "../../../packages/orchestrator/src/task-work-start.ts"
import { TrackerGraphReader } from "../../../packages/orchestrator/src/tracker-graph-reader.ts"
import { AuthoritativeTaskWorktreeReady } from "../../../packages/orchestrator/src/task-worktree-reconciliation.ts"
import {
  AuthoritativeTaskClaimAcquired,
  WorkflowInterpreter,
  type WorkflowInterpreterService,
  WorkflowTrace
} from "../../../packages/orchestrator/src/workflow.ts"
import { makeDryRunWorkflowInterpreterLayer } from "../../../packages/orchestrator/src/workflow-interpreters.ts"
import {
  makeTaskClaimAcquisitionOperation,
  makeTrackerGraphObservationOperation
} from "../../../packages/orchestrator/src/workflow-operation.ts"
import {
  type ClaimedTaskEligibility,
  completedProductionWorkflowOperations,
  completedExecutorWorkflowStep,
  coordinatorExecutorWorkflowStepLimit,
  executorInvocationCount,
  firstExecutorWorkflowStep,
  type ProductionWorkflowProgress,
  replayProductionWorkflow
} from "./production-workflow-driver.ts"

export const LabTaskLifecycle = S.Literals([
  "Open",
  "CompletedSuccessfully",
  "TerminalWithoutSuccess"
])
export type LabTaskLifecycle = typeof LabTaskLifecycle.Type

/**
 * One raw task record in the controlled fake task tracker. The raw arrays are
 * intentionally not sets: duplicate and otherwise invalid edges are valid Lab input.
 */
export const ControlledTask = S.Struct({
  body: S.String,
  id: S.String,
  lifecycle: LabTaskLifecycle,
  parentTaskId: S.NullOr(S.String),
  prerequisiteIds: S.Array(S.String),
  title: S.String
})
export interface ControlledTask extends S.Schema.Type<typeof ControlledTask> {}

export const TrackerClaimState = S.Literals(["Unclaimed", "OwnedByLab", "Foreign"])
export type TrackerClaimState = typeof TrackerClaimState.Type

const TrackerClaim = S.Struct({ state: TrackerClaimState, taskId: S.String })
export type TrackerClaim = typeof TrackerClaim.Type

export const FreshFact = S.Literals([
  "Ready",
  "ForeignClaim",
  "MissingClaim",
  "Paused",
  "DependencyWait",
  "Completed",
  "Failed",
  "Blocked",
  "Cancelled",
  "Relinquished",
  "Settled",
  "Unreadable",
  "ExecutorWait",
  "ExecutorSettled"
])
export type FreshFact = typeof FreshFact.Type

export const BoundaryBehavior = S.Literals([
  "Successful",
  "SessionLookupFails",
  "SessionStartFails",
  "ExecutionRequestFails",
  "ExecutionObservationFails",
  "ExecutionFails",
  "ExecutionInterrupted",
  "ResourceEmergency",
  "ReviewFindingsThenAccepted",
  "ReviewRetriesThenAccepted",
  "HandbackRetriesThenAccepted"
])
export type BoundaryBehavior = typeof BoundaryBehavior.Type
export const ControlledTrackerTarget = S.Literals(["Primary", "Secondary"])
export type ControlledTrackerTarget = typeof ControlledTrackerTarget.Type

/** One explicit, replayable input accepted by the Reducer Lab driver. */
export const LabAction = S.Union([
  S.TaggedStruct("ReplacedTrackerTask", { task: ControlledTask }),
  S.TaggedStruct("DeletedTrackerTask", { taskId: S.String }),
  S.TaggedStruct("SetTrackerClaim", { state: TrackerClaimState, taskId: S.String }),
  S.TaggedStruct("ObservedTrackerGraph", {}),
  S.TaggedStruct("RecheckedTaskBeforeClaim", { taskId: S.String }),
  S.TaggedStruct("CommittedClaimIntent", { taskId: S.String }),
  S.TaggedStruct("AdvancedTaskWorkflow", { taskId: S.String }),
  S.TaggedStruct("AdvancedExecutorProtocol", { taskId: S.String }),
  S.TaggedStruct("ActivatedRecoveredResponsibilities", { taskId: S.String }),
  S.TaggedStruct("SuppliedFreshFact", {
    fact: FreshFact,
    operationId: S.String,
    taskId: S.String
  }),
  S.TaggedStruct("SuppliedFreshFactCardinality", {
    cardinality: S.Literals(["Missing", "Duplicate"]),
    operationId: S.String,
    taskId: S.String
  }),
  S.TaggedStruct("CrashedCoordinator", {}),
  S.TaggedStruct("RestartedCoordinator", {}),
  S.TaggedStruct("ChangedCapacity", { capacity: S.Number }),
  S.TaggedStruct("ChangedTargetSettlement", { settled: S.Boolean }),
  S.TaggedStruct("ChangedBoundaryBehavior", { behavior: BoundaryBehavior }),
  S.TaggedStruct("ChangedTrackerTarget", { target: ControlledTrackerTarget }),
  S.TaggedStruct("RequestedRunPause", {}),
  S.TaggedStruct("RequestedRunUnpause", {}),
  S.TaggedStruct("RequestedTaskPause", { taskId: S.String }),
  S.TaggedStruct("RequestedTaskUnpause", { taskId: S.String })
])
export type LabAction = typeof LabAction.Type

/** The complete semantic input history from which the Lab reconstructs state. */
export const LabInput = S.Struct({ actions: S.Array(LabAction) })
export interface LabInput extends S.Schema.Type<typeof LabInput> {}

/** Opaque process-local identity for the exact input prefix represented by a snapshot. */
export const LabSnapshotRevision = S.String.pipe(S.brand("LabSnapshotRevision"))
export type LabSnapshotRevision = typeof LabSnapshotRevision.Type

/** Stable semantic identity used to request one move without exposing its input to FoldKit. */
export const LabMoveId = S.String.pipe(S.brand("LabMoveId"))
export type LabMoveId = typeof LabMoveId.Type

/**
 * Transitional frozen inventory: do not add, rename, or reclassify entries to
 * accommodate another happening. If a new case needs classification, replace
 * this Lab-owned origin inventory with the production-typed action/occurrence
 * and provenance classification, then delete the matching presenter map.
 */
export const LabMoveOrigin = S.Literals([
  "ProductionFrontierSelection",
  "FakeTaskTracker",
  "LabProductionStageControl",
  "LabResponsibilitySelectorInput",
  "ProductionCoordinator",
  "LabFinalityInput",
  "LabCoordinatorSimulation",
  "FakeBoundarySetup",
  "OperatorControlRequest"
])
export type LabMoveOrigin = typeof LabMoveOrigin.Type

export const LabMoveSubject = S.Union([
  S.TaggedStruct("Task", { taskId: S.String }),
  S.TaggedStruct("TrackerTarget", {}),
  S.TaggedStruct("Coordinator", {}),
  S.TaggedStruct("Capacity", { capacity: S.Number }),
  S.TaggedStruct("Run", {})
])
export type LabMoveSubject = typeof LabMoveSubject.Type

export const LabMoveUnavailableReason = S.Literals([
  "WaitingForAdmissionCapacity",
  "CoordinatorStopped",
  "AlreadyCurrent",
  "ProductionTransitionNotDriven",
  "ProductionPauseStateAbsent"
])
export type LabMoveUnavailableReason = typeof LabMoveUnavailableReason.Type

/** Availability keeps executable input out of unavailable and capability-gap states. */
export const LabMoveAvailability = S.Union([
  S.TaggedStruct("Available", { input: LabAction }),
  S.TaggedStruct("Waiting", { reason: LabMoveUnavailableReason }),
  S.TaggedStruct("NotCurrent", { reason: LabMoveUnavailableReason }),
  S.TaggedStruct("DriverMissing", {
    owningIssue: S.String,
    reason: LabMoveUnavailableReason
  }),
  S.TaggedStruct("Planned", {
    owningIssue: S.String,
    reason: LabMoveUnavailableReason
  })
])
export type LabMoveAvailability = typeof LabMoveAvailability.Type

/** A label-free semantic move emitted by the driver for one exact snapshot. */
export const LabMove = S.Struct({
  availability: LabMoveAvailability,
  id: LabMoveId,
  origin: LabMoveOrigin,
  subject: LabMoveSubject,
  transition: S.String
})
export interface LabMove extends S.Schema.Type<typeof LabMove> {}

const Decision = S.Struct({
  operationId: S.NullOr(S.String),
  tag: S.String,
  taskId: S.String
})
const Responsibility = S.Struct({
  beganAt: S.Number,
  kind: S.String,
  operationId: S.String,
  taskId: S.String
})
const JournalRow = S.Struct({
  operationTag: S.NullOr(S.String),
  position: S.Number,
  tag: S.String
})
const FrontierExplanation = S.Struct({
  tag: S.String,
  taskId: S.NullOr(S.String)
})
const GraphKnowledge = S.Struct({
  details: S.Array(S.String),
  kind: S.String,
  observationCount: S.Number,
  taskIds: S.Array(S.String)
})
const ObservationAttempt = S.Union([
  S.TaggedStruct("NeverAttempted", {}),
  S.TaggedStruct("Succeeded", { revision: S.String }),
  S.TaggedStruct("Failed", { issues: S.Array(S.String) })
])
/** The selected target's process-local normalized graph, or why none exists. */
const LatestObservation = S.Union([
  S.TaggedStruct("NeverObserved", {}),
  S.TaggedStruct("Available", { tasks: S.Array(ControlledTask) }),
  S.TaggedStruct("DiscardedOnCoordinatorCrash", {})
])
const WorkflowProgress = S.Struct({
  completedOperations: S.Array(S.String),
  completedExecutorInvocations: S.Number,
  executorInvocationCount: S.Number,
  nextOperation: S.NullOr(S.String),
  nextTransition: S.NullOr(S.String),
  status: S.Literals([
    "InProgress",
    "ClaimedTaskNotEligible",
    "TrackerReadFailed",
    "ClaimAuthorityChanged",
    "BoundaryFailed",
    "ExecutorCompleted",
    "RecoveryIncomplete",
    "TaskSelectionUnavailable"
  ]),
  taskId: S.String,
  taskRevision: S.NullOr(S.String),
  trace: S.Array(S.String)
})

/** Semantic result reconstructed by real production reducers plus controlled Lab inputs. */
export const LabSnapshot = S.Struct({
  admitted: S.Array(Decision),
  appliedThrough: S.NullOr(S.Number),
  authorityIssues: S.Array(S.String),
  boundaryBehavior: BoundaryBehavior,
  controlledTrackerTarget: ControlledTrackerTarget,
  capacity: S.Number,
  coordinatorRunning: S.Boolean,
  errors: S.Array(S.String),
  explanations: S.Array(FrontierExplanation),
  finalityReason: S.NullOr(S.String),
  finalityTag: S.String,
  frontier: S.Array(Decision),
  graphKnowledge: S.Array(GraphKnowledge),
  input: LabInput,
  journal: S.Array(JournalRow),
  latestObservation: LatestObservation,
  moves: S.Array(LabMove),
  observationAttempt: ObservationAttempt,
  reservedTaskIds: S.Array(S.String),
  responsibilities: S.Array(Responsibility),
  revision: LabSnapshotRevision,
  runPause: S.String,
  status: S.String,
  targetSettled: S.Boolean,
  taskPause: S.String,
  trackerClaims: S.Array(TrackerClaim),
  trackerTasks: S.Array(ControlledTask),
  workflowProgress: S.Array(WorkflowProgress)
})
export interface LabSnapshot extends S.Schema.Type<typeof LabSnapshot> {}

export class StaleLabSnapshot extends S.TaggedErrorClass<StaleLabSnapshot>()(
  "StaleLabSnapshot",
  {
    actualRevision: LabSnapshotRevision,
    expectedRevision: LabSnapshotRevision,
    moveId: LabMoveId
  }
) {}

export class UnknownLabMove extends S.TaggedErrorClass<UnknownLabMove>()(
  "UnknownLabMove",
  { moveId: LabMoveId }
) {}

export class UnavailableLabMove extends S.TaggedErrorClass<UnavailableLabMove>()(
  "UnavailableLabMove",
  {
    availability: S.String,
    moveId: LabMoveId
  }
) {}

export class InvalidLabCommand extends S.TaggedErrorClass<InvalidLabCommand>()(
  "InvalidLabCommand",
  { reason: S.String }
) {}

export const LabMoveExecution = S.Struct({
  input: LabAction,
  snapshot: LabSnapshot
})
export interface LabMoveExecution extends S.Schema.Type<typeof LabMoveExecution> {}

const runId = RunId.make("reducer-lab-run")
const trackerTarget = (controlled: ControlledTrackerTarget) =>
  FixtureTarget.make(`reducer-lab-target:${controlled.toLowerCase()}`)
const owner = ClaimOwner.make("reducer-lab-owner")

export const initialTrackerTasks: ReadonlyArray<ControlledTask> = [
  {
    body: "Independent runnable work.",
    id: "A",
    lifecycle: "Open",
    parentTaskId: null,
    prerequisiteIds: [],
    title: "Prepare A"
  },
  {
    body: "Waits for A.",
    id: "B",
    lifecycle: "Open",
    parentTaskId: null,
    prerequisiteIds: ["A"],
    title: "Build B"
  },
  {
    body: "Independent runnable work.",
    id: "C",
    lifecycle: "Open",
    parentTaskId: null,
    prerequisiteIds: [],
    title: "Prepare C"
  },
  {
    body: "Already complete.",
    id: "D",
    lifecycle: "CompletedSuccessfully",
    parentTaskId: "B",
    prerequisiteIds: [],
    title: "Completed child D"
  }
]

const cloneTasks = (tasks: ReadonlyArray<ControlledTask>): Array<ControlledTask> =>
  tasks.map((task) => ({ ...task, prerequisiteIds: [...task.prerequisiteIds] }))

const taskId = (value: string): TaskId => TaskId.make(value)

const graphOperation = (
  ordinal: number,
  controlledTarget: ControlledTrackerTarget,
  explicitlyCoveredTaskIds: ReadonlyArray<string>,
  predecessorOperationIds: ReadonlyArray<OperationId> = []
) => {
  const operationId = OperationId.make(`graph-observation-${ordinal}`)
  const operation = makeTrackerGraphObservationOperation(
    operationId,
    trackerTarget(controlledTarget),
    predecessorOperationIds,
    explicitlyCoveredTaskIds.map(taskId)
  )
  return { operationId, operation }
}

const claimOperation = (
  ordinal: number,
  subjectTaskId: string,
  predecessorOperationId: OperationId
): ReturnType<typeof makeTaskClaimAcquisitionOperation> => {
  const operationId = OperationId.make(`claim-${subjectTaskId}-${ordinal}`)
  const acquisition = TaskClaimAcquisition.make({
    operationId,
    owner,
    taskId: taskId(subjectTaskId),
    token: ClaimToken.make(`claim-token-${subjectTaskId}-${ordinal}`)
  })
  return makeTaskClaimAcquisitionOperation({
    acquisition,
    predecessorOperationIds: [predecessorOperationId]
  })
}

const lifecycle = (tag: LabTaskLifecycle) => ({ _tag: tag } as const)

const projectionInput = (
  tasks: ReadonlyArray<ControlledTask>,
  revision: string
) => ({
  revision: TrackerRevision.make(revision),
  tasks: tasks.map((task) => ({
    id: taskId(task.id),
    lifecycle: lifecycle(task.lifecycle),
    parentTaskId: task.parentTaskId === null ? null : taskId(task.parentTaskId),
    prerequisiteIds: task.prerequisiteIds.map(taskId)
  }))
})

const issueText = (issue: ProjectionIssue): string => {
  switch (issue._tag) {
    case "BoundaryDecodeFailed": return `Boundary decode failed · ${issue.detail}`
    case "DuplicateTask": return `Duplicate task · ${issue.taskId}`
    case "DuplicatePrerequisite":
      return `Duplicate prerequisite · ${issue.dependant} → ${issue.prerequisite}`
    case "MissingPrerequisite":
      return `Missing prerequisite · ${issue.dependant} → ${issue.prerequisite}`
    case "SelfPrerequisite": return `Self prerequisite · ${issue.taskId}`
    case "MissingParent": return `Missing parent · ${issue.child} → ${issue.parent}`
    case "SelfParent": return `Self parent · ${issue.taskId}`
    case "Cycle": return `Dependency cycle · ${issue.taskIds.join(" → ")}`
    case "ContainmentCycle": return `Containment cycle · ${issue.taskIds.join(" → ")}`
  }
}

type VolatileObservation =
  | { readonly _tag: "NeverObserved" }
  | {
    readonly _tag: "Available"
    readonly projected: TaskDagSnapshot
    readonly tasks: ReadonlyArray<ControlledTask>
  }
  | { readonly _tag: "DiscardedOnCoordinatorCrash" }

const snapshotLatestObservation = (
  observation: VolatileObservation
): LabSnapshot["latestObservation"] =>
  observation._tag === "Available"
    ? { _tag: "Available", tasks: observation.tasks }
    : observation

const volatileObservationTasks = (
  observation: VolatileObservation
): ReadonlyArray<ControlledTask> =>
  observation._tag === "Available" ? observation.tasks : []

const discardVolatileObservation = (
  observation: VolatileObservation
): VolatileObservation =>
  observation._tag === "Available"
    ? { _tag: "DiscardedOnCoordinatorCrash" }
    : observation

interface ProductionInput {
  readonly activateRecovery: (capacity: number) => Promise<void>
  readonly authorityIssues: ReadonlyArray<string>
  readonly boundaryBehavior: BoundaryBehavior
  readonly controlledTrackerTarget: ControlledTrackerTarget
  readonly boundaryInterpreter: WorkflowInterpreterService
  readonly capacity: number
  readonly coordinatorRunning: boolean
  readonly freshFacts: ReadonlyMap<string, ReadonlyArray<FreshFact>>
  readonly hasRestartedCoordinator: boolean
  readonly latestGraphOperationId: OperationId
  readonly volatileObservation: VolatileObservation
  readonly observationAttempt: LabSnapshot["observationAttempt"]
  readonly preclaimReadyTaskIds: ReadonlySet<string>
  readonly recoveryRequests: ReadonlyArray<number>
  readonly readRecoveredFrontier: () => RunnableFrontier
  readonly records: ReadonlyArray<JournalRecord>
  readonly targetSettled: boolean
  readonly trackerClaims: ReadonlyArray<TrackerClaim>
  readonly trackerTasks: ReadonlyArray<ControlledTask>
  readonly workflowAcquiredClaims: ReadonlyMap<string, ActiveTaskClaim>
  readonly workflowAttemptPredecessors: ReadonlyMap<string, OperationId>
  readonly workflowEligibility: ReadonlyMap<string, ClaimedTaskEligibility>
  readonly workflowFailures: ReadonlyMap<string, string>
  readonly workflowSteps: ReadonlyMap<string, number>
  readonly workflowTasks: ReadonlyMap<string, Task>
}

const buildProductionInput = async (input: LabInput): Promise<ProductionInput> => {
  const records = new Array<JournalRecord>()
  const freshFacts = new Map<string, ReadonlyArray<FreshFact>>()
  const trackerTasksByTarget = new Map<ControlledTrackerTarget, Array<ControlledTask>>([
    ["Primary", cloneTasks(initialTrackerTasks)],
    ["Secondary", []]
  ])
  const trackerClaimsByTarget = new Map<
    ControlledTrackerTarget,
    Map<string, TrackerClaimState>
  >([
    ["Primary", new Map(initialTrackerTasks.map(({ id }) => [id, "Unclaimed"]))],
    ["Secondary", new Map()]
  ])
  const authorityTaskIdsByTarget = new Map<
    ControlledTrackerTarget,
    Set<string>
  >([
    ["Primary", new Set(initialTrackerTasks.map(({ id }) => id))],
    ["Secondary", new Set()]
  ])
  const volatileObservationByTarget = new Map<
    ControlledTrackerTarget,
    VolatileObservation
  >()
  const observationAttemptByTarget = new Map<
    ControlledTrackerTarget,
    LabSnapshot["observationAttempt"]
  >()
  let controlledTrackerTarget: ControlledTrackerTarget = "Primary"
  let trackerTasks = trackerTasksByTarget.get(controlledTrackerTarget) ?? []
  let trackerClaims = trackerClaimsByTarget.get(controlledTrackerTarget) ?? new Map()
  let allAuthorityTaskIds = authorityTaskIdsByTarget.get(controlledTrackerTarget) ?? new Set()
  let coordinatorRunning = true
  let hasRestartedCoordinator = false
  let capacity = 1
  let targetSettled = false
  let boundaryBehavior: BoundaryBehavior = "Successful"
  let observationOrdinal = 0
  let claimOrdinal = 0
  let controlOrdinal = 0
  let latestGraphOperationId = OperationId.make("graph-observation-unavailable")
  let volatileObservation: VolatileObservation = { _tag: "NeverObserved" }
  let observationAttempt: LabSnapshot["observationAttempt"] = { _tag: "NeverAttempted" }
  const preclaimReadyTaskIds = new Set<string>()
  const workflowAcquiredClaims = new Map<string, ActiveTaskClaim>()
  const workflowAttemptPredecessors = new Map<string, OperationId>()
  const workflowClaimAcquisitions = new Map<string, TaskClaimAcquisition>()
  const workflowEligibility = new Map<string, ClaimedTaskEligibility>()
  const workflowFailures = new Map<string, string>()
  const workflowSteps = new Map<string, number>()
  const workflowTasks = new Map<string, Task>()
  const activeClaims = new Map<string, ActiveTaskClaim>()
  const recoveryRequests = new Array<number>()
  const persistControlledTarget = (): void => {
    trackerTasksByTarget.set(controlledTrackerTarget, trackerTasks)
    trackerClaimsByTarget.set(controlledTrackerTarget, trackerClaims)
    authorityTaskIdsByTarget.set(controlledTrackerTarget, allAuthorityTaskIds)
    volatileObservationByTarget.set(controlledTrackerTarget, volatileObservation)
    observationAttemptByTarget.set(controlledTrackerTarget, observationAttempt)
  }
  const selectControlledTarget = (next: ControlledTrackerTarget): void => {
    persistControlledTarget()
    controlledTrackerTarget = next
    trackerTasks = trackerTasksByTarget.get(next) ?? []
    trackerClaims = trackerClaimsByTarget.get(next) ?? new Map()
    allAuthorityTaskIds = authorityTaskIdsByTarget.get(next) ?? new Set()
    volatileObservation =
      volatileObservationByTarget.get(next) ?? { _tag: "NeverObserved" }
    observationAttempt = observationAttemptByTarget.get(next) ?? { _tag: "NeverAttempted" }
    preclaimReadyTaskIds.clear()
  }

  const journal = JournalStore.of({
    append: (recordRunId, key, event) =>
      ProductionEffect.sync(() => {
        const existing = records.find((record) => record.key === key)
        if (existing !== undefined) return existing
        const record: JournalRecord = {
          event,
          key,
          position: JournalPosition.make(records.length + 1),
          runId: recordRunId
        }
        records.push(record)
        return record
      }),
    read: (recordRunId) =>
      ProductionEffect.succeed(records.filter((record) => record.runId === recordRunId)),
    scan: () =>
      ProductionEffect.succeed({
        issues: [],
        runs: records.length === 0 ? [] : [{ records: [...records], runId }]
      })
  })
  const control = ProductionEffect.runSync(
    ProductionEffect.gen(function*() {
      return yield* ControlService
    }).pipe(ProductionEffect.provide(
      controlServiceLayer.pipe(
        ProductionLayer.provide(ProductionLayer.succeed(JournalStore, journal))
      )
    ))
  )
  const recordControl = (
    command:
      | "RequestRunPause"
      | "RequestRunUnpause"
      | "RequestTaskPause"
      | "RequestTaskUnpause",
    taskId?: string
  ): void => {
    controlOrdinal += 1
    ProductionEffect.runSync(control.record(
      AuthenticatedOperatorIdentity.make("reducer-lab-operator"),
      command === "RequestRunPause" || command === "RequestRunUnpause"
        ? {
          _tag: command,
          commandId: ControlCommandId.make(`reducer-lab-control-${controlOrdinal}`),
          runId
        }
        : {
          _tag: command,
          commandId: ControlCommandId.make(`reducer-lab-control-${controlOrdinal}`),
          runId,
          taskId: TaskId.make(taskId ?? "unknown-task")
        }
    ))
  }
  const trackerReaderLayer = ProductionLayer.succeed(
    TrackerGraphReader,
    TrackerGraphReader.of({
      read: () => {
        const projected = projectTrackerSnapshot(projectionInput(
          trackerTasks,
          `tracker-revision-${observationOrdinal}`
        ))
        return projected._tag === "Invalid"
          ? ProductionEffect.fail(new GraphProjectionError({ issues: projected.issues }))
          : ProductionEffect.succeed(projected.snapshot)
      }
    })
  )
  const dryRunLayer = makeDryRunWorkflowInterpreterLayer().pipe(
    ProductionLayer.provide(trackerReaderLayer)
  )
  const controlledBoundaryLayer = ProductionLayer.effect(
    WorkflowInterpreter,
    ProductionEffect.gen(function*() {
      const dryRun = yield* WorkflowInterpreter
      return WorkflowInterpreter.of({
        ...dryRun,
        acquireTaskClaim: (operation, onIntentRecorded = ProductionEffect.void) =>
          ProductionEffect.gen(function*() {
            yield* onIntentRecorded
            const attempted = operation.acquisition
            const current = activeClaims.get(attempted.taskId)
            if (
              trackerClaims.get(attempted.taskId) === "Unclaimed"
              || (
                current !== undefined
                && isExactTaskClaim(current, ActiveTaskClaim.make(attempted))
              )
            ) {
              const acquired = ActiveTaskClaim.make(attempted)
              trackerClaims.set(attempted.taskId, "OwnedByLab")
              activeClaims.set(attempted.taskId, acquired)
              return AuthoritativeTaskClaimAcquired.make({ claim: acquired })
            }
            const observed = current ?? ActiveTaskClaim.make({
              operationId: OperationId.make(`foreign-claim:${attempted.taskId}`),
              owner: ClaimOwner.make("foreign-owner"),
              taskId: attempted.taskId,
              token: ClaimToken.make(`foreign-token:${attempted.taskId}`)
            })
            return yield* new TaskClaimConflict({ attempted, observed })
          }),
        reconcileTaskWorktree: (operation) =>
          ProductionEffect.succeed(AuthoritativeTaskWorktreeReady.make({
            proof: PlannedWorktreeReady.make({
              baseSha: operation.plannedAttempt.baseSha,
              branch: operation.plannedAttempt.branch,
              headSha: operation.plannedAttempt.baseSha,
              worktree: operation.plannedAttempt.worktree
            })
          }))
      })
    })
  ).pipe(ProductionLayer.provide(dryRunLayer))
  const taskRunnerLayer = ProductionLayer.succeed(
    TaskRunner,
    TaskRunner.of({
      lookupTaskWorkSession: (lookup) => {
        const observationId = ProviderObservationId.make(
          `lab-session-observation:${lookup.operationId}`
        )
        if (boundaryBehavior === "SessionLookupFails") {
          return ProductionEffect.fail(new TaskWorkSessionLookupFailure({
            detail: "controlled task-work session lookup failed",
            observationId
          }))
        }
        if (boundaryBehavior === "SessionStartFails") {
          return ProductionEffect.succeed(NoMatchingTaskWorkSessionReported.make({
            observationId
          }))
        }
        return ProductionEffect.succeed(MatchingTaskWorkSessionReported.make({
          observationId,
          sessionId: TaskWorkSessionId.make(`lab-session:${lookup.operationId}`),
          work: { _tag: "NoProviderWorkReported" }
        }))
      },
      requestTaskWorkStart: (request) => {
        const observationId = ProviderObservationId.make(
          `lab-session-request:${request.operationId}`
        )
        return boundaryBehavior === "SessionStartFails"
          ? ProductionEffect.fail(new TaskWorkStartRequestFailure({
            detail: "controlled task-work start request failed",
            observationId
          }))
          : ProductionEffect.succeed(TaskWorkStartRequestAcknowledgement.make({
            observationId,
            providerRequestId: ProviderRequestId.make(
              `lab-session-provider:${request.operationId}`
            )
          }))
      }
    })
  )
  const taskExecutorLayer = ProductionLayer.succeed(
    TaskExecutor,
    TaskExecutor.of({
      observeTaskExecution: (lookup) => {
        const observationId = ProviderObservationId.make(
          `lab-execution-observation:${lookup.operationId}`
        )
        const evidence = {
          observationId,
          operationId: lookup.operationId,
          processId: WorkerProcessId.make(1),
          sessionId: lookup.sessionId
        }
        switch (boundaryBehavior) {
          case "ExecutionObservationFails":
            return ProductionEffect.fail(new TaskExecutionObservationFailure({
              detail: "controlled task-execution observation failed",
              observationId,
              operationId: lookup.operationId
            }))
          case "ExecutionFails":
            return ProductionEffect.succeed(FailedTaskExecutionReported.make({
              ...evidence,
              exitCode: FailedProcessExitCode.make(1),
              partialOutput: "controlled execution failed",
              wipPreserved: true
            }))
          case "ExecutionInterrupted":
            return ProductionEffect.succeed(InterruptedTaskExecutionReported.make({
              ...evidence,
              partialOutput: "controlled execution interrupted",
              wipPreserved: true
            }))
          case "ResourceEmergency":
            return ProductionEffect.succeed(ResourceEmergencyTaskExecutionReported.make({
              ...evidence,
              cause: "MemoryExhausted",
              detail: "controlled resource emergency",
              partialOutput: "controlled execution stopped",
              wipPreserved: true
            }))
          default:
            return ProductionEffect.succeed(SuccessfulTaskExecutionReported.make({
              ...evidence,
              output: "controlled executor completed successfully"
            }))
        }
      },
      requestTaskExecution: (request) => {
        const observationId = ProviderObservationId.make(
          `lab-execution-request:${request.operationId}`
        )
        return boundaryBehavior === "ExecutionRequestFails"
          ? ProductionEffect.fail(new TaskExecutionRequestFailure({
            detail: "controlled task-execution request failed",
            observationId,
            operationId: request.operationId
          }))
          : ProductionEffect.succeed(TaskExecutionRequestAcknowledgement.make({
            observationId,
            providerRequestId: ProviderRequestId.make(
              `lab-execution-provider:${request.operationId}`
            )
          }))
      }
    })
  )
  const reviewResults = new Map<string, typeof ImplementationReviewDisposition.Type>()
  const reviewAttempts = new Map<string, number>()
  const handbackAttempts = new Map<string, number>()
  const reviewLayer = ProductionLayer.merge(
    ProductionLayer.succeed(
      ImplementationReviewer,
      ImplementationReviewer.of({
        createOrResume: (request) =>
          ProductionEffect.gen(function*() {
            const existing = reviewResults.get(request.operationId)
            if (existing !== undefined) return existing
            const attempt = (reviewAttempts.get(request.operationId) ?? 0) + 1
            reviewAttempts.set(request.operationId, attempt)
            if (boundaryBehavior === "ReviewRetriesThenAccepted" && attempt === 1) {
              return yield* new ImplementationReviewInvocationFailure({
                detail: "controlled reviewer invocation failed once",
                operationId: request.operationId,
                reviewerSessionId: request.reviewerSessionId
              })
            }
            const disposition =
              (
                boundaryBehavior === "ReviewFindingsThenAccepted"
                || boundaryBehavior === "HandbackRetriesThenAccepted"
              )
              && request.round === 1
                ? ImplementationReviewDisposition.cases.Findings.make({
                  findings: [{
                    findingId: ReviewFindingId.make(
                      `controlled-finding:${request.operationId}`
                    ),
                    text: "controlled semantic review finding"
                  }]
                })
                : ImplementationReviewDisposition.cases.Accepted.make({})
            reviewResults.set(request.operationId, disposition)
            return disposition
          })
      })
    ),
    ProductionLayer.succeed(
      ReviewFindingsHandback,
      ReviewFindingsHandback.of({
        deliverOrResume: (request) =>
          ProductionEffect.gen(function*() {
            const attempt = (handbackAttempts.get(request.operationId) ?? 0) + 1
            handbackAttempts.set(request.operationId, attempt)
            if (boundaryBehavior === "HandbackRetriesThenAccepted" && attempt === 1) {
              return yield* new ReviewFindingsHandbackFailure({
                detail: "controlled findings handback failed once",
                operationId: request.operationId
              })
            }
            return ReviewFindingsHandbackAcknowledged.make({
              operationId: request.operationId,
              reviewEvidenceReference: request.review.manifestReference
            })
          })
      })
    )
  )
  const evidenceObjects = new Map<string, Uint8Array>()
  const digestFor = (bytes: Uint8Array): typeof EvidenceDigest.Type =>
    EvidenceDigest.make(bytesToHex(sha256(bytes)))
  const evidenceLayer = ProductionLayer.merge(
    ProductionLayer.succeed(
      EvidenceStore,
      EvidenceStore.of({
        put: (bytes) =>
          ProductionEffect.sync(() => {
            const copy = bytes.slice()
            const digest = digestFor(copy)
            evidenceObjects.set(digest, copy)
            return EvidenceReference.make({ byteLength: copy.byteLength, digest })
          }),
        read: (reference) =>
          ProductionEffect.gen(function*() {
            const bytes = evidenceObjects.get(reference.digest)
            if (bytes === undefined || bytes.byteLength !== reference.byteLength) {
              return yield* new EvidenceStoreFailure({
                detail: `controlled evidence ${reference.digest} is unavailable`,
                operation: "EvidenceStore.read"
              })
            }
            return bytes.slice()
          })
      })
    ),
    ProductionLayer.succeed(
      ImplementationEvidenceSource,
      ImplementationEvidenceSource.of({
        readDiff: () =>
          ProductionEffect.succeed(
            new TextEncoder().encode("controlled implementation diff")
          )
      })
    )
  )
  const boundaryLayer = journaledWorkflowInterpreterLayer(
    runId,
    controlledBoundaryLayer,
    taskExecutorLayer,
    evidenceLayer,
    reviewLayer
  ).pipe(
    ProductionLayer.provide(taskRunnerLayer),
    ProductionLayer.provide(ProductionLayer.succeed(
      WorkflowTrace,
      WorkflowTrace.of({ emit: () => ProductionEffect.void })
    )),
    ProductionLayer.provide(ProductionLayer.succeed(JournalStore, journal))
  )
  const boundaryInterpreter = ProductionEffect.runSync(
    ProductionEffect.gen(function*() {
      return yield* WorkflowInterpreter
    }).pipe(ProductionEffect.provide(boundaryLayer))
  )
  const traceService = WorkflowTrace.of({ emit: () => ProductionEffect.void })
  const recoveryEnvironment = ProductionLayer.mergeAll(
    ProductionLayer.succeed(JournalStore, journal),
    ProductionLayer.succeed(WorkflowInterpreter, boundaryInterpreter),
    ProductionLayer.succeed(WorkflowTrace, traceService)
  )
  const materializeWorkflow = async (subjectTaskId: string): Promise<void> => {
    const task = workflowTasks.get(subjectTaskId)
    if (task === undefined) return
    const result = await ProductionEffect.runPromise(ProductionEffect.result(replayProductionWorkflow(
      task,
      workflowSteps.get(subjectTaskId) ?? 0,
      workflowEligibility.get(subjectTaskId) ?? "Pending",
      workflowAcquiredClaims.get(subjectTaskId),
      workflowAttemptPredecessors.get(subjectTaskId) ?? latestGraphOperationId,
      boundaryInterpreter
    )))
    if (result._tag === "Failure") {
      workflowFailures.set(subjectTaskId, String(result.failure))
    } else {
      workflowFailures.delete(subjectTaskId)
    }
  }
  const activateRecovery = (requestedCapacity: number) =>
      activateRecoveredResponsibilities(
        runId,
        TaskWorkCapacity.make(requestedCapacity)
      ).pipe(ProductionEffect.provide(recoveryEnvironment))

  const observeTrackerGraph = (
    explicitlyCoveredTaskIds: ReadonlyArray<string>,
    predecessorOperationIds: ReadonlyArray<OperationId> = []
  ): TaskDagSnapshot | null => {
    observationOrdinal += 1
    const operation = graphOperation(
      observationOrdinal,
      controlledTrackerTarget,
      explicitlyCoveredTaskIds,
      predecessorOperationIds
    )
    latestGraphOperationId = operation.operationId
    const revision = `tracker-revision-${observationOrdinal}`
    const result = ProductionEffect.runSync(
      ProductionEffect.result(boundaryInterpreter.readTrackerGraph(operation.operation))
    )
    if (result._tag === "Failure") {
      observationAttempt = {
        _tag: "Failed",
        issues: result.failure instanceof GraphProjectionError
          ? result.failure.issues.map(issueText)
          : [String(result.failure)]
      }
      return null
    }
    volatileObservation = {
      _tag: "Available",
      projected: result.success,
      tasks: cloneTasks(trackerTasks)
    }
    observationAttempt = { _tag: "Succeeded", revision }
    return result.success
  }

  for (const action of input.actions) {
    switch (action._tag) {
      case "ReplacedTrackerTask": {
        preclaimReadyTaskIds.clear()
        allAuthorityTaskIds.add(action.task.id)
        const index = trackerTasks.findIndex(({ id }) => id === action.task.id)
        trackerTasks = index === -1
          ? [...trackerTasks, { ...action.task, prerequisiteIds: [...action.task.prerequisiteIds] }]
          : trackerTasks.map((task, taskIndex) =>
            taskIndex === index
              ? { ...action.task, prerequisiteIds: [...action.task.prerequisiteIds] }
              : task
          )
        if (!trackerClaims.has(action.task.id)) trackerClaims.set(action.task.id, "Unclaimed")
        trackerTasksByTarget.set(controlledTrackerTarget, trackerTasks)
        break
      }
      case "DeletedTrackerTask":
        preclaimReadyTaskIds.clear()
        allAuthorityTaskIds.add(action.taskId)
        trackerTasks = trackerTasks.filter(({ id }) => id !== action.taskId)
        trackerTasksByTarget.set(controlledTrackerTarget, trackerTasks)
        trackerClaims.delete(action.taskId)
        break
      case "SetTrackerClaim":
        trackerClaims.set(action.taskId, action.state)
        if (action.state === "OwnedByLab") {
          const acquisition = workflowClaimAcquisitions.get(action.taskId)
          if (acquisition !== undefined) {
            activeClaims.set(action.taskId, ActiveTaskClaim.make(acquisition))
          }
        } else {
          activeClaims.delete(action.taskId)
        }
        break
      case "ObservedTrackerGraph": {
        preclaimReadyTaskIds.clear()
        observeTrackerGraph([...allAuthorityTaskIds])
        break
      }
      case "RecheckedTaskBeforeClaim": {
        const projected = observeTrackerGraph([action.taskId])
        if (
          projected?.eligibleTasks().some(({ id }) => id === taskId(action.taskId))
        ) {
          preclaimReadyTaskIds.add(action.taskId)
        }
        break
      }
      case "CommittedClaimIntent": {
        const capturedObservation = projectTrackerSnapshot(
          projectionInput(
            volatileObservationTasks(volatileObservation),
            "claim-captured-observation"
          )
        )
        const selectedTask = capturedObservation._tag === "Valid"
          ? capturedObservation.snapshot.eligibleTasks().find(
            ({ id }) => id === taskId(action.taskId)
          )
          : undefined
        if (selectedTask !== undefined) workflowTasks.set(action.taskId, selectedTask)
        workflowAttemptPredecessors.set(action.taskId, latestGraphOperationId)
        claimOrdinal += 1
        const operation = claimOperation(
          claimOrdinal,
          action.taskId,
          latestGraphOperationId
        )
        const acquisition = operation.acquisition
        workflowClaimAcquisitions.set(action.taskId, acquisition)
        const claimResult = ProductionEffect.runSync(
          ProductionEffect.result(boundaryInterpreter.acquireTaskClaim(operation))
        )
        if (
          claimResult._tag === "Success"
          && claimResult.success._tag === "AuthoritativeTaskClaimAcquired"
        ) {
          workflowAcquiredClaims.set(action.taskId, claimResult.success.claim)
        }
        workflowEligibility.set(action.taskId, "Pending")
        workflowSteps.set(action.taskId, 1)
        await materializeWorkflow(action.taskId)
        break
      }
      case "AdvancedTaskWorkflow": {
        const completedSteps = workflowSteps.get(action.taskId) ?? 0
        if (
          completedSteps === 1
          && workflowEligibility.get(action.taskId) === "Pending"
        ) {
          const acquisition = workflowClaimAcquisitions.get(action.taskId)
          const activeClaim = activeClaims.get(action.taskId)
          if (
            acquisition === undefined
            || activeClaim === undefined
            || !isExactTaskClaim(activeClaim, ActiveTaskClaim.make(acquisition))
          ) {
            workflowEligibility.set(action.taskId, "ClaimUnavailable")
            workflowSteps.set(action.taskId, 2)
            await materializeWorkflow(action.taskId)
            break
          }
          const projected = observeTrackerGraph(
            [action.taskId],
            [acquisition.operationId]
          )
          workflowAttemptPredecessors.set(action.taskId, latestGraphOperationId)
          const admittedTask = projected?.eligibleTasks().find(
            ({ id }) => id === taskId(action.taskId)
          )
          if (admittedTask !== undefined) {
            workflowTasks.set(action.taskId, admittedTask)
          }
          workflowEligibility.set(
            action.taskId,
            projected === null
              ? "Unreadable"
              : admittedTask !== undefined
                ? "Eligible"
                : "NotEligible"
          )
          workflowSteps.set(action.taskId, 2)
          await materializeWorkflow(action.taskId)
          break
        }
        workflowSteps.set(action.taskId, completedSteps + 1)
        await materializeWorkflow(action.taskId)
        break
      }
      case "AdvancedExecutorProtocol": {
        const completedSteps = workflowSteps.get(action.taskId) ?? 0
        if (
          completedSteps >= firstExecutorWorkflowStep
          && completedSteps < coordinatorExecutorWorkflowStepLimit
        ) {
          workflowSteps.set(action.taskId, coordinatorExecutorWorkflowStepLimit)
          await materializeWorkflow(action.taskId)
        }
        break
      }
      case "ActivatedRecoveredResponsibilities":
        recoveryRequests.push(capacity)
        break
      case "SuppliedFreshFact":
        freshFacts.set(action.operationId, [action.fact])
        break
      case "SuppliedFreshFactCardinality":
        freshFacts.set(
          action.operationId,
          action.cardinality === "Missing" ? [] : ["Ready", "Ready"]
        )
        break
      case "CrashedCoordinator":
        coordinatorRunning = false
        for (const [target, observation] of volatileObservationByTarget) {
          volatileObservationByTarget.set(target, discardVolatileObservation(observation))
        }
        volatileObservation = discardVolatileObservation(volatileObservation)
        preclaimReadyTaskIds.clear()
        break
      case "RestartedCoordinator":
        coordinatorRunning = true
        hasRestartedCoordinator = true
        break
      case "ChangedCapacity":
        capacity = action.capacity
        break
      case "ChangedTargetSettlement":
        targetSettled = action.settled
        break
      case "ChangedBoundaryBehavior":
        boundaryBehavior = action.behavior
        for (const failedTaskId of [...workflowFailures.keys()]) {
          await materializeWorkflow(failedTaskId)
        }
        break
      case "ChangedTrackerTarget":
        selectControlledTarget(action.target)
        break
      case "RequestedRunPause":
        recordControl("RequestRunPause")
        break
      case "RequestedRunUnpause":
        recordControl("RequestRunUnpause")
        break
      case "RequestedTaskPause":
        recordControl("RequestTaskPause", action.taskId)
        break
      case "RequestedTaskUnpause":
        recordControl("RequestTaskUnpause", action.taskId)
        break
    }
    persistControlledTarget()
  }

  return {
    activateRecovery: (requestedCapacity) =>
      ProductionEffect.runPromise(activateRecovery(requestedCapacity)),
    authorityIssues: (() => {
      const current = projectTrackerSnapshot(
        projectionInput(trackerTasks, "controlled-authority")
      )
      return current._tag === "Invalid" ? current.issues.map(issueText) : []
    })(),
    boundaryBehavior,
    controlledTrackerTarget,
    boundaryInterpreter,
    capacity,
    coordinatorRunning,
    freshFacts,
    hasRestartedCoordinator,
    latestGraphOperationId,
    volatileObservation,
    observationAttempt,
    preclaimReadyTaskIds,
    readRecoveredFrontier: () =>
      ProductionEffect.runSync(
        ProductionEffect.gen(function*() {
          const recovery = yield* makeManagedRecoveryActivation(runId)
          return yield* recovery.readFrontier
        }).pipe(ProductionEffect.provide(recoveryEnvironment))
      ),
    recoveryRequests,
    records,
    targetSettled,
    trackerClaims: [...trackerClaims].map(([taskId, state]) => ({ state, taskId })),
    trackerTasks,
    workflowAcquiredClaims,
    workflowAttemptPredecessors,
    workflowEligibility,
    workflowFailures,
    workflowSteps,
    workflowTasks
  }
}

const revisionFor = (input: LabInput): LabSnapshotRevision => {
  const source = JSON.stringify(input.actions)
  let hash = 2_166_136_261
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return LabSnapshotRevision.make(`snapshot-${input.actions.length}-${(hash >>> 0).toString(16)}`)
}

const journalOperationTag = (
  event: JournalRecord["event"]
): string | null => {
  if (!("operation" in event) || event.operation === null) return null
  const operation = event.operation as { readonly _tag?: unknown }
  return typeof operation._tag === "string" ? operation._tag : null
}

const journaledWorkflowOperationsForTask = (
  records: ReadonlyArray<JournalRecord>,
  subjectTaskId: string
): ReadonlyArray<string> => {
  const subject = taskId(subjectTaskId)
  const claimOperationIds = new Set(records.flatMap(({ event }) =>
    event._tag === "TaskClaimAcquisitionIntended"
      && event.operation.acquisition.taskId === subject
      ? [event.operation.acquisition.operationId]
      : []
  ))
  const claimedGraphOperationIds = new Set(records.flatMap(({ event }) =>
    event._tag === "TrackerGraphObservationIntentRecorded"
      && event.operation.predecessorOperationIds.some((operationId) =>
        claimOperationIds.has(operationId)
      )
      ? [event.operation.operationId]
      : []
  ))
  const worktreeTaskByOperation = new Map(records.flatMap(({ event }) =>
    event._tag === "TaskWorktreeReconciliationIntended"
      ? [[event.operation.operationId, event.operation.plannedAttempt.taskId] as const]
      : []
  ))
  const sessionTaskByOperation = new Map(records.flatMap(({ event }) =>
    event._tag === "TaskWorkSessionEstablishmentIntentRecorded"
      ? [[event.operation.request.operationId, event.operation.request.plannedAttempt.taskId] as const]
      : []
  ))
  const executionTaskByOperation = new Map(records.flatMap(({ event }) =>
    event._tag === "TaskExecutionIntentRecorded"
      ? [[event.operation.request.operationId, event.operation.request.plannedAttempt.taskId] as const]
      : []
  ))
  const handbackTaskByOperation = new Map(records.flatMap(({ event }) =>
    event._tag === "ReviewFindingsHandbackIntended"
      ? [[event.operation.request.operationId, event.operation.request.plannedAttempt.taskId] as const]
      : []
  ))
  return records.flatMap(({ event }) => {
    switch (event._tag) {
      case "TaskClaimAcquired":
        return event.claim.taskId === subject
          ? ["AcquireTaskClaim"]
          : []
      case "TrackerGraphOutcomeObserved":
        return claimedGraphOperationIds.has(event.operationId)
          ? ["ObserveClaimedTaskEligibility"]
          : []
      case "TaskAttemptPlanned":
        return event.operation.plannedAttempt.taskId === subject
          ? ["RecordTaskAttemptPlan"]
          : []
      case "TaskWorktreeReady":
        return worktreeTaskByOperation.get(event.operationId) === subject
          ? ["ReconcileTaskWorktree"]
          : []
      case "TaskWorkSessionEstablished":
        return sessionTaskByOperation.get(event.outcome.operationId) === subject
          ? ["EstablishTaskWorkSession"]
          : []
      case "TaskExecutionOutcomeObserved":
        return executionTaskByOperation.get(event.outcome.outcome.operationId) === subject
          ? ["StartExecutorInvocation"]
          : []
      case "ImplementationEvidenceSealed":
        return event.sealed.manifest.taskId === subject
          ? ["StartExecutorInvocation"]
          : []
      case "ImplementationReviewCompleted":
        return event.review.manifest.plannedAttempt.taskId === subject
          ? ["StartExecutorInvocation"]
          : []
      case "ReviewFindingsHandbackCompleted":
        return handbackTaskByOperation.get(event.acknowledgement.operationId) === subject
          ? ["StartExecutorInvocation"]
          : []
      case "ImplementationConvergenceDispositionRecorded":
        return event.operation.request._tag
          === "AuthorizedImplementationConvergenceDisposition"
          && event.operation.request.disposition.subject.plannedAttempt.taskId === subject
          ? ["StartExecutorInvocation"]
          : []
      default:
        return []
    }
  })
}

const dispositionFor = (
  fact: FreshFact,
  responsibility: WorkflowResponsibilityEntry
) => {
  switch (fact) {
    case "Ready": return ResponsibilityDisposition.Ready()
    case "ForeignClaim": return ResponsibilityDisposition.ForeignClaimIsolation()
    case "MissingClaim": return ResponsibilityDisposition.MissingClaim()
    case "Paused": return ResponsibilityDisposition.Paused()
    case "DependencyWait":
      return ResponsibilityDisposition.DependencyWait({
        prerequisiteTaskIds: [TaskId.make("controlled-prerequisite")]
      })
    case "Completed": return ResponsibilityDisposition.FinalOutcome({ outcome: "Completed" })
    case "Failed": return ResponsibilityDisposition.FinalOutcome({ outcome: "Failed" })
    case "Blocked": return ResponsibilityDisposition.FinalOutcome({ outcome: "Blocked" })
    case "Cancelled": return ResponsibilityDisposition.FinalOutcome({ outcome: "Cancelled" })
    case "Relinquished":
      return ResponsibilityDisposition.Relinquished({ reason: "AuthorizedHandoff" })
    case "Settled":
      return ResponsibilityDisposition.Settled({ outcome: "ResponsibilityCompleted" })
    case "Unreadable":
      return ResponsibilityDisposition.UnreadableFactWait({ boundary: "TaskTracker" })
    case "ExecutorWait":
      return responsibility._tag === "ExecutorInvocationResponsibility"
        ? ResponsibilityDisposition.ExecutorInvocationWait({
          wait: ExecutorOuterInvocationWait.cases.RetryScheduled.make({
            correlation: responsibility.invocation.correlation,
            notBefore: TechnicalRetryNotBefore.make(1)
          })
        })
        : ResponsibilityDisposition.Ready()
    case "ExecutorSettled":
      return responsibility._tag === "ExecutorInvocationResponsibility"
        ? ResponsibilityDisposition.ExecutorInvocationSettled({
          outcome: ExecutorOuterInvocationOutcome.cases.Completed.make({
            correlation: responsibility.invocation.correlation
          })
        })
        : ResponsibilityDisposition.Ready()
  }
}

const decision = (transition: RunnableFrontierTransition) => ({
  operationId: runnableTransitionOperationId(transition) ?? null,
  tag: transition._tag,
  taskId: runnableTransitionTaskId(transition)
})

const move = (
  id: string,
  origin: LabMoveOrigin,
  transition: string,
  subject: LabMoveSubject,
  availability: LabMoveAvailability
): LabMove => ({
  availability,
  id: LabMoveId.make(id),
  origin,
  subject,
  transition
})

const transitionIdentity = (transition: RunnableFrontierTransition): string =>
  `${transition._tag}:${runnableTransitionTaskId(transition)}:${
    runnableTransitionOperationId(transition) ?? "fresh"
  }`

const frontierMove = (
  transition: RunnableFrontierTransition,
  admitted: ReadonlyArray<RunnableFrontierTransition>,
  coordinatorRunning: boolean,
  preclaimReadyTaskIds: ReadonlySet<string>,
  recoverableTransitionIds: ReadonlySet<string>
): LabMove => {
  const subjectTaskId = runnableTransitionTaskId(transition)
  if (transition._tag !== "CommitFreshTaskClaimIntent") {
    const operationId = runnableTransitionOperationId(transition)
    return move(
      `frontier:${transition._tag}:${subjectTaskId}:${operationId ?? "fresh"}`,
      "ProductionFrontierSelection",
      transition._tag,
      { _tag: "Task", taskId: subjectTaskId },
      {
        _tag: "DriverMissing",
        owningIssue: recoverableTransitionIds.has(transitionIdentity(transition))
          ? "use the production recovery coordinator control"
          : "not selected by production recovery",
        reason: "ProductionTransitionNotDriven"
      }
    )
  }
  if (!preclaimReadyTaskIds.has(subjectTaskId)) {
    return move(
      `workflow:recheck-before-claim:${subjectTaskId}`,
      "LabProductionStageControl",
      "RecheckTaskBeforeClaim",
      { _tag: "Task", taskId: subjectTaskId },
      coordinatorRunning
        ? {
          _tag: "Available",
          input: {
            _tag: "RecheckedTaskBeforeClaim",
            taskId: subjectTaskId
          }
        }
        : { _tag: "Waiting", reason: "CoordinatorStopped" }
    )
  }
  const isAdmitted = admitted.some((candidate) =>
    candidate._tag === transition._tag
    && runnableTransitionTaskId(candidate) === subjectTaskId
  )
  return move(
    `frontier:CommitFreshTaskClaimIntent:${subjectTaskId}`,
    "ProductionFrontierSelection",
    transition._tag,
    { _tag: "Task", taskId: subjectTaskId },
    !coordinatorRunning
      ? { _tag: "Waiting", reason: "CoordinatorStopped" }
      : isAdmitted
        ? {
          _tag: "Available",
          input: { _tag: "CommittedClaimIntent", taskId: subjectTaskId }
        }
        : { _tag: "Waiting", reason: "WaitingForAdmissionCapacity" }
  )
}

const driverMoves = (
  coordinatorRunning: boolean,
  capacity: number,
  boundaryBehavior: BoundaryBehavior,
  controlledTrackerTarget: ControlledTrackerTarget,
  targetSettled: boolean,
  responsibilities: LabSnapshot["responsibilities"],
  trackerTasks: ReadonlyArray<ControlledTask>
): ReadonlyArray<LabMove> => [
  ...ControlledTrackerTarget.literals.map((controlledTarget) =>
    move(
      `tracker:set-target:${controlledTarget}`,
      "FakeTaskTracker",
      "SelectControlledTrackerTarget",
      { _tag: "TrackerTarget" },
      controlledTrackerTarget === controlledTarget
        ? { _tag: "NotCurrent", reason: "AlreadyCurrent" }
        : {
          _tag: "Available",
          input: { _tag: "ChangedTrackerTarget", target: controlledTarget }
        }
    )
  ),
  ...BoundaryBehavior.literals.map((behavior) =>
    move(
      `boundary:set-behavior:${behavior}`,
      "FakeBoundarySetup",
      "SetBoundaryBehavior",
      { _tag: "Run" },
      boundaryBehavior === behavior
        ? { _tag: "NotCurrent", reason: "AlreadyCurrent" }
        : {
          _tag: "Available",
          input: { _tag: "ChangedBoundaryBehavior", behavior }
        }
    )
  ),
  move(
    "tracker:observe-target",
    "FakeTaskTracker",
    "ObserveTrackerTarget",
    { _tag: "TrackerTarget" },
    coordinatorRunning
      ? { _tag: "Available", input: { _tag: "ObservedTrackerGraph" } }
      : { _tag: "Waiting", reason: "CoordinatorStopped" }
  ),
  move(
    `tracker:set-target-settled:${!targetSettled}`,
    "LabFinalityInput",
    "SetTrackerTargetSettlement",
    { _tag: "TrackerTarget" },
    {
      _tag: "Available",
      input: { _tag: "ChangedTargetSettlement", settled: !targetSettled }
    }
  ),
  ...responsibilities.flatMap(({ kind, operationId, taskId }) =>
    [
      ...([
      "Ready",
      "ForeignClaim",
      "MissingClaim",
      "Paused",
      "DependencyWait",
      "Completed",
      "Failed",
      "Blocked",
      "Cancelled",
      "Relinquished",
      "Settled",
      "Unreadable",
      ...(kind === "ExecutorInvocationResponsibility"
        ? ["ExecutorWait", "ExecutorSettled"] as const
        : [])
      ] as const).map((fact) =>
      move(
        `tracker:supply-fact:${operationId}:${fact}`,
        "LabResponsibilitySelectorInput",
        `Supply${fact}Fact`,
        { _tag: "Task", taskId },
        {
          _tag: "Available",
          input: { _tag: "SuppliedFreshFact", fact, operationId, taskId }
        }
      )
      ),
      ...(["Missing", "Duplicate"] as const).map((cardinality) =>
        move(
          `tracker:supply-cardinality:${operationId}:${cardinality}`,
          "LabResponsibilitySelectorInput",
          `Supply${cardinality}FreshFacts`,
          { _tag: "Task", taskId },
          {
            _tag: "Available",
            input: {
              _tag: "SuppliedFreshFactCardinality",
              cardinality,
              operationId,
              taskId
            }
          }
        )
      )
    ]
  ),
  move(
    "coordinator:crash",
    "LabCoordinatorSimulation",
    "CrashCoordinator",
    { _tag: "Coordinator" },
    coordinatorRunning
      ? { _tag: "Available", input: { _tag: "CrashedCoordinator" } }
      : { _tag: "NotCurrent", reason: "AlreadyCurrent" }
  ),
  move(
    "coordinator:restart",
    "LabCoordinatorSimulation",
    "RestartCoordinator",
    { _tag: "Coordinator" },
    coordinatorRunning
      ? { _tag: "NotCurrent", reason: "AlreadyCurrent" }
      : { _tag: "Available", input: { _tag: "RestartedCoordinator" } }
  ),
  ...([1, 2, 3] as const).map((nextCapacity) =>
    move(
      `coordinator:set-capacity:${nextCapacity}`,
      "LabCoordinatorSimulation",
      "SetTaskWorkCapacity",
      { _tag: "Capacity", capacity: nextCapacity },
      capacity === nextCapacity
        ? { _tag: "NotCurrent", reason: "AlreadyCurrent" }
        : {
          _tag: "Available",
          input: { _tag: "ChangedCapacity", capacity: nextCapacity }
        }
    )
  ),
  move(
    "control:pause-run",
    "OperatorControlRequest",
    "RequestRunPause",
    { _tag: "Run" },
    {
      _tag: "Available",
      input: { _tag: "RequestedRunPause" }
    }
  ),
  move(
    "control:unpause-run",
    "OperatorControlRequest",
    "RequestRunUnpause",
    { _tag: "Run" },
    {
      _tag: "Available",
      input: { _tag: "RequestedRunUnpause" }
    }
  ),
  ...trackerTasks.flatMap(({ id: taskId }) => [
    move(
      `control:pause-task:${taskId}`,
      "OperatorControlRequest",
      "RequestTaskPause",
      { _tag: "Task", taskId },
      {
        _tag: "Available",
        input: { _tag: "RequestedTaskPause", taskId }
      }
    ),
    move(
      `control:unpause-task:${taskId}`,
      "OperatorControlRequest",
      "RequestTaskUnpause",
      { _tag: "Task", taskId },
      {
        _tag: "Available",
        input: { _tag: "RequestedTaskUnpause", taskId }
      }
    )
  ])
]

const emptyProductionSnapshot = (
  input: LabInput,
  built: ProductionInput,
  errors: ReadonlyArray<string>
): LabSnapshot => ({
  admitted: [],
  appliedThrough: null,
  authorityIssues: built.authorityIssues,
  boundaryBehavior: built.boundaryBehavior,
  controlledTrackerTarget: built.controlledTrackerTarget,
  capacity: built.capacity,
  coordinatorRunning: built.coordinatorRunning,
  errors,
  explanations: [],
  finalityReason: null,
  finalityTag: "UnsafeToDecide",
  frontier: [],
  graphKnowledge: [],
  input,
  journal: built.records.map(({ event, position }) => ({
    operationTag: journalOperationTag(event),
    position,
    tag: event._tag
  })),
  latestObservation: snapshotLatestObservation(built.volatileObservation),
  moves: driverMoves(
    built.coordinatorRunning,
    built.capacity,
    built.boundaryBehavior,
    built.controlledTrackerTarget,
    built.targetSettled,
    [],
    built.trackerTasks
  ),
  observationAttempt: built.observationAttempt,
  reservedTaskIds: [],
  responsibilities: [],
  revision: revisionFor(input),
  runPause: "Unknown",
  status: "InvalidManagedHistory",
  targetSettled: built.targetSettled,
  taskPause: "Unknown",
  trackerClaims: built.trackerClaims,
  trackerTasks: built.trackerTasks,
  workflowProgress: []
})

/** Narrow adapter around current production reconstruction, selection, and admission. */
const reconstructThroughProduction = (
  input: LabInput
): Effect.Effect<LabSnapshot> =>
  Effect.gen(function*() {
    const built = yield* Effect.promise(() => buildProductionInput(input))
    yield* Effect.forEach(
      built.recoveryRequests,
      (requestedCapacity) =>
        Effect.promise(() => built.activateRecovery(requestedCapacity)),
      { concurrency: 1, discard: true }
    )
    const recoveredFrontierAfterActivation = built.readRecoveredFrontier()
    const workflowProgress = yield* Effect.forEach(
      [...built.workflowSteps],
      ([subjectTaskId, steps]) => {
        const task = built.workflowTasks.get(subjectTaskId)
        return task === undefined
          ? Effect.succeed<ProductionWorkflowProgress>({
            completedOperations: [],
            completedExecutorInvocations: 0,
            executorInvocationCount,
            nextOperation: null,
            nextTransition: null,
            status: "TaskSelectionUnavailable",
            taskId: subjectTaskId,
            taskRevision: null,
            trace: ["No task was captured when the claim move was selected."]
          })
          : built.workflowFailures.has(subjectTaskId)
          ? Effect.succeed<ProductionWorkflowProgress>({
            completedExecutorInvocations: Math.max(
              0,
              Math.min(executorInvocationCount, steps - firstExecutorWorkflowStep - 1)
            ),
            completedOperations: completedProductionWorkflowOperations.slice(
              0,
              Math.max(0, steps - 1)
            ),
            executorInvocationCount,
            nextOperation: null,
            nextTransition: null,
            status: "BoundaryFailed",
            taskId: subjectTaskId,
            taskRevision: taskRevisionFor(task),
            trace: [
              `Production boundary failed · ${built.workflowFailures.get(subjectTaskId)}`
            ]
          })
          : built.recoveryRequests.length > 0
          ? (() => {
            const recoveredOperations = journaledWorkflowOperationsForTask(
              built.records,
              subjectTaskId
            )
            const recoveredInvocationCount = recoveredOperations.filter(
              (operation) => operation === "StartExecutorInvocation"
            ).length
            const hasTerminalDisposition = built.records.some(({ event }) =>
              event._tag === "ImplementationConvergenceDispositionRecorded"
              && event.operation.request._tag
                === "AuthorizedImplementationConvergenceDisposition"
              && event.operation.request.disposition.subject.plannedAttempt.taskId
                === taskId(subjectTaskId)
            )
            const outstandingTransition = recoveredFrontierAfterActivation.transitions.find(
              (transition) => runnableTransitionTaskId(transition) === taskId(subjectTaskId)
            )
            return hasTerminalDisposition && outstandingTransition === undefined
              ? Effect.succeed<ProductionWorkflowProgress>({
                completedExecutorInvocations: recoveredInvocationCount,
                completedOperations: recoveredOperations,
                executorInvocationCount: Math.max(
                  executorInvocationCount,
                  recoveredInvocationCount
                ),
                nextOperation: null,
                nextTransition: null,
                status: "ExecutorCompleted",
                taskId: subjectTaskId,
                taskRevision: taskRevisionFor(task),
                trace: [
                  "Production recovery recorded this task's terminal convergence disposition and left no recovered transition."
                ]
              })
              : Effect.succeed<ProductionWorkflowProgress>({
                completedExecutorInvocations: recoveredInvocationCount,
                completedOperations: recoveredOperations,
                executorInvocationCount: Math.max(
                  executorInvocationCount,
                  recoveredInvocationCount + (outstandingTransition === undefined ? 0 : 1)
                ),
                nextOperation: outstandingTransition?._tag ?? null,
                nextTransition: outstandingTransition?._tag ?? null,
                status: "RecoveryIncomplete",
                taskId: subjectTaskId,
                taskRevision: taskRevisionFor(task),
                trace: [
                  outstandingTransition === undefined
                    ? "Production recovery stopped without a terminal convergence disposition."
                    : `Production recovery stopped at ${outstandingTransition._tag}.`
                ]
              })
          })()
          : replayProductionWorkflow(
            task,
            steps,
            built.workflowEligibility.get(subjectTaskId) ?? "Pending",
            built.workflowAcquiredClaims.get(subjectTaskId),
            built.workflowAttemptPredecessors.get(subjectTaskId)
              ?? built.latestGraphOperationId,
            built.boundaryInterpreter
          ) as unknown as Effect.Effect<ProductionWorkflowProgress>
      }
    )
    const reduced = reduceManagedHistory(runId, built.records)
    if (reduced._tag === "InvalidManagedHistory") {
      return emptyProductionSnapshot(
        input,
        built,
        reduced.issues.map(({ detail, position }) => `#${position}: ${detail}`)
      )
    }

    const run = reduced.managedRun
    const responsibilityFacts = run.responsibility.entries.flatMap((responsibility) => {
      const responsibilityTaskId = responsibility._tag === "ExecutorInvocationResponsibility"
        ? responsibility.invocation.correlation.taskId
        : responsibility.taskId
      const observedLifecycle = volatileObservationTasks(built.volatileObservation).find(
        ({ id }) => id === responsibilityTaskId
      )?.lifecycle
      const operationId = workflowResponsibilityOperationId(responsibility)
      const facts: ReadonlyArray<FreshFact> = observedLifecycle === "CompletedSuccessfully"
        ? ["Completed"]
        : observedLifecycle === "TerminalWithoutSuccess"
          ? ["Failed"]
          : built.freshFacts.get(operationId) ?? ["Ready"]
      return facts.map((fact) => ({
        disposition: dispositionFor(fact, responsibility),
        responsibility
      }))
    })
    const controlledFrontier = deriveRunnableFrontier({
      freshEligibleTasks: built.volatileObservation._tag === "Available"
        ? built.volatileObservation.projected.eligibleTasks().map((task) => ({
          taskId: task.id,
          taskRevision: taskRevisionFor(task)
        }))
        : [],
      responsibility: run.responsibility,
      responsibilityFacts
    })
    const recoveredFrontier = built.readRecoveredFrontier()
    const transitionsByIdentity = new Map<string, RunnableFrontierTransition>()
    for (const transition of [
      ...controlledFrontier.transitions,
      ...recoveredFrontier.transitions
    ]) {
      transitionsByIdentity.set(transitionIdentity(transition), transition)
    }
    const frontier: RunnableFrontier = {
      explanations: [
        ...controlledFrontier.explanations,
        ...recoveredFrontier.explanations
      ],
      transitions: [...transitionsByIdentity.values()]
    }
    const recoverableTransitionIds = new Set(
      recoveredFrontier.transitions.map(transitionIdentity)
    )
    const firstRecoveredTransition = recoveredFrontier.transitions[0]
    // The repository currently pins Effect beta.99 while FoldKit pins beta.101.
    // Vite aliases both imports to beta.101 at runtime; this cast bridges only
    // the duplicate nominal Effect type identities seen by TypeScript.
    const controller = yield* (makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(built.capacity),
      freshOccupiedInvocations: [],
      reconstructedReservedPositions: run.responsibility.entries.flatMap((entry) =>
        entry._tag === "TaskClaimResponsibility"
          ? [{
            operationId: entry.acquisition.operationId,
            taskId: entry.taskId
          }]
          : []
      )
    }) as unknown as Effect.Effect<{
      readonly admit: (frontier: unknown, runId: RunId) => Effect.Effect<{
        readonly explanations: ReadonlyArray<ProductionFrontierExplanation>
        readonly transition:
          | { readonly _tag: "None" }
          | { readonly _tag: "Some"; readonly value: RunnableFrontierTransition }
      }>
      readonly snapshot: () => Effect.Effect<{
        readonly reservedTaskIds: ReadonlyArray<TaskId>
      }>
    }>)
    let remainingTransitions = [...frontier.transitions]
    let admittedPreview: ReadonlyArray<RunnableFrontierTransition> = []
    let admissionExplanations: ReadonlyArray<ProductionFrontierExplanation> = [...frontier.explanations]
    for (;;) {
      const pass = yield* controller.admit({
        explanations: frontier.explanations,
        transitions: remainingTransitions
      }, runId)
      admissionExplanations = [...pass.explanations]
      if (pass.transition._tag === "None") break
      const admittedTransition = pass.transition.value
      admittedPreview = [...admittedPreview, admittedTransition]
      remainingTransitions = remainingTransitions.filter(
        (transition) => transition !== admittedTransition
      )
    }
    const admissionSnapshot = yield* controller.snapshot()
    const admitted = built.coordinatorRunning ? admittedPreview : []
    const finality = deriveRunFinalityDecision(
      frontier,
      run.responsibility,
      built.targetSettled
    )
    const responsibilities = run.responsibility.entries.map((entry) => ({
      beganAt: entry.beganAt,
      kind: entry._tag,
      operationId: workflowResponsibilityOperationId(entry),
      taskId: entry._tag === "ExecutorInvocationResponsibility"
        ? entry.invocation.correlation.taskId
        : entry.taskId
    }))

    return {
      admitted: admitted.map(decision),
      appliedThrough: run.appliedThrough,
      authorityIssues: built.authorityIssues,
      boundaryBehavior: built.boundaryBehavior,
      controlledTrackerTarget: built.controlledTrackerTarget,
      capacity: built.capacity,
      coordinatorRunning: built.coordinatorRunning,
      errors: [],
      explanations: admissionExplanations.map((explanation) => ({
        tag: explanation._tag,
        taskId: "taskId" in explanation ? explanation.taskId : null
      })),
      finalityReason: finality._tag === "RunMayTerminate" ? null : finality.reason,
      finalityTag: finality._tag,
      frontier: frontier.transitions.map(decision),
      graphKnowledge: run.graphKnowledge.targetClosures.map((knowledge) =>
        knowledge._tag === "TaskTrackerTargetClosureObserved"
          ? {
            details: [
              `revision ${knowledge.revision}`,
              `covered [${knowledge.explicitlyCoveredTaskIds.join(", ")}]`,
              `proven absent [${knowledge.provenAbsentTaskIds.join(", ")}]`,
              `observed at #${knowledge.observedAt}`
            ],
            kind: knowledge._tag,
            observationCount: 1,
            taskIds: knowledge.taskIds
          }
          : {
            details: knowledge.observations.map((observation) =>
              `${observation.revision} · [${observation.taskIds.join(", ")}] · #${observation.observedAt}`
            ),
            kind: knowledge._tag,
            observationCount: knowledge.observations.length,
            taskIds: []
          }
      ),
      input,
      journal: built.records.map(({ event, position }) => ({
        operationTag: journalOperationTag(event),
        position,
        tag: event._tag
      })),
      latestObservation: snapshotLatestObservation(built.volatileObservation),
      moves: [
        ...frontier.transitions.map((transition) =>
          frontierMove(
            transition,
            admitted,
            built.coordinatorRunning,
            built.preclaimReadyTaskIds,
            recoverableTransitionIds
          )
        ),
        ...workflowProgress.flatMap((progress) =>
          progress.nextOperation === null
            ? []
            : [move(
                `workflow:advance:${progress.taskId}:${progress.completedOperations.length}`,
                "LabProductionStageControl",
                progress.nextOperation,
                { _tag: "Task", taskId: progress.taskId },
                built.coordinatorRunning
                  ? {
                    _tag: "Available",
                    input: { _tag: "AdvancedTaskWorkflow", taskId: progress.taskId }
                  }
                  : { _tag: "Waiting", reason: "CoordinatorStopped" }
              )]
        ),
        ...workflowProgress.flatMap((progress) =>
          progress.nextOperation === "StartExecutorInvocation"
            ? [move(
              `coordinator:run-executor:${progress.taskId}:${progress.completedExecutorInvocations}`,
              "LabProductionStageControl",
              "RunExecutorInvocationsToCompletion",
              { _tag: "Task", taskId: progress.taskId },
              built.coordinatorRunning
                ? {
                  _tag: "Available",
                  input: {
                    _tag: "AdvancedExecutorProtocol",
                    taskId: progress.taskId
                  }
                }
                : { _tag: "Waiting", reason: "CoordinatorStopped" }
            )]
            : []
        ),
        ...(built.hasRestartedCoordinator && firstRecoveredTransition !== undefined
          ? [move(
            "coordinator:activate-recovered",
            "ProductionCoordinator",
            "RunRecoveredResponsibilitiesToQuiescence",
            {
              _tag: "Task",
              taskId: runnableTransitionTaskId(firstRecoveredTransition)
            },
            built.coordinatorRunning
              ? {
                _tag: "Available",
                input: {
                  _tag: "ActivatedRecoveredResponsibilities",
                  taskId: runnableTransitionTaskId(firstRecoveredTransition)
                }
              }
              : { _tag: "Waiting", reason: "CoordinatorStopped" }
          )]
          : []),
        ...driverMoves(
          built.coordinatorRunning,
          built.capacity,
          built.boundaryBehavior,
          built.controlledTrackerTarget,
          built.targetSettled,
          responsibilities,
          built.trackerTasks
        )
      ],
      observationAttempt: built.observationAttempt,
      reservedTaskIds: admissionSnapshot.reservedTaskIds,
      responsibilities,
      revision: revisionFor(input),
      runPause: run.pause.run._tag,
      status: reduced._tag,
      targetSettled: built.targetSettled,
      taskPause: run.pause.tasks._tag,
      trackerClaims: built.trackerClaims,
      trackerTasks: built.trackerTasks,
      workflowProgress
    }
  })

/** Reconstructs one semantic snapshot from an exact Lab input prefix. */
export const reconstructLabSnapshot = (
  input: LabInput
): Effect.Effect<LabSnapshot> => reconstructThroughProduction(input)

const executeInput = (
  snapshot: LabSnapshot,
  input: LabAction,
  expectedRevision: LabSnapshotRevision
): Effect.Effect<LabMoveExecution, StaleLabSnapshot> =>
  snapshot.revision !== expectedRevision
    ? Effect.fail(new StaleLabSnapshot({
      actualRevision: snapshot.revision,
      expectedRevision,
      moveId: LabMoveId.make("explicit-lab-command")
    }))
    : reconstructThroughProduction({
      actions: [...snapshot.input.actions, input]
    }).pipe(Effect.map((nextSnapshot) => ({ input, snapshot: nextSnapshot })))

/**
 * Applies graph-card CRUD or a separate claim control as a replayable Lab
 * command. It changes controlled authority only; observing remains a separate move.
 */
export const executeLabCommand = (
  snapshot: LabSnapshot,
  input: LabAction,
  expectedRevision: LabSnapshotRevision
): Effect.Effect<LabMoveExecution, StaleLabSnapshot | InvalidLabCommand> => {
  if (
    input._tag !== "ReplacedTrackerTask"
    && input._tag !== "DeletedTrackerTask"
    && input._tag !== "SetTrackerClaim"
  ) {
    return Effect.fail(new InvalidLabCommand({
      reason: `${input._tag} is not an explicit graph-editor command`
    }))
  }
  return executeInput(snapshot, input, expectedRevision)
}

/**
 * Revalidates a semantic move against the exact snapshot before applying it.
 * FoldKit never receives or appends the move's hidden Lab input directly.
 */
export const executeLabMove = (
  snapshot: LabSnapshot,
  moveId: LabMoveId,
  expectedRevision: LabSnapshotRevision
): Effect.Effect<
  LabMoveExecution,
  StaleLabSnapshot | UnknownLabMove | UnavailableLabMove
> =>
  Effect.gen(function*() {
    if (snapshot.revision !== expectedRevision) {
      return yield* new StaleLabSnapshot({
        actualRevision: snapshot.revision,
        expectedRevision,
        moveId
      })
    }
    const selected = snapshot.moves.find((candidate) => candidate.id === moveId)
    if (selected === undefined) return yield* new UnknownLabMove({ moveId })
    if (selected.availability._tag !== "Available") {
      return yield* new UnavailableLabMove({
        availability: selected.availability._tag,
        moveId
      })
    }
    return yield* executeInput(snapshot, selected.availability.input, expectedRevision)
  })
