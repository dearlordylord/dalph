import { Effect, Schema as S } from "effect"
import {
  Effect as ProductionEffect,
  Layer as ProductionLayer
} from "../../../node_modules/effect/dist/index.js"
import {
  ClaimOwner,
  ClaimToken,
  FixtureTarget,
  JournalPosition,
  OperationId,
  RunId,
  type Task,
  TaskId,
  TaskWorkCapacity,
  TrackerRevision
} from "../../../packages/orchestrator/src/domain.ts"
import {
  JournalStore,
  type JournalRecord
} from "../../../packages/orchestrator/src/journal-store.ts"
import { journaledWorkflowInterpreterLayer } from "../../../packages/orchestrator/src/journaled-workflow-interpreter.ts"
import {
  EvidenceStore,
  ImplementationEvidenceSource
} from "../../../packages/orchestrator/src/implementation-evidence.ts"
import {
  ImplementationReviewer,
  ReviewFindingsHandback
} from "../../../packages/orchestrator/src/implementation-review.ts"
import { reduceManagedHistory } from "../../../packages/orchestrator/src/managed-history.ts"
import {
  deriveRunFinalityDecision,
  deriveRunnableFrontier,
  ResponsibilityDisposition,
  runnableTransitionTaskId,
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
import { taskExecutorTestLayer } from "../../../packages/orchestrator/src/task-execution.ts"
import { TaskRunner } from "../../../packages/orchestrator/src/task-work-start.ts"
import { TrackerGraphReader } from "../../../packages/orchestrator/src/tracker-graph-reader.ts"
import {
  AuthoritativeTaskClaimAcquired,
  WorkflowInterpreter,
  WorkflowTrace
} from "../../../packages/orchestrator/src/workflow.ts"
import { makeDryRunWorkflowInterpreterLayer } from "../../../packages/orchestrator/src/workflow-interpreters.ts"
import {
  makeTaskClaimAcquisitionOperation,
  makeTrackerGraphObservationOperation
} from "../../../packages/orchestrator/src/workflow-operation.ts"
import {
  type ClaimedTaskEligibility,
  completedExecutorWorkflowStep,
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

export const FreshFact = S.Literals(["Ready", "ForeignClaim", "MissingClaim", "Paused"])
export type FreshFact = typeof FreshFact.Type

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
  S.TaggedStruct("SuppliedFreshFact", { fact: FreshFact, taskId: S.String }),
  S.TaggedStruct("CrashedCoordinator", {}),
  S.TaggedStruct("RestartedCoordinator", {}),
  S.TaggedStruct("ChangedCapacity", { capacity: S.Number }),
  S.TaggedStruct("ChangedTargetSettlement", { settled: S.Boolean })
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

export const LabMoveOrigin = S.Literals([
  "FrontierTransition",
  "TrackerAuthority",
  "CoordinatorProcess",
  "LabCapability"
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

const Decision = S.Struct({ tag: S.String, taskId: S.String })
const Responsibility = S.Struct({
  beganAt: S.Number,
  kind: S.String,
  taskId: S.String
})
const JournalRow = S.Struct({ position: S.Number, tag: S.String })
const FrontierExplanation = S.Struct({
  tag: S.String,
  taskId: S.NullOr(S.String)
})
const GraphKnowledge = S.Struct({
  kind: S.String,
  observationCount: S.Number,
  taskIds: S.Array(S.String)
})
const ObservationAttempt = S.Union([
  S.TaggedStruct("NeverAttempted", {}),
  S.TaggedStruct("Succeeded", { revision: S.String }),
  S.TaggedStruct("Failed", { issues: S.Array(S.String) })
])
const WorkflowProgress = S.Struct({
  completedOperations: S.Array(S.String),
  completedExecutorInvocations: S.Number,
  executorInvocationCount: S.Number,
  nextOperation: S.NullOr(S.String),
  status: S.Literals([
    "InProgress",
    "ClaimedTaskNotEligible",
    "TrackerReadFailed",
    "ClaimAuthorityChanged",
    "ExecutorCompleted",
    "TaskSelectionUnavailable"
  ]),
  taskId: S.String,
  taskRevision: S.NullOr(S.String),
  trace: S.Array(S.String)
})

/** Semantic result reconstructed by real production reducers plus controlled Lab inputs. */
export const LabSnapshot = S.Struct({
  admitted: S.Array(Decision),
  authorityIssues: S.Array(S.String),
  capacity: S.Number,
  coordinatorRunning: S.Boolean,
  errors: S.Array(S.String),
  explanations: S.Array(FrontierExplanation),
  finalityReason: S.NullOr(S.String),
  finalityTag: S.String,
  frontier: S.Array(Decision),
  graphKnowledge: S.Array(GraphKnowledge),
  hasSuccessfulObservation: S.Boolean,
  input: LabInput,
  journal: S.Array(JournalRow),
  latestObservation: S.Array(ControlledTask),
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
const target = FixtureTarget.make("reducer-lab-target")
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
  explicitlyCoveredTaskIds: ReadonlyArray<string>,
  predecessorOperationIds: ReadonlyArray<OperationId> = []
) => {
  const operationId = OperationId.make(`graph-observation-${ordinal}`)
  const operation = makeTrackerGraphObservationOperation(
    operationId,
    target,
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

interface ProductionInput {
  readonly authorityIssues: ReadonlyArray<string>
  readonly capacity: number
  readonly coordinatorRunning: boolean
  readonly freshFacts: ReadonlyMap<string, FreshFact>
  readonly hasSuccessfulObservation: boolean
  readonly latestGraphOperationId: OperationId
  readonly latestObservation: ReadonlyArray<ControlledTask>
  readonly latestProjected: TaskDagSnapshot | null
  readonly observationAttempt: LabSnapshot["observationAttempt"]
  readonly preclaimReadyTaskIds: ReadonlySet<string>
  readonly records: ReadonlyArray<JournalRecord>
  readonly targetSettled: boolean
  readonly trackerClaims: ReadonlyArray<TrackerClaim>
  readonly trackerTasks: ReadonlyArray<ControlledTask>
  readonly workflowAcquiredClaims: ReadonlyMap<string, ActiveTaskClaim>
  readonly workflowAttemptPredecessors: ReadonlyMap<string, OperationId>
  readonly workflowEligibility: ReadonlyMap<string, ClaimedTaskEligibility>
  readonly workflowSteps: ReadonlyMap<string, number>
  readonly workflowTasks: ReadonlyMap<string, Task>
}

const buildProductionInput = (input: LabInput): ProductionInput => {
  const records = new Array<JournalRecord>()
  const freshFacts = new Map<string, FreshFact>()
  let trackerTasks = cloneTasks(initialTrackerTasks)
  const trackerClaims = new Map<string, TrackerClaimState>(
    trackerTasks.map(({ id }) => [id, "Unclaimed"])
  )
  const allAuthorityTaskIds = new Set(trackerTasks.map(({ id }) => id))
  let coordinatorRunning = true
  let capacity = 1
  let targetSettled = false
  let observationOrdinal = 0
  let claimOrdinal = 0
  let latestGraphOperationId = OperationId.make("graph-observation-unavailable")
  let latestObservation: ReadonlyArray<ControlledTask> = []
  let latestProjected: TaskDagSnapshot | null = null
  let hasSuccessfulObservation = false
  let observationAttempt: LabSnapshot["observationAttempt"] = { _tag: "NeverAttempted" }
  const preclaimReadyTaskIds = new Set<string>()
  const workflowAcquiredClaims = new Map<string, ActiveTaskClaim>()
  const workflowAttemptPredecessors = new Map<string, OperationId>()
  const workflowClaimAcquisitions = new Map<string, TaskClaimAcquisition>()
  const workflowEligibility = new Map<string, ClaimedTaskEligibility>()
  const workflowSteps = new Map<string, number>()
  const workflowTasks = new Map<string, Task>()
  const activeClaims = new Map<string, ActiveTaskClaim>()

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
          })
      })
    })
  ).pipe(ProductionLayer.provide(dryRunLayer))
  const unusedEvidenceLayer = ProductionLayer.merge(
    ProductionLayer.succeed(
      EvidenceStore,
      EvidenceStore.of({
        put: () => ProductionEffect.die("Lab boundary replay does not store evidence"),
        read: () => ProductionEffect.die("Lab boundary replay does not read evidence")
      })
    ),
    ProductionLayer.succeed(
      ImplementationEvidenceSource,
      ImplementationEvidenceSource.of({
        readDiff: () => ProductionEffect.die("Lab boundary replay does not read Git")
      })
    )
  )
  const unusedReviewLayer = ProductionLayer.merge(
    ProductionLayer.succeed(
      ImplementationReviewer,
      ImplementationReviewer.of({
        createOrResume: () => ProductionEffect.die("Lab boundary replay does not invoke reviewers")
      })
    ),
    ProductionLayer.succeed(
      ReviewFindingsHandback,
      ReviewFindingsHandback.of({
        deliverOrResume: () => ProductionEffect.die("Lab boundary replay does not hand back findings")
      })
    )
  )
  const boundaryLayer = journaledWorkflowInterpreterLayer(
    runId,
    controlledBoundaryLayer,
    taskExecutorTestLayer,
    unusedEvidenceLayer,
    unusedReviewLayer
  ).pipe(
    ProductionLayer.provide(ProductionLayer.succeed(
      TaskRunner,
      TaskRunner.of({
        lookupTaskWorkSession: () => ProductionEffect.die("Lab boundary replay does not inspect sessions"),
        requestTaskWorkStart: () => ProductionEffect.die("Lab boundary replay does not start sessions")
      })
    )),
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

  const observeTrackerGraph = (
    explicitlyCoveredTaskIds: ReadonlyArray<string>,
    predecessorOperationIds: ReadonlyArray<OperationId> = []
  ): TaskDagSnapshot | null => {
    observationOrdinal += 1
    const operation = graphOperation(
      observationOrdinal,
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
    latestObservation = cloneTasks(trackerTasks)
    latestProjected = result.success
    hasSuccessfulObservation = true
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
        break
      }
      case "DeletedTrackerTask":
        preclaimReadyTaskIds.clear()
        allAuthorityTaskIds.add(action.taskId)
        trackerTasks = trackerTasks.filter(({ id }) => id !== action.taskId)
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
          projectionInput(latestObservation, "claim-captured-observation")
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
          break
        }
        workflowSteps.set(action.taskId, completedSteps + 1)
        break
      }
      case "AdvancedExecutorProtocol": {
        const completedSteps = workflowSteps.get(action.taskId) ?? 0
        if (
          completedSteps >= firstExecutorWorkflowStep
          && completedSteps < completedExecutorWorkflowStep
        ) {
          workflowSteps.set(action.taskId, completedExecutorWorkflowStep)
        }
        break
      }
      case "SuppliedFreshFact":
        freshFacts.set(action.taskId, action.fact)
        break
      case "CrashedCoordinator":
        coordinatorRunning = false
        break
      case "RestartedCoordinator":
        coordinatorRunning = true
        break
      case "ChangedCapacity":
        capacity = action.capacity
        break
      case "ChangedTargetSettlement":
        targetSettled = action.settled
        break
    }
  }

  return {
    authorityIssues: (() => {
      const current = projectTrackerSnapshot(
        projectionInput(trackerTasks, "controlled-authority")
      )
      return current._tag === "Invalid" ? current.issues.map(issueText) : []
    })(),
    capacity,
    coordinatorRunning,
    freshFacts,
    hasSuccessfulObservation,
    latestGraphOperationId,
    latestObservation,
    latestProjected,
    observationAttempt,
    preclaimReadyTaskIds,
    records,
    targetSettled,
    trackerClaims: [...trackerClaims].map(([taskId, state]) => ({ state, taskId })),
    trackerTasks,
    workflowAcquiredClaims,
    workflowAttemptPredecessors,
    workflowEligibility,
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

const dispositionFor = (fact: FreshFact) => {
  switch (fact) {
    case "Ready": return ResponsibilityDisposition.Ready()
    case "ForeignClaim": return ResponsibilityDisposition.ForeignClaimIsolation()
    case "MissingClaim": return ResponsibilityDisposition.MissingClaim()
    case "Paused": return ResponsibilityDisposition.Paused()
  }
}

const decision = (transition: RunnableFrontierTransition) => ({
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

const frontierMove = (
  transition: RunnableFrontierTransition,
  admitted: ReadonlyArray<RunnableFrontierTransition>,
  coordinatorRunning: boolean,
  preclaimReadyTaskIds: ReadonlySet<string>,
  workflowProgress: ReadonlyMap<string, ProductionWorkflowProgress>
): LabMove => {
  const subjectTaskId = runnableTransitionTaskId(transition)
  const progress = workflowProgress.get(subjectTaskId)
  if (progress !== undefined && progress.nextOperation !== null) {
    return move(
      `workflow:advance:${subjectTaskId}:${progress.completedOperations.length}`,
      "FrontierTransition",
      progress.nextOperation,
      { _tag: "Task", taskId: subjectTaskId },
      coordinatorRunning
        ? {
          _tag: "Available",
          input: { _tag: "AdvancedTaskWorkflow", taskId: subjectTaskId }
        }
        : { _tag: "Waiting", reason: "CoordinatorStopped" }
    )
  }
  if (transition._tag !== "CommitFreshTaskClaimIntent") {
    return move(
      `frontier:${transition._tag}:${subjectTaskId}`,
      "FrontierTransition",
      transition._tag,
      { _tag: "Task", taskId: subjectTaskId },
      {
        _tag: "DriverMissing",
        owningIssue: "prototype driver gap",
        reason: "ProductionTransitionNotDriven"
      }
    )
  }
  if (!preclaimReadyTaskIds.has(subjectTaskId)) {
    return move(
      `workflow:recheck-before-claim:${subjectTaskId}`,
      "FrontierTransition",
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
    "FrontierTransition",
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
  targetSettled: boolean,
  responsibilities: LabSnapshot["responsibilities"]
): ReadonlyArray<LabMove> => [
  move(
    "tracker:observe-target",
    "TrackerAuthority",
    "ObserveTrackerTarget",
    { _tag: "TrackerTarget" },
    coordinatorRunning
      ? { _tag: "Available", input: { _tag: "ObservedTrackerGraph" } }
      : { _tag: "Waiting", reason: "CoordinatorStopped" }
  ),
  move(
    `tracker:set-target-settled:${!targetSettled}`,
    "TrackerAuthority",
    "SetTrackerTargetSettlement",
    { _tag: "TrackerTarget" },
    {
      _tag: "Available",
      input: { _tag: "ChangedTargetSettlement", settled: !targetSettled }
    }
  ),
  ...responsibilities.flatMap(({ taskId }) =>
    (["Ready", "ForeignClaim", "MissingClaim", "Paused"] as const).map((fact) =>
      move(
        `tracker:supply-fact:${taskId}:${fact}`,
        "TrackerAuthority",
        `Supply${fact}Fact`,
        { _tag: "Task", taskId },
        {
          _tag: "Available",
          input: { _tag: "SuppliedFreshFact", fact, taskId }
        }
      )
    )
  ),
  move(
    "coordinator:crash",
    "CoordinatorProcess",
    "CrashCoordinator",
    { _tag: "Coordinator" },
    coordinatorRunning
      ? { _tag: "Available", input: { _tag: "CrashedCoordinator" } }
      : { _tag: "NotCurrent", reason: "AlreadyCurrent" }
  ),
  move(
    "coordinator:restart",
    "CoordinatorProcess",
    "RestartCoordinator",
    { _tag: "Coordinator" },
    coordinatorRunning
      ? { _tag: "NotCurrent", reason: "AlreadyCurrent" }
      : { _tag: "Available", input: { _tag: "RestartedCoordinator" } }
  ),
  ...([1, 2, 3] as const).map((nextCapacity) =>
    move(
      `coordinator:set-capacity:${nextCapacity}`,
      "CoordinatorProcess",
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
    "capability:pause-run",
    "LabCapability",
    "PauseRun",
    { _tag: "Run" },
    {
      _tag: "Planned",
      owningIssue: "#134",
      reason: "ProductionPauseStateAbsent"
    }
  ),
  move(
    "capability:pause-task",
    "LabCapability",
    "PauseTask",
    { _tag: "Task", taskId: "A" },
    {
      _tag: "Planned",
      owningIssue: "#135",
      reason: "ProductionPauseStateAbsent"
    }
  )
]

const emptyProductionSnapshot = (
  input: LabInput,
  built: ProductionInput,
  errors: ReadonlyArray<string>
): LabSnapshot => ({
  admitted: [],
  authorityIssues: built.authorityIssues,
  capacity: built.capacity,
  coordinatorRunning: built.coordinatorRunning,
  errors,
  explanations: [],
  finalityReason: null,
  finalityTag: "UnsafeToDecide",
  frontier: [],
  graphKnowledge: [],
  hasSuccessfulObservation: built.hasSuccessfulObservation,
  input,
  journal: built.records.map(({ event, position }) => ({ position, tag: event._tag })),
  latestObservation: built.latestObservation,
  moves: driverMoves(built.coordinatorRunning, built.capacity, built.targetSettled, []),
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
    const built = buildProductionInput(input)
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
            status: "TaskSelectionUnavailable",
            taskId: subjectTaskId,
            taskRevision: null,
            trace: ["No task was captured when the claim move was selected."]
          })
          : replayProductionWorkflow(
            task,
            steps,
            built.workflowEligibility.get(subjectTaskId) ?? "Pending",
            built.workflowAcquiredClaims.get(subjectTaskId),
            built.workflowAttemptPredecessors.get(subjectTaskId)
              ?? built.latestGraphOperationId
          ) as unknown as Effect.Effect<ProductionWorkflowProgress>
      }
    )
    const workflowProgressByTask = new Map(
      workflowProgress.map((progress) => [progress.taskId, progress])
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
    const responsibilityFacts = run.responsibility.entries.map((responsibility) => {
      const responsibilityTaskId = responsibility._tag === "ExecutorInvocationResponsibility"
        ? responsibility.invocation.correlation.taskId
        : responsibility.taskId
      return {
        disposition: dispositionFor(built.freshFacts.get(responsibilityTaskId) ?? "Ready"),
        responsibility
      }
    })
    const frontier = deriveRunnableFrontier({
      freshEligibleTasks: built.latestProjected?.eligibleTasks().map((task) => ({
        taskId: task.id,
        taskRevision: taskRevisionFor(task)
      })) ?? [],
      responsibility: run.responsibility,
      responsibilityFacts
    })
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
      taskId: entry._tag === "ExecutorInvocationResponsibility"
        ? entry.invocation.correlation.taskId
        : entry.taskId
    }))

    return {
      admitted: admitted.map(decision),
      authorityIssues: built.authorityIssues,
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
            kind: knowledge._tag,
            observationCount: 1,
            taskIds: knowledge.taskIds
          }
          : {
            kind: knowledge._tag,
            observationCount: knowledge.observations.length,
            taskIds: []
          }
      ),
      hasSuccessfulObservation: built.hasSuccessfulObservation,
      input,
      journal: built.records.map(({ event, position }) => ({ position, tag: event._tag })),
      latestObservation: built.latestObservation,
      moves: [
        ...frontier.transitions.map((transition) =>
          frontierMove(
            transition,
            admitted,
            built.coordinatorRunning,
            built.preclaimReadyTaskIds,
            workflowProgressByTask
          )
        ),
        ...workflowProgress.flatMap((progress) =>
          progress.nextOperation === null
            ? []
            : frontier.transitions.some((transition) =>
              runnableTransitionTaskId(transition) === progress.taskId
            )
              ? []
              : [move(
                `workflow:advance:${progress.taskId}:${progress.completedOperations.length}`,
                "FrontierTransition",
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
              "CoordinatorProcess",
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
        ...driverMoves(
          built.coordinatorRunning,
          built.capacity,
          built.targetSettled,
          responsibilities
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
