import { Option, Schema } from "effect"
import { type TaskDagSnapshot } from "../../../authorities/task-tracker/graph.js"
import { exactTaskIdSetKey, taskTrackerTargetKey } from "../../../authorities/task-tracker/target.js"
import {
  type CompleteTaskTrackerFactsObserved,
  CompleteTargetClosureCoverage,
  makeCompleteTaskTrackerFactsObserved,
  TaskGroupingsReconfirmed,
  TaskIdentitiesReconfirmed,
  TaskLifecyclesReconfirmed,
  TaskPrerequisitesReconfirmed,
  TaskTrackerFactsObservedEvent,
  taskTrackerFactsObservedEvent,
  TaskTargetMembershipReconfirmed,
  type UnchangedTaskTrackerFactsReconfirmed,
  UnchangedTaskTrackerFactsReconfirmed as UnchangedTaskTrackerFactsReconfirmedSchema
} from "../../task-tracker-facts/observation.js"
import { type WorkflowOperation } from "../../registry/operation.js"

const fullObservationFromEvent = (event: unknown): Option.Option<CompleteTaskTrackerFactsObserved> =>
  Option.flatMap(Schema.decodeUnknownOption(TaskTrackerFactsObservedEvent)(event), ({ observation }) =>
    observation._tag === "CompleteTaskTrackerFacts" ? Option.some(observation) : Option.none()
  )

const comparableFullObservation = (
  records: ReadonlyArray<{ readonly event: unknown }>,
  complete: CompleteTaskTrackerFactsObserved
): CompleteTaskTrackerFactsObserved | undefined =>
  records
    .flatMap(({ event }) => Option.toArray(fullObservationFromEvent(event)))
    .findLast(
      (prior) =>
        prior.operationId !== complete.operationId &&
        taskTrackerTargetKey(prior.target) === taskTrackerTargetKey(complete.target) &&
        exactTaskIdSetKey(prior.factFamilies[0].taskIds) === exactTaskIdSetKey(complete.factFamilies[0].taskIds)
    )

const makeUnchangedReconfirmation = (
  operation: typeof WorkflowOperation.cases.ReadTrackerGraph.Type,
  complete: CompleteTaskTrackerFactsObserved,
  prior: CompleteTaskTrackerFactsObserved
): UnchangedTaskTrackerFactsReconfirmed => {
  const [identities, lifecycles, prerequisites, groupings, membership] = complete.factFamilies
  const evidence = {
    completeness: "Complete" as const,
    consistency: "PotentiallyMixedTime" as const,
    contentIdentity: identities.contentIdentity,
    freshness: { _tag: "ObservedDuringLogicalRead" as const, operationId: operation.operationId }
  }
  const coverage = CompleteTargetClosureCoverage.make({
    explicitlyCoveredTaskIds: operation.readShape.explicitlyCoveredTaskIds,
    target: operation.target
  })
  return UnchangedTaskTrackerFactsReconfirmedSchema.make({
    factFamilies: [
      TaskIdentitiesReconfirmed.make({ ...evidence, coverage, target: identities.target }),
      TaskLifecyclesReconfirmed.make({ ...evidence, coverage, subjectTaskIds: lifecycles.subjectTaskIds }),
      TaskPrerequisitesReconfirmed.make({ ...evidence, coverage, subjectTaskIds: prerequisites.subjectTaskIds }),
      TaskGroupingsReconfirmed.make({ ...evidence, coverage, subjectTaskIds: groupings.subjectTaskIds }),
      TaskTargetMembershipReconfirmed.make({ ...evidence, coverage, target: membership.target })
    ],
    operationId: operation.operationId,
    priorFullObservationOperationId: prior.operationId,
    target: operation.target
  })
}

/** Chooses a complete payload or compact unchanged reconfirmation for one read. */
export const makeTaskTrackerFactsObservedFromRead = (
  records: ReadonlyArray<{ readonly event: unknown }>,
  operation: typeof WorkflowOperation.cases.ReadTrackerGraph.Type,
  snapshot: TaskDagSnapshot
): TaskTrackerFactsObservedEvent => {
  const complete = makeCompleteTaskTrackerFactsObserved(operation, snapshot)
  const prior = comparableFullObservation(records, complete)
  const unchanged =
    prior !== undefined && prior.factFamilies[0].contentIdentity === complete.factFamilies[0].contentIdentity
  return taskTrackerFactsObservedEvent(
    operation.operationId,
    unchanged ? makeUnchangedReconfirmation(operation, complete, prior) : complete
  )
}
