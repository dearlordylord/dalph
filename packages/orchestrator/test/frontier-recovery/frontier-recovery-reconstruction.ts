import { Effect, Schema } from "effect"
import { ClaimOwner, ClaimToken, FixtureTarget, OperationId, RunId, TaskId, TrackerRevision } from "../../src/domain.js"
import { workflowJournalEventVersion } from "../../src/journal-event-version.js"
import {
  intentRecordKey,
  type JournalRecord,
  type JournalStoreService,
  outcomeRecordKey,
  TaskClaimAcquisitionIntendedEvent,
  trackerGraphObservationIntent,
  trackerGraphOutcomeObserved
} from "../../src/journal-store.js"
import { reduceManagedHistory } from "../../src/managed-history.js"
import type {
  BestAvailableDurableGraphKnowledge,
  ReconstructedPauseState,
  WorkflowResponsibilityState
} from "../../src/reconstructed-managed-run-state.js"
import { TaskClaimAcquisition } from "../../src/tracker-mutation.js"
import {
  makeTaskClaimAcquisitionOperation,
  makeTrackerGraphObservationOperation
} from "../../src/workflow-operation.js"
import {
  FrontierRecoveryConformanceIssue,
  makeFrontierRecoveryIdentityMapping,
  runFrontierRecoveryReconstructionAction,
  type TargetClosureObservationInput
} from "./frontier-recovery-conformance.js"

const runId = RunId.make("frontier-recovery-reconstruction-run")
const target = FixtureTarget.make("frontier-recovery-reconstruction-target")
const modelTaskA = 0n
const modelTaskB = 1n
const modelTaskC = 2n
const modelTaskD = 3n
const initialGraphOperationIdentity = 0n
const minimumRevisionIdentity = 0n
const firstClaimOperationIdentity = 1n
const provenAbsenceOperationIdentity = 2n
const conflictOperationIdentity = 3n
const replacementOperationIdentity = 4n
const taskEntries = [
  { branded: TaskId.make("frontier-recovery-task-A"), model: modelTaskA },
  { branded: TaskId.make("frontier-recovery-task-B"), model: modelTaskB },
  { branded: TaskId.make("frontier-recovery-task-C"), model: modelTaskC },
  { branded: TaskId.make("frontier-recovery-task-D"), model: modelTaskD }
] as const
const graphOperationId = OperationId.make("frontier-recovery-graph-observation-0")
const claimOperationId = OperationId.make("frontier-recovery-claim-operation-1")
const graphObservationEntries = [
  initialGraphOperationIdentity,
  provenAbsenceOperationIdentity,
  conflictOperationIdentity,
  replacementOperationIdentity
].map((model) => ({
  branded: OperationId.make(`frontier-recovery-graph-observation-${model}`),
  model
}))

interface MakeFrontierRecoveryReconstructionControlsOptions {
  readonly coordinatorRunning: boolean
  readonly journal: JournalStoreService
}

/** The conformance harness cannot safely continue from this reconstructed prefix. */
export class FrontierRecoveryReconstructionIssue extends Schema.TaggedErrorClass<FrontierRecoveryReconstructionIssue>()(
  "FrontierRecoveryReconstructionIssue",
  {
    detail: Schema.String,
    reason: Schema.Literals(["CoordinatorStopped", "InvalidManagedHistory"])
  }
) {}

export interface FrontierRecoveryReconstructionProjection {
  readonly coordinatorRunning: boolean
  readonly graphProfile:
    | "CompatibleReplacement"
    | "IncomparableMembership"
    | "ProvenAbsence"
    | undefined
  readonly graphKnowledge: BestAvailableDurableGraphKnowledge
  readonly knownModelTaskIds: ReadonlyArray<bigint>
  readonly pause: ReconstructedPauseState
  readonly responsibility: WorkflowResponsibilityState
  readonly responsibleModelTaskIds: ReadonlyArray<bigint>
  readonly workflowHistory: ReadonlyArray<JournalRecord>
  readonly workflowEventTags: ReadonlyArray<string>
}

const reconstructionIssue = (
  reason: FrontierRecoveryReconstructionIssue["reason"],
  detail: string
) => new FrontierRecoveryReconstructionIssue({ detail, reason })

/**
 * Deterministic public controls for the M2 slice before runnable-frontier
 * derivation. Durable state is always read back through the production journal
 * service and production managed-run reducer.
 */
export const makeFrontierRecoveryReconstructionControls = Effect.fn(
  "FrontierRecoveryReconstruction.makeControls"
)(function*(options: MakeFrontierRecoveryReconstructionControlsOptions) {
  const identityMapping = yield* makeFrontierRecoveryIdentityMapping({
    operations: [
      ...graphObservationEntries,
      { branded: claimOperationId, model: firstClaimOperationIdentity }
    ],
    tasks: taskEntries
  })
  let coordinatorRunning = options.coordinatorRunning

  const appendTargetClosureObservation = Effect.fn(
    "FrontierRecoveryReconstruction.appendTargetClosureObservation"
  )(function*(input: TargetClosureObservationInput) {
    if (!coordinatorRunning) {
      return yield* reconstructionIssue(
        "CoordinatorStopped",
        "a stopped coordinator cannot record a tracker graph observation"
      )
    }
    if (
      new Set(input.tasks).size !== input.tasks.length
      || new Set(input.explicitlyCoveredTasks).size
        !== input.explicitlyCoveredTasks.length
      || new Set(input.predecessorOperations).size
        !== input.predecessorOperations.length
      || input.revision < minimumRevisionIdentity
    ) {
      return yield* new FrontierRecoveryConformanceIssue({
        detail: "M2 target-closure observations require unique identities and a non-negative revision",
        reason: "LossyProjection"
      })
    }
    const operationId = yield* identityMapping.operationFromModel(input.operation)
    const predecessorOperationIds = yield* Effect.forEach(
      input.predecessorOperations,
      identityMapping.operationFromModel
    )
    const explicitlyCoveredTaskIds = yield* Effect.forEach(
      input.explicitlyCoveredTasks,
      identityMapping.taskFromModel
    )
    const taskIds = yield* Effect.forEach(input.tasks, identityMapping.taskFromModel)
    const operation = makeTrackerGraphObservationOperation(
      operationId,
      target,
      predecessorOperationIds,
      explicitlyCoveredTaskIds
    )
    yield* options.journal.append(
      runId,
      intentRecordKey(operation.operationId),
      trackerGraphObservationIntent(operation)
    )
    yield* options.journal.append(
      runId,
      outcomeRecordKey(operation.operationId),
      trackerGraphOutcomeObserved(operation.operationId, {
        _tag: "TrackerGraphObserved",
        revision: TrackerRevision.make(`frontier-recovery-revision-${input.revision}`),
        taskIds
      })
    )
  })

  const rawControls = {
    commitFirstIntent: (modelTaskId: bigint) =>
      Effect.gen(function*() {
        if (!coordinatorRunning) {
          return yield* reconstructionIssue(
            "CoordinatorStopped",
            "a stopped coordinator cannot record claim intent"
          )
        }
        if (modelTaskId !== modelTaskA) {
          return yield* new FrontierRecoveryConformanceIssue({
            detail: `M2 reconstruction has no first-claim operation mapping for task ${modelTaskId}`,
            reason: "MissingMapping"
          })
        }
        const taskId = yield* identityMapping.taskFromModel(modelTaskId)
        const operationId = yield* identityMapping.operationFromModel(
          firstClaimOperationIdentity
        )
        const acquisition = TaskClaimAcquisition.make({
          operationId,
          owner: ClaimOwner.make("frontier-recovery-owner"),
          taskId,
          token: ClaimToken.make(`frontier-recovery-token-${modelTaskId}`)
        })
        const operation = makeTaskClaimAcquisitionOperation({
          acquisition,
          predecessorOperationIds: [graphOperationId]
        })
        yield* options.journal.append(
          runId,
          intentRecordKey(operationId),
          TaskClaimAcquisitionIntendedEvent.make({
            operation,
            version: workflowJournalEventVersion
          })
        )
      }),
    crash: () =>
      Effect.sync(() => {
        coordinatorRunning = false
      }),
    init: () =>
      appendTargetClosureObservation({
        explicitlyCoveredTasks: [],
        operation: initialGraphOperationIdentity,
        predecessorOperations: [],
        revision: 0n,
        tasks: taskEntries.map(({ model }) => model)
      }),
    observeCompatibleReplacement: () =>
      appendTargetClosureObservation({
        explicitlyCoveredTasks: [],
        operation: provenAbsenceOperationIdentity,
        predecessorOperations: [],
        revision: firstClaimOperationIdentity,
        tasks: taskEntries.map(({ model }) => model)
      }),
    observeIncomparableMembership: () =>
      appendTargetClosureObservation({
        explicitlyCoveredTasks: [],
        operation: provenAbsenceOperationIdentity,
        predecessorOperations: [initialGraphOperationIdentity],
        revision: firstClaimOperationIdentity,
        tasks: [modelTaskA, modelTaskC, modelTaskD]
      }),
    observeProvenAbsence: () =>
      appendTargetClosureObservation({
        explicitlyCoveredTasks: [modelTaskB],
        operation: provenAbsenceOperationIdentity,
        predecessorOperations: [],
        revision: firstClaimOperationIdentity,
        tasks: [modelTaskA, modelTaskC, modelTaskD]
      }),
    observeTask: (modelTaskId: bigint) =>
      Effect.gen(function*() {
        yield* identityMapping.taskFromModel(modelTaskId)
        const records = yield* options.journal.read(runId)
        const observationCount = records.filter(
          ({ event }) => event._tag === "TrackerGraphOutcomeObserved"
        ).length
        yield* appendTargetClosureObservation({
          explicitlyCoveredTasks: [],
          operation: BigInt(observationCount + 1),
          predecessorOperations: [],
          revision: BigInt(observationCount),
          tasks: taskEntries.map(({ model }) => model)
        })
      }),
    reconstructionStep: () =>
      Effect.gen(function*() {
        yield* rawControls.commitFirstIntent(modelTaskA)
      }),
    restart: () =>
      Effect.sync(() => {
        coordinatorRunning = true
      })
  }

  const getState = Effect.fn("FrontierRecoveryReconstruction.getState")(
    function*() {
      const records = yield* options.journal.read(runId)
      const reduced = reduceManagedHistory(runId, records)
      if (reduced._tag === "InvalidManagedHistory") {
        return yield* reconstructionIssue(
          "InvalidManagedHistory",
          reduced.issues.map(({ detail }) => detail).join("; ")
        )
      }
      const knownTaskIds = reduced.managedRun.graphKnowledge.targetClosures
        .flatMap((knowledge) =>
          knowledge._tag === "TaskTrackerTargetClosureObserved"
            ? knowledge.taskIds
            : knowledge.observations.flatMap(({ taskIds }) => taskIds)
        )
      const responsibleTaskIds = reduced.managedRun.responsibility.entries
        .flatMap((entry) =>
          entry._tag === "TaskClaimResponsibility"
            ? [entry.acquisition.taskId]
            : []
        )
      const knownModelTaskIds = yield* Effect.forEach(
        [...new Set(knownTaskIds)].sort(),
        identityMapping.taskToModel
      )
      const responsibleModelTaskIds = yield* Effect.forEach(
        [...new Set(responsibleTaskIds)].sort(),
        identityMapping.taskToModel
      )
      const targetClosure = reduced.managedRun.graphKnowledge.targetClosures[0]
      const graphProfile = targetClosure
        ? targetClosure._tag === "TaskTrackerTargetClosureKnowledgeConflict"
          ? "IncomparableMembership" as const
          : targetClosure.operationId
              === OperationId.make("frontier-recovery-graph-observation-2")
          ? targetClosure.provenAbsentTaskIds.length > 0
            ? "ProvenAbsence" as const
            : "CompatibleReplacement" as const
          : undefined
        : undefined
      return {
        coordinatorRunning,
        graphKnowledge: reduced.managedRun.graphKnowledge,
        graphProfile,
        knownModelTaskIds,
        pause: reduced.managedRun.pause,
        responsibility: reduced.managedRun.responsibility,
        responsibleModelTaskIds,
        workflowHistory: reduced.managedRun.workflowHistory.records,
        workflowEventTags: reduced.managedRun.workflowHistory.records.map(
          ({ event }) => event._tag
        )
      } satisfies FrontierRecoveryReconstructionProjection
    }
  )

  return {
    commitFirstIntent: (task: bigint) =>
      runFrontierRecoveryReconstructionAction(
        { _tag: "commitFirstIntent", task },
        rawControls
      ),
    crash: () => runFrontierRecoveryReconstructionAction({ _tag: "crash" }, rawControls),
    getState,
    init: () => runFrontierRecoveryReconstructionAction({ _tag: "init" }, rawControls),
    observeCompatibleReplacement: () =>
      runFrontierRecoveryReconstructionAction(
        { _tag: "observeCompatibleReplacement" },
        rawControls
      ),
    observeIncomparableMembership: () =>
      runFrontierRecoveryReconstructionAction(
        { _tag: "observeIncomparableMembership" },
        rawControls
      ),
    observeProvenAbsence: () =>
      runFrontierRecoveryReconstructionAction(
        { _tag: "observeProvenAbsence" },
        rawControls
      ),
    observeTask: (task: bigint) =>
      runFrontierRecoveryReconstructionAction(
        { _tag: "observeTask", task },
        rawControls
      ),
    reconstructionStep: () =>
      runFrontierRecoveryReconstructionAction(
        { _tag: "reconstructionStep" },
        rawControls
      ),
    restart: () => runFrontierRecoveryReconstructionAction({ _tag: "restart" }, rawControls)
  } as const
})
