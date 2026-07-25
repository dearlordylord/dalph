import { Effect } from "effect"
import { ClaimOwner, ClaimToken, FixtureTarget, OperationId, RunId, TaskId, TrackerRevision } from "../../src/domain.js"
import { workflowJournalEventVersion } from "../../src/journal-event-version.js"
import {
  intentRecordKey,
  type JournalStoreService,
  outcomeRecordKey,
  TaskClaimAcquisitionIntendedEvent,
  trackerGraphObservationIntent,
  trackerGraphOutcomeObserved
} from "../../src/journal-store.js"
import { reduceManagedHistory } from "../../src/managed-history.js"
import { TaskClaimAcquisition } from "../../src/tracker-mutation.js"
import {
  makeTaskClaimAcquisitionOperation,
  makeTrackerGraphObservationOperation
} from "../../src/workflow-operation.js"
import {
  FrontierRecoveryConformanceIssue,
  makeFrontierRecoveryIdentityMapping,
  runFrontierRecoveryReconstructionAction
} from "./frontier-recovery-conformance.js"

const runId = RunId.make("frontier-recovery-reconstruction-run")
const target = FixtureTarget.make("frontier-recovery-reconstruction-target")
const modelTaskA = 0n
const initialGraphOperationIdentity = 0n
const firstClaimOperationIdentity = 1n
const taskEntries = [
  { branded: TaskId.make("frontier-recovery-task-A"), model: modelTaskA },
  { branded: TaskId.make("frontier-recovery-task-B"), model: 1n },
  { branded: TaskId.make("frontier-recovery-task-C"), model: 2n },
  { branded: TaskId.make("frontier-recovery-task-D"), model: 3n }
] as const
const graphOperationId = OperationId.make("frontier-recovery-graph-observation-0")
const claimOperationId = OperationId.make("frontier-recovery-claim-operation-1")

interface MakeFrontierRecoveryReconstructionControlsOptions {
  readonly coordinatorRunning: boolean
  readonly journal: JournalStoreService
}

const invalidHistory = (detail: string) =>
  Effect.die(new Error(`M2 reconstruction controls produced invalid managed history: ${detail}`))

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
      { branded: graphOperationId, model: initialGraphOperationIdentity },
      { branded: claimOperationId, model: firstClaimOperationIdentity }
    ],
    tasks: taskEntries
  })
  let coordinatorRunning = options.coordinatorRunning

  const appendTargetClosureObservation = Effect.fn(
    "FrontierRecoveryReconstruction.appendTargetClosureObservation"
  )(function*() {
    const records = yield* options.journal.read(runId)
    const observationOrdinal = records.filter(
      ({ event }) => event._tag === "TrackerGraphOutcomeObserved"
    ).length
    const operationId = observationOrdinal === 0
      ? yield* identityMapping.operationFromModel(initialGraphOperationIdentity)
      : OperationId.make(`frontier-recovery-graph-observation-${observationOrdinal}`)
    const nextObservationOrdinal = observationOrdinal + 1
    const operation = makeTrackerGraphObservationOperation(
      operationId,
      target,
      [],
      taskEntries.map(({ branded }) => branded)
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
        revision: TrackerRevision.make(`frontier-recovery-revision-${nextObservationOrdinal}`),
        taskIds: taskEntries.map(({ branded }) => branded)
      })
    )
  })

  const rawControls = {
    commitFirstIntent: (modelTaskId: bigint) =>
      Effect.gen(function*() {
        if (!coordinatorRunning) {
          return yield* invalidHistory("a stopped coordinator cannot record claim intent")
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
    init: () => appendTargetClosureObservation(),
    observeTask: (modelTaskId: bigint) =>
      identityMapping.taskFromModel(modelTaskId).pipe(
        Effect.andThen(appendTargetClosureObservation)
      ),
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
        return yield* invalidHistory(
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
      return {
        coordinatorRunning,
        knownModelTaskIds,
        pause: reduced.managedRun.pause,
        responsibleModelTaskIds,
        workflowEventTags: reduced.managedRun.workflowHistory.records.map(
          ({ event }) => event._tag
        )
      }
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
