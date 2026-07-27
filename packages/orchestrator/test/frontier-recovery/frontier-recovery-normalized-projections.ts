import { Effect } from "effect"
import type { ClaimOwner, ClaimToken, OperationId, TaskId, TrackerRevision } from "../../src/domain.js"
import { intentRecordKey, type JournalRecord, outcomeRecordKey } from "../../src/journal-store.js"
import type {
  BestAvailableDurableGraphKnowledge,
  TaskTrackerTargetClosureObservation,
  WorkflowResponsibilityState
} from "../../src/reconstructed-managed-run-state.js"
import {
  FrontierRecoveryConformanceIssue,
  FrontierRecoveryModelJournalPosition,
  type FrontierRecoveryModelOperationId,
  type FrontierRecoveryModelRevision,
  type FrontierRecoveryModelTaskId
} from "./frontier-recovery-conformance.js"
import { frontierRecoveryClaimOwner, frontierRecoveryClaimTokenFor } from "./frontier-recovery-fixture-identities.js"
import type {
  FrontierRecoveryGraphKnowledgeProjection,
  FrontierRecoveryResponsibilityProjection,
  FrontierRecoveryWorkflowRecordProjection
} from "./frontier-recovery-projection.js"

interface ProjectionIdentityMapping {
  readonly operationToModel: (
    operationId: OperationId
  ) => Effect.Effect<FrontierRecoveryModelOperationId, FrontierRecoveryConformanceIssue>
  readonly revisionToModel: (
    revision: TrackerRevision
  ) => Effect.Effect<FrontierRecoveryModelRevision, FrontierRecoveryConformanceIssue>
  readonly taskToModel: (
    taskId: TaskId
  ) => Effect.Effect<FrontierRecoveryModelTaskId, FrontierRecoveryConformanceIssue>
}

const projectionIssue = (detail: string) =>
  new FrontierRecoveryConformanceIssue({
    detail,
    reason: "LossyProjection"
  })

const sorted = <Value extends bigint>(
  values: ReadonlyArray<Value>
): ReadonlyArray<Value> =>
  // eslint-disable-next-line no-magic-numbers -- Standard ascending comparator.
  values.toSorted((left, right) => left < right ? -1 : left > right ? 1 : 0)

const projectTasks = (
  taskIds: ReadonlyArray<TaskId>,
  mapping: ProjectionIdentityMapping
) =>
  Effect.forEach(taskIds, mapping.taskToModel).pipe(
    Effect.map(sorted)
  )

const projectOperations = (
  operationIds: ReadonlyArray<OperationId>,
  mapping: ProjectionIdentityMapping
) =>
  Effect.forEach(operationIds, mapping.operationToModel).pipe(
    Effect.map(sorted)
  )

const requireFixtureTarget = (
  target: unknown,
  expectedTarget: unknown
) =>
  JSON.stringify(target) === JSON.stringify(expectedTarget)
    ? Effect.succeed("FrontierRecoveryTargetClosure" as const)
    : Effect.fail(projectionIssue("M2 graph knowledge contains an unexpected target"))

const projectGraphObservation = Effect.fn(
  "FrontierRecoveryReconstruction.projectGraphObservation"
)(function*(
  observation: TaskTrackerTargetClosureObservation,
  expectedTarget: unknown,
  mapping: ProjectionIdentityMapping
) {
  const target = yield* requireFixtureTarget(observation.target, expectedTarget)
  return {
    completeness: observation.completeness,
    consistency: observation.consistency,
    explicitlyCoveredModelTaskIds: yield* projectTasks(
      observation.explicitlyCoveredTaskIds,
      mapping
    ),
    factFamily: observation.factFamilies[0],
    freshness: observation.freshness,
    modelObservedAt: FrontierRecoveryModelJournalPosition.make(
      BigInt(observation.observedAt)
    ),
    modelOperationId: yield* mapping.operationToModel(
      observation.operationId
    ),
    modelRevision: yield* mapping.revisionToModel(observation.revision),
    provenAbsentModelTaskIds: yield* projectTasks(
      observation.provenAbsentTaskIds,
      mapping
    ),
    returnedModelTaskIds: yield* projectTasks(observation.taskIds, mapping),
    target
  }
})

export const projectFrontierRecoveryGraphKnowledge = Effect.fn(
  "FrontierRecoveryReconstruction.projectGraphKnowledge"
)(function*(
  graphKnowledge: BestAvailableDurableGraphKnowledge,
  expectedTarget: unknown,
  mapping: ProjectionIdentityMapping
) {
  const targetClosure = graphKnowledge.targetClosures[0]
  if (
    targetClosure === undefined
    || graphKnowledge.targetClosures.length !== 1
  ) {
    return yield* projectionIssue(
      "M2 graph knowledge requires exactly one target closure"
    )
  }
  return targetClosure._tag === "TaskTrackerTargetClosureObserved"
    ? {
      _tag: "TargetClosureObserved" as const,
      observation: yield* projectGraphObservation(
        targetClosure,
        expectedTarget,
        mapping
      )
    }
    : {
      _tag: "TargetClosureConflict" as const,
      observations: yield* Effect.forEach(
        targetClosure.observations,
        (observation) => projectGraphObservation(observation, expectedTarget, mapping)
      )
    } satisfies FrontierRecoveryGraphKnowledgeProjection
})

const projectClaimIdentity = Effect.fn(
  "FrontierRecoveryReconstruction.projectClaimIdentity"
)(function*(
  acquisition: {
    readonly operationId: OperationId
    readonly owner: typeof ClaimOwner.Type
    readonly taskId: TaskId
    readonly token: typeof ClaimToken.Type
  },
  mapping: ProjectionIdentityMapping
) {
  const modelTaskId = yield* mapping.taskToModel(acquisition.taskId)
  if (
    acquisition.owner !== frontierRecoveryClaimOwner
    || acquisition.token
      !== frontierRecoveryClaimTokenFor(modelTaskId)
  ) {
    return yield* projectionIssue(
      `M2 claim identity differs for task ${modelTaskId}`
    )
  }
  return {
    modelOperationId: yield* mapping.operationToModel(
      acquisition.operationId
    ),
    modelTaskId,
    owner: "FrontierRecoveryClaimOwner" as const,
    token: { modelTaskId }
  }
})

export const projectFrontierRecoveryWorkflowHistory = Effect.fn(
  "FrontierRecoveryReconstruction.projectWorkflowHistory"
)(function*(
  records: ReadonlyArray<JournalRecord>,
  mapping: ProjectionIdentityMapping
) {
  const projected: ReadonlyArray<FrontierRecoveryWorkflowRecordProjection> = yield* Effect.forEach(
    records,
    (record) =>
      Effect.gen(function*() {
        const modelPosition = FrontierRecoveryModelJournalPosition.make(
          BigInt(record.position)
        )
        if (record.event._tag === "TrackerGraphObservationIntentRecorded") {
          const operation = record.event.operation
          if (record.key !== intentRecordKey(operation.operationId)) {
            return yield* projectionIssue(
              `M2 graph intent has an unexpected record key at ${record.position}`
            )
          }
          return {
            _tag: "GraphObservationIntent" as const,
            explicitlyCoveredModelTaskIds: yield* projectTasks(
              operation.readShape.explicitlyCoveredTaskIds,
              mapping
            ),
            modelOperationId: yield* mapping.operationToModel(
              operation.operationId
            ),
            modelPosition,
            modelPredecessorOperationIds: yield* projectOperations(
              operation.predecessorOperationIds,
              mapping
            )
          }
        }
        if (record.event._tag === "TrackerGraphOutcomeObserved") {
          if (record.key !== outcomeRecordKey(record.event.operationId)) {
            return yield* projectionIssue(
              `M2 graph outcome has an unexpected record key at ${record.position}`
            )
          }
          return {
            _tag: "GraphOutcome" as const,
            modelOperationId: yield* mapping.operationToModel(
              record.event.operationId
            ),
            modelPosition,
            modelRevision: yield* mapping.revisionToModel(
              record.event.outcome.revision
            ),
            returnedModelTaskIds: yield* projectTasks(
              record.event.outcome.taskIds,
              mapping
            )
          }
        }
        if (record.event._tag === "TaskClaimAcquisitionIntended") {
          const operation = record.event.operation
          if (record.key !== intentRecordKey(operation.acquisition.operationId)) {
            return yield* projectionIssue(
              `M2 claim intent has an unexpected record key at ${record.position}`
            )
          }
          return {
            _tag: "ClaimIntent" as const,
            ...yield* projectClaimIdentity(operation.acquisition, mapping),
            modelPosition,
            modelPredecessorOperationIds: yield* projectOperations(
              operation.predecessorOperationIds,
              mapping
            )
          }
        }
        return yield* projectionIssue(
          `M2 workflow history contains unsupported event ${record.event._tag}`
        )
      })
  )
  return projected
})

export const projectFrontierRecoveryResponsibility = Effect.fn(
  "FrontierRecoveryReconstruction.projectResponsibility"
)(function*(
  responsibility: WorkflowResponsibilityState,
  mapping: ProjectionIdentityMapping
) {
  const projected: ReadonlyArray<FrontierRecoveryResponsibilityProjection> = yield* Effect.forEach(
    responsibility.entries,
    (entry) =>
      Effect.gen(function*() {
        if (entry._tag !== "TaskClaimResponsibility") {
          return yield* projectionIssue(
            `M2 responsibility contains unsupported entry ${entry._tag}`
          )
        }
        const claim = yield* projectClaimIdentity(entry.acquisition, mapping)
        const entryTask = yield* mapping.taskToModel(entry.taskId)
        if (entryTask !== claim.modelTaskId) {
          return yield* projectionIssue(
            `M2 responsibility task differs from its acquisition ${entryTask}`
          )
        }
        return {
          ...claim,
          beganAt: FrontierRecoveryModelJournalPosition.make(
            BigInt(entry.beganAt)
          )
        }
      })
  )
  return projected
})

export const projectFrontierRecoveryExactManagedState = Effect.fn(
  "FrontierRecoveryReconstruction.projectExactManagedState"
)(function*(
  graphKnowledge: BestAvailableDurableGraphKnowledge,
  workflowHistory: ReadonlyArray<JournalRecord>,
  responsibility: WorkflowResponsibilityState,
  expectedTarget: unknown,
  mapping: ProjectionIdentityMapping
) {
  return {
    graphKnowledgeProjection: yield* projectFrontierRecoveryGraphKnowledge(
      graphKnowledge,
      expectedTarget,
      mapping
    ),
    responsibilityProjection: yield* projectFrontierRecoveryResponsibility(
      responsibility,
      mapping
    ),
    workflowHistoryProjection: yield* projectFrontierRecoveryWorkflowHistory(
      workflowHistory,
      mapping
    )
  }
})
