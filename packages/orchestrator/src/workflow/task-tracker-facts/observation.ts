import { Schema } from "effect"
import { TaskId, TaskRevision } from "@dalph/contracts"
import { OperationId } from "../identity.js"
import { TaskLifecycle, TrackerRevision } from "../../authorities/task-tracker/task.js"
import {
  TrackerTarget,
  exactTaskIdSetKey,
  factFamiliesCoverTarget,
  taskTrackerTargetKey
} from "../../authorities/task-tracker/target.js"
import { workflowJournalEventVersion } from "../kernel/event.js"
import type { TaskDagSnapshot } from "../../authorities/task-tracker/graph.js"
import { type TaskWorkSpecification } from "@dalph/contracts"
import type { WorkflowOperation } from "../registry/operation.js"
import { TaskClaimObservation } from "../../authorities/task-tracker/claim-mutation.js"
import { taskClaimObservationAttemptBound } from "../protocols/task-claim-observation/bound.js"
import { FocusedTaskCompletionFactsObserved } from "./focused-completion-observation.js"
import { TaskTrackerFactsReadFailed } from "./read-observation.js"
export {
  FocusedTaskCompletionFactsObserved,
  makeFocusedTaskCompletionFactsObserved
} from "./focused-completion-observation.js"
export {
  TaskTrackerFactsReadFailed,
  TaskTrackerFactsReadFailure,
  TaskTrackerFactsReadUnavailable
} from "./read-observation.js"

const completeFactEvidenceFields = {
  completeness: Schema.Literal("Complete"),
  consistency: Schema.Literal("PotentiallyMixedTime"),
  contentIdentity: TrackerRevision,
  freshness: Schema.TaggedStruct("ObservedDuringLogicalRead", { operationId: OperationId })
}

const exactTaskSubjects = { subjectTaskIds: Schema.Array(TaskId).check(Schema.isUnique()) }
export const CompleteTargetClosureCoverage = Schema.TaggedStruct("CompleteTargetClosure", {
  explicitlyCoveredTaskIds: Schema.Array(TaskId).check(Schema.isUnique()),
  target: TrackerTarget
})
const ExactTaskWorkSpecificationCoverage = Schema.TaggedStruct("ExactTaskWorkSpecification", { taskId: TaskId })
const ExactTaskClaimCoverage = Schema.TaggedStruct("ExactTaskClaim", { taskId: TaskId })

/** The task identities returned for one complete task-tracker target closure. */
export const TaskIdentitiesObserved = Schema.TaggedStruct("TaskIdentities", {
  ...completeFactEvidenceFields,
  coverage: CompleteTargetClosureCoverage,
  taskIds: Schema.Array(TaskId).check(Schema.isUnique()),
  target: TrackerTarget
})

/** The lifecycle returned for every named task subject. */
export const TaskLifecyclesObserved = Schema.TaggedStruct("TaskLifecycles", {
  ...completeFactEvidenceFields,
  coverage: CompleteTargetClosureCoverage,
  ...exactTaskSubjects,
  lifecycles: Schema.Array(Schema.Struct({ lifecycle: TaskLifecycle, taskId: TaskId }))
})

/** The complete prerequisite set returned for every named task subject. */
export const TaskPrerequisitesObserved = Schema.TaggedStruct("TaskPrerequisites", {
  ...completeFactEvidenceFields,
  coverage: CompleteTargetClosureCoverage,
  ...exactTaskSubjects,
  prerequisites: Schema.Array(
    Schema.Struct({ prerequisiteTaskIds: Schema.Array(TaskId).check(Schema.isUnique()), taskId: TaskId })
  )
})

/** The exact parent grouping fact returned for every named task subject. */
export const TaskGroupingsObserved = Schema.TaggedStruct("TaskGroupings", {
  ...completeFactEvidenceFields,
  coverage: CompleteTargetClosureCoverage,
  ...exactTaskSubjects,
  groupings: Schema.Array(Schema.Struct({ parentTaskId: Schema.NullOr(TaskId), taskId: TaskId }))
})

/** The complete task membership returned for one task-tracker target closure. */
export const TaskTargetMembershipObserved = Schema.TaggedStruct("TaskTargetMembership", {
  ...completeFactEvidenceFields,
  coverage: CompleteTargetClosureCoverage,
  memberTaskIds: Schema.Array(TaskId).check(Schema.isUnique()),
  target: TrackerTarget
})

const CompleteTaskGraphFactFamilies = Schema.Tuple([
  TaskIdentitiesObserved,
  TaskLifecyclesObserved,
  TaskPrerequisitesObserved,
  TaskGroupingsObserved,
  TaskTargetMembershipObserved
])

const completeFactFamilySubjectsDiffer = (factFamilies: typeof CompleteTaskGraphFactFamilies.Type): boolean => {
  const [identities, lifecycles, prerequisites, groupings, membership] = factFamilies
  const expectedTaskIds = exactTaskIdSetKey(identities.taskIds)
  const rowTaskIds = [
    lifecycles.lifecycles.map(({ taskId }) => taskId),
    prerequisites.prerequisites.map(({ taskId }) => taskId),
    groupings.groupings.map(({ taskId }) => taskId)
  ]
  return (
    exactTaskIdSetKey(lifecycles.subjectTaskIds) !== expectedTaskIds ||
    exactTaskIdSetKey(prerequisites.subjectTaskIds) !== expectedTaskIds ||
    exactTaskIdSetKey(groupings.subjectTaskIds) !== expectedTaskIds ||
    exactTaskIdSetKey(membership.memberTaskIds) !== expectedTaskIds ||
    rowTaskIds.some(
      (taskIds) => taskIds.length !== identities.taskIds.length || exactTaskIdSetKey(taskIds) !== expectedTaskIds
    )
  )
}

const invalidCompleteCoverage = (
  observation: { readonly factFamilies: typeof CompleteTaskGraphFactFamilies.Type; readonly target: TrackerTarget },
  identities: typeof TaskIdentitiesObserved.Type,
  membership: typeof TaskTargetMembershipObserved.Type
): string | undefined => {
  if (!factFamiliesCoverTarget(observation.factFamilies, observation.target)) {
    return "every graph fact family must declare complete coverage of the logical read target"
  }
  const coverageSubjects = observation.factFamilies.map(({ coverage }) =>
    exactTaskIdSetKey(coverage.explicitlyCoveredTaskIds)
  )
  if (coverageSubjects.some((subjects) => subjects !== coverageSubjects[0])) {
    return "every graph fact family must declare the same explicitly requested task subjects"
  }
  if (
    taskTrackerTargetKey(identities.target) !== taskTrackerTargetKey(observation.target) ||
    taskTrackerTargetKey(membership.target) !== taskTrackerTargetKey(observation.target)
  ) {
    return "identity and membership facts must cover the logical read target"
  }
  return undefined
}

const invalidCompleteTaskGraphFacts = (observation: {
  readonly factFamilies: typeof CompleteTaskGraphFactFamilies.Type
  readonly operationId: OperationId
  readonly target: TrackerTarget
}) => {
  const [identities, , prerequisites, , membership] = observation.factFamilies
  if (completeFactFamilySubjectsDiffer(observation.factFamilies)) {
    return "every complete graph fact family must cover the same task subjects exactly once"
  }
  const operationIds = observation.factFamilies.map(({ freshness }) => freshness.operationId)
  if (operationIds.some((operationId) => operationId !== observation.operationId)) {
    return "every fact family freshness must name the logical read operation"
  }
  const contentIdentities = observation.factFamilies.map(({ contentIdentity }) => contentIdentity)
  if (contentIdentities.some((contentIdentity) => contentIdentity !== contentIdentities[0])) {
    return "one logical graph read must carry one normalized content identity"
  }
  const coverageIssue = invalidCompleteCoverage(observation, identities, membership)
  if (coverageIssue !== undefined) return coverageIssue
  const knownTaskIds = new Set(identities.taskIds)
  if (
    prerequisites.prerequisites.some(({ prerequisiteTaskIds }) =>
      prerequisiteTaskIds.some((taskId) => !knownTaskIds.has(taskId))
    )
  ) {
    return "every prerequisite endpoint must belong to the complete observed graph"
  }
  return undefined
}

/** One provider-neutral logical graph read retaining every scheduling fact family. */
export const CompleteTaskTrackerFactsObserved = Schema.TaggedStruct("CompleteTaskTrackerFacts", {
  factFamilies: CompleteTaskGraphFactFamilies,
  operationId: OperationId,
  target: TrackerTarget
}).check(Schema.makeFilter(invalidCompleteTaskGraphFacts))
export type CompleteTaskTrackerFactsObserved = typeof CompleteTaskTrackerFactsObserved.Type

export const TaskIdentitiesReconfirmed = Schema.TaggedStruct("TaskIdentitiesReconfirmed", {
  ...completeFactEvidenceFields,
  coverage: CompleteTargetClosureCoverage,
  target: TrackerTarget
})

export const TaskLifecyclesReconfirmed = Schema.TaggedStruct("TaskLifecyclesReconfirmed", {
  ...completeFactEvidenceFields,
  coverage: CompleteTargetClosureCoverage,
  ...exactTaskSubjects
})

export const TaskPrerequisitesReconfirmed = Schema.TaggedStruct("TaskPrerequisitesReconfirmed", {
  ...completeFactEvidenceFields,
  coverage: CompleteTargetClosureCoverage,
  ...exactTaskSubjects
})

export const TaskGroupingsReconfirmed = Schema.TaggedStruct("TaskGroupingsReconfirmed", {
  ...completeFactEvidenceFields,
  coverage: CompleteTargetClosureCoverage,
  ...exactTaskSubjects
})

export const TaskTargetMembershipReconfirmed = Schema.TaggedStruct("TaskTargetMembershipReconfirmed", {
  ...completeFactEvidenceFields,
  coverage: CompleteTargetClosureCoverage,
  target: TrackerTarget
})

const ReconfirmedTaskGraphFactFamilies = Schema.Tuple([
  TaskIdentitiesReconfirmed,
  TaskLifecyclesReconfirmed,
  TaskPrerequisitesReconfirmed,
  TaskGroupingsReconfirmed,
  TaskTargetMembershipReconfirmed
])

const reconfirmedFactFamilySubjectsDiffer = (factFamilies: typeof ReconfirmedTaskGraphFactFamilies.Type): boolean => {
  const [, lifecycles, prerequisites, groupings] = factFamilies
  const subjectKey = exactTaskIdSetKey(lifecycles.subjectTaskIds)
  return (
    exactTaskIdSetKey(prerequisites.subjectTaskIds) !== subjectKey ||
    exactTaskIdSetKey(groupings.subjectTaskIds) !== subjectKey
  )
}

const invalidReconfirmedCoverage = (reconfirmation: {
  readonly factFamilies: typeof ReconfirmedTaskGraphFactFamilies.Type
  readonly target: TrackerTarget
}): string | undefined => {
  if (!factFamiliesCoverTarget(reconfirmation.factFamilies, reconfirmation.target)) {
    return "every reconfirmed fact family must declare complete coverage of the logical read target"
  }
  const coverageSubjects = reconfirmation.factFamilies.map(({ coverage }) =>
    exactTaskIdSetKey(coverage.explicitlyCoveredTaskIds)
  )
  if (coverageSubjects.some((subjects) => subjects !== coverageSubjects[0])) {
    return "every reconfirmed fact family must declare the same explicitly requested task subjects"
  }
  const [identities, , , , membership] = reconfirmation.factFamilies
  return taskTrackerTargetKey(identities.target) === taskTrackerTargetKey(reconfirmation.target) &&
    taskTrackerTargetKey(membership.target) === taskTrackerTargetKey(reconfirmation.target)
    ? undefined
    : "reconfirmed identity and membership facts must cover the logical read target"
}

/** A later comparable read reconfirmed one earlier full payload unchanged. */
export const UnchangedTaskTrackerFactsReconfirmed = Schema.TaggedStruct("UnchangedTaskTrackerFactsReconfirmed", {
  factFamilies: ReconfirmedTaskGraphFactFamilies,
  operationId: OperationId,
  priorFullObservationOperationId: OperationId,
  target: TrackerTarget
}).check(
  Schema.makeFilter((reconfirmation) => {
    if (reconfirmation.operationId === reconfirmation.priorFullObservationOperationId) {
      return "an unchanged reconfirmation must reference an earlier full observation"
    }
    if (reconfirmation.factFamilies.some(({ freshness }) => freshness.operationId !== reconfirmation.operationId)) {
      return "every reconfirmed fact family freshness must name the later logical read"
    }
    const contentIdentities = reconfirmation.factFamilies.map(({ contentIdentity }) => contentIdentity)
    if (contentIdentities.some((contentIdentity) => contentIdentity !== contentIdentities[0])) {
      return "one unchanged logical read must carry one normalized content identity"
    }
    const coverageIssue = invalidReconfirmedCoverage(reconfirmation)
    if (coverageIssue !== undefined) return coverageIssue
    if (reconfirmedFactFamilySubjectsDiffer(reconfirmation.factFamilies)) {
      return "every reconfirmed graph fact family must name the same task subjects"
    }
    return undefined
  })
)
export type UnchangedTaskTrackerFactsReconfirmed = typeof UnchangedTaskTrackerFactsReconfirmed.Type

const TaskWorkSpecificationObserved = Schema.TaggedStruct("TaskWorkSpecification", {
  body: Schema.String,
  completeness: Schema.Literal("Complete"),
  consistency: Schema.Literal("PotentiallyMixedTime"),
  contentIdentity: TaskRevision,
  coverage: ExactTaskWorkSpecificationCoverage,
  fingerprint: TaskRevision,
  freshness: Schema.TaggedStruct("ObservedDuringLogicalRead", { operationId: OperationId }),
  taskId: TaskId,
  title: Schema.NonEmptyString
}).check(
  Schema.makeFilter((fact) =>
    fact.contentIdentity === fact.fingerprint
      ? undefined
      : "task-work specification content identity must be its exact authored-content fingerprint"
  )
)

/** One focused pre-attempt read containing exact normalized authored instructions. */
export const FocusedTaskWorkSpecificationFactsObserved = Schema.TaggedStruct("FocusedTaskWorkSpecificationFacts", {
  factFamily: TaskWorkSpecificationObserved,
  operationId: OperationId,
  target: TrackerTarget
}).check(
  Schema.makeFilter((observation) =>
    observation.factFamily.freshness.operationId !== observation.operationId
      ? "focused task-work freshness must name the logical read operation"
      : observation.factFamily.coverage.taskId !== observation.factFamily.taskId
        ? "focused task-work coverage must name the exact authored-content subject"
        : undefined
  )
)
export type FocusedTaskWorkSpecificationFactsObserved = typeof FocusedTaskWorkSpecificationFactsObserved.Type

/** One bounded logical read established the tracker's current exact claim fact. */
export const FocusedTaskClaimFactsObserved = Schema.TaggedStruct("FocusedTaskClaimFacts", {
  completeness: Schema.Literal("Complete"),
  consistency: Schema.Literal("Atomic"),
  coverage: ExactTaskClaimCoverage,
  freshness: Schema.TaggedStruct("ObservedDuringLogicalRead", { operationId: OperationId }),
  observation: TaskClaimObservation,
  operationId: OperationId,
  target: TrackerTarget
}).check(
  Schema.makeFilter((facts) =>
    facts.freshness.operationId !== facts.operationId || facts.coverage.taskId !== facts.observation.taskId
      ? "focused claim coverage and freshness must name the exact logical read and task"
      : undefined
  )
)
export type FocusedTaskClaimFactsObserved = typeof FocusedTaskClaimFactsObserved.Type

/** Three reads could not establish any current claim fact for the exact task. */
export const FocusedTaskClaimFactsUnreadable = Schema.TaggedStruct("FocusedTaskClaimFactsUnreadable", {
  attempts: Schema.Literal(taskClaimObservationAttemptBound),
  completeness: Schema.Literal("Unreadable"),
  coverage: ExactTaskClaimCoverage,
  operationId: OperationId,
  target: TrackerTarget
})
export type FocusedTaskClaimFactsUnreadable = typeof FocusedTaskClaimFactsUnreadable.Type

export const TaskTrackerFactsObservation = Schema.Union([
  CompleteTaskTrackerFactsObserved,
  UnchangedTaskTrackerFactsReconfirmed,
  FocusedTaskWorkSpecificationFactsObserved,
  FocusedTaskClaimFactsObserved,
  FocusedTaskClaimFactsUnreadable,
  FocusedTaskCompletionFactsObserved,
  TaskTrackerFactsReadFailed
])
export type TaskTrackerFactsObservation = typeof TaskTrackerFactsObservation.Type

/** The canonical task-tracker observation event. */
export const TaskTrackerFactsObservedEvent = Schema.TaggedStruct("TaskTrackerFactsObserved", {
  observation: TaskTrackerFactsObservation,
  operationId: OperationId,
  version: Schema.Literal(workflowJournalEventVersion)
}).check(
  Schema.makeFilter((event) =>
    event.operationId === event.observation.operationId
      ? undefined
      : "task-tracker observation must name its initiating read operation"
  )
)
export type TaskTrackerFactsObservedEvent = typeof TaskTrackerFactsObservedEvent.Type

const sortedTaskIds = (taskIds: ReadonlyArray<TaskId>): ReadonlyArray<TaskId> => [...taskIds].sort()

const evidenceFor = (operationId: OperationId, contentIdentity: TrackerRevision) => ({
  completeness: "Complete" as const,
  consistency: "PotentiallyMixedTime" as const,
  contentIdentity,
  freshness: { _tag: "ObservedDuringLogicalRead" as const, operationId }
})

const completeTargetClosureCoverage = (operation: typeof WorkflowOperation.cases.ReadTrackerGraph.Type) =>
  CompleteTargetClosureCoverage.make({
    explicitlyCoveredTaskIds: operation.readShape.explicitlyCoveredTaskIds,
    target: operation.target
  })

/** Normalizes one complete provider-neutral graph result into durable fact families. */
export const makeCompleteTaskTrackerFactsObserved = (
  operation: typeof WorkflowOperation.cases.ReadTrackerGraph.Type,
  snapshot: TaskDagSnapshot
): CompleteTaskTrackerFactsObserved => {
  const tasks = snapshot.toWire().tasks
  const taskIds = sortedTaskIds(tasks.map(({ id }) => id))
  const evidence = evidenceFor(operation.operationId, snapshot.revision)
  const coverage = completeTargetClosureCoverage(operation)
  return CompleteTaskTrackerFactsObserved.make({
    factFamilies: [
      TaskIdentitiesObserved.make({ ...evidence, coverage, target: operation.target, taskIds }),
      TaskLifecyclesObserved.make({
        ...evidence,
        coverage,
        lifecycles: tasks.map(({ id, lifecycle }) => ({ lifecycle, taskId: id })),
        subjectTaskIds: taskIds
      }),
      TaskPrerequisitesObserved.make({
        ...evidence,
        coverage,
        prerequisites: tasks.map(({ id, prerequisiteIds }) => ({
          prerequisiteTaskIds: sortedTaskIds(prerequisiteIds),
          taskId: id
        })),
        subjectTaskIds: taskIds
      }),
      TaskGroupingsObserved.make({
        ...evidence,
        coverage,
        groupings: tasks.map(({ id, parentTaskId }) => ({ parentTaskId, taskId: id })),
        subjectTaskIds: taskIds
      }),
      TaskTargetMembershipObserved.make({ ...evidence, coverage, memberTaskIds: taskIds, target: operation.target })
    ],
    operationId: operation.operationId,
    target: operation.target
  })
}

export const taskTrackerFactsObservedEvent = (
  operationId: OperationId,
  observation: TaskTrackerFactsObservation
): TaskTrackerFactsObservedEvent =>
  TaskTrackerFactsObservedEvent.make({ observation, operationId, version: workflowJournalEventVersion })

export const makeFocusedTaskWorkSpecificationFactsObserved = (
  operation: typeof WorkflowOperation.cases.ReadTaskWorkSpecification.Type,
  specification: TaskWorkSpecification
): FocusedTaskWorkSpecificationFactsObserved =>
  FocusedTaskWorkSpecificationFactsObserved.make({
    factFamily: TaskWorkSpecificationObserved.make({
      body: specification.body,
      completeness: "Complete",
      consistency: "PotentiallyMixedTime",
      contentIdentity: specification.fingerprint,
      coverage: ExactTaskWorkSpecificationCoverage.make({ taskId: specification.taskId }),
      fingerprint: specification.fingerprint,
      freshness: { _tag: "ObservedDuringLogicalRead", operationId: operation.operationId },
      taskId: specification.taskId,
      title: specification.title
    }),
    operationId: operation.operationId,
    target: operation.target
  })

export const makeFocusedTaskClaimFactsObserved = (
  operation: typeof WorkflowOperation.cases.ReadTaskClaim.Type,
  observation: TaskClaimObservation
): FocusedTaskClaimFactsObserved =>
  FocusedTaskClaimFactsObserved.make({
    completeness: "Complete",
    consistency: "Atomic",
    coverage: ExactTaskClaimCoverage.make({ taskId: operation.taskId }),
    freshness: { _tag: "ObservedDuringLogicalRead", operationId: operation.operationId },
    observation,
    operationId: operation.operationId,
    target: operation.target
  })

export const makeFocusedTaskClaimFactsUnreadable = (
  operation: typeof WorkflowOperation.cases.ReadTaskClaim.Type
): FocusedTaskClaimFactsUnreadable =>
  FocusedTaskClaimFactsUnreadable.make({
    attempts: 3,
    completeness: "Unreadable",
    coverage: ExactTaskClaimCoverage.make({ taskId: operation.taskId }),
    operationId: operation.operationId,
    target: operation.target
  })
