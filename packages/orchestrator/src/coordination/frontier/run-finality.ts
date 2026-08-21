/* eslint-disable functional/immutable-data -- Graph blockage is a private monotone fixed-point computation, not persisted state. */
import {
  RunId,
  TaskId,
  plannedAttemptExecutorCorrelation,
  plannedAttemptExecutorCorrelationKey
} from "@dalph/contracts"
import { Data, Schema } from "effect"
import { workflowResponsibilityOperationId, type WorkflowResponsibilityState } from "../reconstruction/state.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { OperationId } from "../../workflow/identity.js"
import { TrackerRevision, type TrackerTask } from "../../authorities/task-tracker/task.js"
import { exactTaskIdSetKey, TrackerTarget, taskTrackerTargetKey } from "../../authorities/task-tracker/target.js"
import type { TaskDagSnapshot } from "../../authorities/task-tracker/graph.js"
import { CompleteTargetClosureCoverage } from "../../workflow/task-tracker-facts/observation.js"
import type { RunnableFrontier } from "./frontier.js"

/** The only whole-Run terminal classifications accepted by V1. */
export const RunTerminationDisposition = Schema.Literals(["Completed", "Blocked", "Cancelled"])
export type RunTerminationDisposition = typeof RunTerminationDisposition.Type

/** Classification of one accepted complete current Run graph. */
export const RunGraphOutcome = Schema.Literals(["AllTasksSucceeded", "Blocked", "Unsettled"])
export type RunGraphOutcome = typeof RunGraphOutcome.Type

/** Applies V1 terminal precedence: success wins, then durable cancellation, then conclusive blockage. */
export const runTerminationDispositionOf = (
  graphOutcome: RunGraphOutcome,
  cancellationApplied: boolean
): RunTerminationDisposition | undefined =>
  graphOutcome === "AllTasksSucceeded"
    ? "Completed"
    : cancellationApplied
      ? "Cancelled"
      : graphOutcome === "Blocked"
        ? "Blocked"
        : undefined

/** Exact operation read shape retained beside the normalized graph coverage. */
export const RunFinalityReadShape = Schema.TaggedStruct("CompleteTargetClosure", {
  explicitlyCoveredTaskIds: Schema.Array(TaskId).check(Schema.isUnique())
})
export type RunFinalityReadShape = typeof RunFinalityReadShape.Type

const RunFinalityFactFamily = Schema.Literals([
  "TaskIdentities",
  "TaskLifecycles",
  "TaskPrerequisites",
  "TaskGroupings",
  "TaskTargetMembership"
])
type RunFinalityFactFamily = typeof RunFinalityFactFamily.Type

export const requiredRunFinalityFactFamilies: readonly [
  RunFinalityFactFamily,
  RunFinalityFactFamily,
  RunFinalityFactFamily,
  RunFinalityFactFamily,
  RunFinalityFactFamily
] = ["TaskIdentities", "TaskLifecycles", "TaskPrerequisites", "TaskGroupings", "TaskTargetMembership"]
const exactStringSequenceKey = (values: ReadonlyArray<string>): string => values.join("\u0000")

/**
 * Tracker facts sufficient to classify one fresh complete Run graph. The
 * evidence is deliberately independent from the Boolean finality decision:
 * it names the Run, target, read, revision, coverage, and journal position.
 */
const RunFinalityEvidenceFields = Schema.Struct({
  complete: Schema.Boolean,
  coverage: CompleteTargetClosureCoverage,
  contentIdentity: TrackerRevision,
  graphOutcome: RunGraphOutcome,
  operationId: OperationId,
  readShape: RunFinalityReadShape,
  requiredFactFamilies: Schema.Tuple([
    RunFinalityFactFamily,
    RunFinalityFactFamily,
    RunFinalityFactFamily,
    RunFinalityFactFamily,
    RunFinalityFactFamily
  ]),
  /** Exact normalized task identity resolved by the tracker for the Run target. */
  rootTaskId: TaskId,
  rootPresent: Schema.Boolean,
  runId: RunId,
  blockedTaskIds: Schema.Array(TaskId).check(Schema.isUnique()),
  target: TrackerTarget,
  terminalTaskIds: Schema.Array(TaskId).check(Schema.isUnique()),
  observedAt: JournalPosition
})

type RunFinalityEvidenceFields = typeof RunFinalityEvidenceFields.Type

const runFinalityEvidenceIssue = (evidence: RunFinalityEvidenceFields): string | undefined => {
  const issues: ReadonlyArray<readonly [boolean, string]> = [
    [!evidence.complete, "finality evidence must be complete"],
    [!evidence.rootPresent, "finality evidence must include the Run root"],
    [
      taskTrackerTargetKey(evidence.coverage.target) !== taskTrackerTargetKey(evidence.target),
      "finality coverage must name the exact Run tracker target"
    ],
    [
      exactStringSequenceKey(evidence.requiredFactFamilies) !== exactStringSequenceKey(requiredRunFinalityFactFamilies),
      "finality evidence must include every complete graph fact family in order"
    ],
    [
      exactTaskIdSetKey(evidence.readShape.explicitlyCoveredTaskIds) !==
        exactTaskIdSetKey(evidence.coverage.explicitlyCoveredTaskIds),
      "finality evidence read shape must exactly match its coverage"
    ],
    [!evidence.rootPresent || evidence.rootTaskId.length === 0, "finality evidence must name the exact Run root"],
    [
      evidence.graphOutcome === "Blocked" &&
        [evidence.terminalTaskIds.length, evidence.blockedTaskIds.length].some((length) => length === 0),
      "blocked finality evidence must name terminal and dependent unsuccessful tasks"
    ],
    [
      evidence.graphOutcome === "AllTasksSucceeded" &&
        [evidence.terminalTaskIds.length, evidence.blockedTaskIds.length].some((length) => length > 0),
      "all-success finality evidence may not name unsuccessful tasks"
    ]
  ]
  return issues.find(([invalid]) => invalid)?.[1]
}

export const RunFinalityEvidence = RunFinalityEvidenceFields.check(Schema.makeFilter(runFinalityEvidenceIssue))
export type RunFinalityEvidence = typeof RunFinalityEvidence.Type

export type RunGraphTaskFacts = Pick<TrackerTask, "id" | "lifecycle" | "prerequisiteIds">

/** Classifies normalized lifecycle and prerequisite facts through one shared finality algebra. */
export const runGraphTaskFactsOutcome = (
  tasks: ReadonlyArray<RunGraphTaskFacts>
): {
  readonly graphOutcome: RunGraphOutcome
  readonly terminalTaskIds: ReadonlyArray<TaskId>
  readonly blockedTaskIds: ReadonlyArray<TaskId>
} => {
  const terminalTaskIds = tasks
    .filter(({ lifecycle }) => lifecycle._tag === "TerminalWithoutSuccess")
    .map(({ id }) => id)
    .toSorted()
  const blocked = new Set<TaskId>(terminalTaskIds)
  let changed = true
  while (changed) {
    changed = false
    for (const { id, prerequisiteIds } of tasks) {
      if (!blocked.has(id) && prerequisiteIds.some((prerequisiteId) => blocked.has(prerequisiteId))) {
        blocked.add(id)
        changed = true
      }
    }
  }
  const allTasksSucceeded = tasks.every(({ lifecycle }) => lifecycle._tag === "CompletedSuccessfully")
  const allTasksSettledBySuccessOrBlockage = tasks.every(
    ({ id, lifecycle }) => lifecycle._tag === "CompletedSuccessfully" || blocked.has(id)
  )
  return {
    blockedTaskIds: [...blocked].toSorted(),
    graphOutcome: allTasksSucceeded
      ? "AllTasksSucceeded"
      : terminalTaskIds.length > 0 && allTasksSettledBySuccessOrBlockage
        ? "Blocked"
        : "Unsettled",
    terminalTaskIds
  }
}

/** Classifies one normalized graph and retains the dependency facts supporting blockage. */
export const runGraphFactsOutcome = (snapshot: TaskDagSnapshot) => runGraphTaskFactsOutcome(snapshot.toWire().tasks)

/** Builds typed evidence from the accepted normalized graph observation. */
export const makeRunFinalityEvidence = (input: {
  readonly runId: RunId
  readonly target: TrackerTarget
  readonly operationId: OperationId
  readonly observedAt: JournalPosition
  readonly snapshot: TaskDagSnapshot
  readonly readShape: RunFinalityReadShape
  /** Exact normalized root supplied by the tracker read, never inferred from parent edges. */
  readonly rootTaskId: TaskId
}): RunFinalityEvidence => {
  const tasks = input.snapshot.toWire().tasks
  const { blockedTaskIds, graphOutcome, terminalTaskIds } = runGraphFactsOutcome(input.snapshot)
  return RunFinalityEvidence.make({
    blockedTaskIds,
    complete: true,
    coverage: CompleteTargetClosureCoverage.make({
      explicitlyCoveredTaskIds: input.readShape.explicitlyCoveredTaskIds,
      target: input.target
    }),
    contentIdentity: input.snapshot.revision,
    graphOutcome,
    operationId: input.operationId,
    readShape: input.readShape,
    requiredFactFamilies: requiredRunFinalityFactFamilies,
    rootTaskId: input.rootTaskId,
    rootPresent: tasks.some(({ id }) => id === input.rootTaskId),
    runId: input.runId,
    target: input.target,
    terminalTaskIds,
    observedAt: input.observedAt
  })
}

/** Exact comparison used by the termination boundary after journal publication. */
export const runFinalityEvidenceMatches = (
  evidence: RunFinalityEvidence,
  expected: {
    readonly runId: RunId
    readonly target: TrackerTarget
    readonly operationId: OperationId
    readonly observedAt: JournalPosition
    readonly revision: TrackerRevision
    readonly readShape: RunFinalityReadShape
    /** Exact root resolved by the tracker observation being compared. */
    readonly rootTaskId: TaskId
  }
): boolean => {
  const expectedTaskIds = exactTaskIdSetKey(expected.readShape.explicitlyCoveredTaskIds)
  return [
    evidence.runId === expected.runId,
    taskTrackerTargetKey(evidence.target) === taskTrackerTargetKey(expected.target),
    evidence.operationId === expected.operationId,
    evidence.observedAt === expected.observedAt,
    evidence.contentIdentity === expected.revision,
    exactTaskIdSetKey(evidence.coverage.explicitlyCoveredTaskIds) === expectedTaskIds,
    exactTaskIdSetKey(evidence.readShape.explicitlyCoveredTaskIds) === expectedTaskIds,
    evidence.complete,
    evidence.rootPresent,
    evidence.rootTaskId === expected.rootTaskId,
    exactStringSequenceKey(evidence.requiredFactFamilies) === exactStringSequenceKey(requiredRunFinalityFactFamilies),
    exactTaskIdSetKey(evidence.readShape.explicitlyCoveredTaskIds) ===
      exactTaskIdSetKey(evidence.coverage.explicitlyCoveredTaskIds)
  ].every(Boolean)
}

export type RunFinalityDecision = Data.TaggedEnum<{
  RunMayTerminate: Record<never, never>
  RunMustRemainActive: { readonly reason: "RunnableTransition" | "TrackerTargetUnsettled" | "UnsettledResponsibility" }
}>

export const RunFinalityDecision = Data.taggedEnum<RunFinalityDecision>()

/** The journal prefix used by the exact relation evaluation that proved finality. */
/** Active proofs carry only the reason why this activation must remain open. */
export type RunFinalityProof =
  | {
      readonly acceptedAt: JournalPosition | null
      readonly decision: Extract<RunFinalityDecision, { readonly _tag: "RunMustRemainActive" }>
    }
  /** A terminal proof cannot exist without its exact fresh graph evidence. */
  | {
      readonly acceptedAt: JournalPosition
      readonly decision: Extract<RunFinalityDecision, { readonly _tag: "RunMayTerminate" }>
      readonly disposition: RunTerminationDisposition
      readonly evidence: RunFinalityEvidence
    }

const unsettledExplanationTags = new Set<RunnableFrontier["explanations"][number]["_tag"]>([
  "IntegrationDependencyWait",
  "IntegrationInProgress",
  "IntegrationTrackerFactsWait",
  "IntegrationTargetWait",
  "IntegrationConfigurationWait",
  "IntegrationFinalityConfigurationWait",
  "IntegrationFinalityTrackerSuccessWait",
  "IntegrationFinalityNonConvergence",
  "PlannedAttemptTaskExternalSuccessConstraint",
  "PlannedAttemptTaskLifecycleConstraint",
  "PlannedAttemptTaskSpecificationChangeConstraint"
])

/** Run termination requires tracker settlement and no runnable or unsettled responsibility. */
export const deriveRunFinalityDecision = (
  frontier: RunnableFrontier,
  responsibility: WorkflowResponsibilityState,
  trackerTargetSettled: boolean
): RunFinalityDecision => {
  if (frontier.transitions.length > 0) {
    return RunFinalityDecision.RunMustRemainActive({ reason: "RunnableTransition" })
  }
  if (frontier.explanations.some(({ _tag }) => unsettledExplanationTags.has(_tag))) {
    return RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" })
  }
  const terminalOperationIds = new Set(
    frontier.explanations.flatMap((explanation) =>
      explanation._tag === "FinalOutcome" || explanation._tag === "Relinquishment" || explanation._tag === "Settlement"
        ? [explanation.operationId]
        : []
    )
  )
  const terminalPlannedAttempts = new Set(
    frontier.explanations.flatMap((explanation) =>
      explanation._tag === "PlannedAttemptExecutorWorkTerminal"
        ? [plannedAttemptExecutorCorrelationKey(explanation.report.correlation)]
        : []
    )
  )
  if (
    responsibility.entries.some((entry) =>
      entry._tag === "PlannedAttemptExecutorWorkResponsibility"
        ? !terminalPlannedAttempts.has(
            plannedAttemptExecutorCorrelationKey(plannedAttemptExecutorCorrelation(entry.plannedAttempt))
          ) &&
          !frontier.explanations.some(
            (explanation) =>
              explanation._tag === "PlannedAttemptTaskExternalSuccessSettled" &&
              plannedAttemptExecutorCorrelationKey(explanation.correlation) ===
                plannedAttemptExecutorCorrelationKey(plannedAttemptExecutorCorrelation(entry.plannedAttempt))
          )
        : !terminalOperationIds.has(workflowResponsibilityOperationId(entry))
    )
  ) {
    return RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" })
  }
  return trackerTargetSettled
    ? RunFinalityDecision.RunMayTerminate()
    : RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })
}
