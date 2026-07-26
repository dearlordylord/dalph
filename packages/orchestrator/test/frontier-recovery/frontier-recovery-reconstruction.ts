import { Effect } from "effect"
import { ClaimOwner, ClaimToken, FixtureTarget, OperationId, RunId, TaskId, TrackerRevision } from "../../src/domain.js"
import { workflowJournalEventVersion } from "../../src/journal-event-version.js"
import {
  intentRecordKey,
  outcomeRecordKey,
  TaskClaimAcquisitionIntendedEvent,
  trackerGraphObservationIntent,
  trackerGraphOutcomeObserved
} from "../../src/journal-store.js"
import { reduceManagedHistory } from "../../src/managed-history.js"
import type { WorkflowResponsibilityState } from "../../src/reconstructed-managed-run-state.js"
import { TaskClaimAcquisition } from "../../src/tracker-mutation.js"
import {
  makeTaskClaimAcquisitionOperation,
  makeTrackerGraphObservationOperation
} from "../../src/workflow-operation.js"
import {
  FrontierRecoveryConformanceIssue,
  FrontierRecoveryModelOperationId,
  FrontierRecoveryModelRevision,
  FrontierRecoveryModelTaskId,
  makeFrontierRecoveryIdentityMapping,
  runFrontierRecoveryReconstructionAction,
  type TargetClosureObservationInput
} from "./frontier-recovery-conformance.js"
import type {
  FrontierRecoveryReconstructionProjection,
  MakeFrontierRecoveryReconstructionControlsOptions
} from "./frontier-recovery-projection.js"
import { FrontierRecoveryReconstructionIssue } from "./frontier-recovery-projection.js"
import { selectFrontierRecoveryAdmission } from "./frontier-recovery-selection.js"
export type {
  FrontierRecoveryReconstructionGraphEvidence,
  FrontierRecoveryReconstructionProjection
} from "./frontier-recovery-projection.js"

const runId = RunId.make("frontier-recovery-reconstruction-run")
const target = FixtureTarget.make("frontier-recovery-reconstruction-target")
/* eslint-disable no-magic-numbers -- Closed M2 identities are the versioned conformance manifest. */
const modelTaskA = FrontierRecoveryModelTaskId.make(0n)
const modelTaskB = FrontierRecoveryModelTaskId.make(1n)
const modelTaskC = FrontierRecoveryModelTaskId.make(2n)
const modelTaskD = FrontierRecoveryModelTaskId.make(3n)
const initialGraphOperationIdentity = FrontierRecoveryModelOperationId.make(0n)
const minimumRevisionIdentity = 0n
const firstClaimOperationIdentity = FrontierRecoveryModelOperationId.make(1n)
const targetClosureReplacementOperationIdentity = FrontierRecoveryModelOperationId.make(2n)
const secondClaimOperationIdentity = FrontierRecoveryModelOperationId.make(3n)
const initialModelRevision = FrontierRecoveryModelRevision.make(0n)
const replacementModelRevision = FrontierRecoveryModelRevision.make(1n)
/* eslint-enable no-magic-numbers */
const taskEntries = [
  { branded: TaskId.make("frontier-recovery-task-A"), model: modelTaskA },
  { branded: TaskId.make("frontier-recovery-task-B"), model: modelTaskB },
  { branded: TaskId.make("frontier-recovery-task-C"), model: modelTaskC },
  { branded: TaskId.make("frontier-recovery-task-D"), model: modelTaskD }
] as const
const graphOperationId = OperationId.make("frontier-recovery-graph-observation-0")
const claimOperationEntries = [
  {
    branded: OperationId.make("frontier-recovery-claim-operation-1"),
    model: firstClaimOperationIdentity
  },
  {
    branded: OperationId.make("frontier-recovery-claim-operation-3"),
    model: secondClaimOperationIdentity
  }
] as const
const graphObservationEntries = [
  initialGraphOperationIdentity,
  targetClosureReplacementOperationIdentity
].map((model) => ({
  branded: OperationId.make(`frontier-recovery-graph-observation-${model}`),
  model
}))

const reconstructionIssue = (
  reason: FrontierRecoveryReconstructionIssue["reason"],
  detail: string
) => new FrontierRecoveryReconstructionIssue({ detail, reason })

/**
 * Deterministic public controls for the M2 reconstructed-run and bounded
 * frontier slice. Durable state is always read back through the production
 * journal service and production managed-run reducer.
 */
export const makeFrontierRecoveryReconstructionControls = Effect.fn(
  "FrontierRecoveryReconstruction.makeControls"
)(function*(options: MakeFrontierRecoveryReconstructionControlsOptions) {
  const identityMapping = yield* makeFrontierRecoveryIdentityMapping({
    operations: [
      ...graphObservationEntries,
      ...claimOperationEntries
    ],
    tasks: taskEntries
  })
  let coordinatorRunning = options.coordinatorRunning

  const selectFrontier = Effect.fn(
    "FrontierRecoveryReconstruction.selectFrontier"
  )((responsibility: WorkflowResponsibilityState) =>
    selectFrontierRecoveryAdmission({
      capacity: options.capacity,
      eligibleModelTaskIds: options.freshEligibleModelTaskIds
        ?? [modelTaskA, modelTaskC],
      identityMapping,
      responsibility,
      taskEntries
    })
  )

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
    orchestratorCommitsFreshTaskClaimIntent: (modelTaskId: FrontierRecoveryModelTaskId) =>
      Effect.gen(function*() {
        if (!coordinatorRunning) {
          return yield* reconstructionIssue(
            "CoordinatorStopped",
            "a stopped coordinator cannot record claim intent"
          )
        }
        if (modelTaskId !== modelTaskA && modelTaskId !== modelTaskC) {
          return yield* new FrontierRecoveryConformanceIssue({
            detail: `M2 reconstruction has no first-claim operation mapping for task ${modelTaskId}`,
            reason: "MissingMapping"
          })
        }
        const taskId = yield* identityMapping.taskFromModel(modelTaskId)
        const operationId = yield* identityMapping.operationFromModel(
          modelTaskId === modelTaskA
            ? firstClaimOperationIdentity
            : secondClaimOperationIdentity
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
        revision: initialModelRevision,
        tasks: taskEntries.map(({ model }) => model)
      }),
    taskTrackerReportsCompatibleTargetClosureReplacement: () =>
      appendTargetClosureObservation({
        explicitlyCoveredTasks: [],
        operation: targetClosureReplacementOperationIdentity,
        predecessorOperations: [],
        revision: replacementModelRevision,
        tasks: taskEntries.map(({ model }) => model)
      }),
    taskTrackerReportsIncomparableTargetClosureMembership: () =>
      appendTargetClosureObservation({
        explicitlyCoveredTasks: [],
        operation: targetClosureReplacementOperationIdentity,
        predecessorOperations: [initialGraphOperationIdentity],
        revision: replacementModelRevision,
        tasks: [modelTaskA, modelTaskC, modelTaskD]
      }),
    taskTrackerReportsProvenAbsenceInTargetClosure: () =>
      appendTargetClosureObservation({
        explicitlyCoveredTasks: [modelTaskB],
        operation: targetClosureReplacementOperationIdentity,
        predecessorOperations: [],
        revision: replacementModelRevision,
        tasks: [modelTaskA, modelTaskC, modelTaskD]
      }),
    orchestratorCommitsNextFreshTaskClaimIntent: () =>
      Effect.gen(function*() {
        const records = yield* options.journal.read(runId)
        const reduced = reduceManagedHistory(runId, records)
        if (reduced._tag === "InvalidManagedHistory") {
          return yield* reconstructionIssue(
            "InvalidManagedHistory",
            reduced.issues.map(({ detail }) => detail).join("; ")
          )
        }
        const selection = yield* selectFrontier(
          reduced.managedRun.responsibility
        )
        const transition = selection.admission.transitions.find(
          ({ _tag }) => _tag === "CommitFreshTaskClaimIntent"
        )
        if (transition !== undefined) {
          yield* identityMapping.taskToModel(transition.taskId).pipe(
            Effect.flatMap(
              rawControls.orchestratorCommitsFreshTaskClaimIntent
            )
          )
        }
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
      const selection = yield* selectFrontier(
        reduced.managedRun.responsibility
      )
      const targetClosure = reduced.managedRun.graphKnowledge.targetClosures[0]
      const graphObservationProfile = targetClosure
        ? targetClosure._tag === "TaskTrackerTargetClosureKnowledgeConflict"
          ? "IncomparableMembership" as const
          : targetClosure.operationId
              === OperationId.make("frontier-recovery-graph-observation-2")
          ? targetClosure.provenAbsentTaskIds.length > 0
            ? "ProvenAbsence" as const
            : "CompatibleReplacement" as const
          : "InitialObservation" as const
        : "InitialObservation" as const
      const graphObservationIntents = records.filter(
        ({ event }) => event._tag === "TrackerGraphObservationIntentRecorded"
      )
      // Negative one is the standard Array.at locator for the latest intent.
      // eslint-disable-next-line no-magic-numbers
      const latestGraphIntent = graphObservationIntents.at(-1)?.event
      const latestGraphOutcome = latestGraphIntent?._tag
          === "TrackerGraphObservationIntentRecorded"
        ? records.findLast(({ event }) =>
          event._tag === "TrackerGraphOutcomeObserved"
          && event.operationId === latestGraphIntent.operation.operationId
        )?.event
        : undefined
      const returnedModelTaskIds = latestGraphOutcome?._tag
          === "TrackerGraphOutcomeObserved"
        ? yield* Effect.forEach(
          latestGraphOutcome.outcome.taskIds,
          identityMapping.taskToModel
        )
        : []
      const graphEvidence = latestGraphIntent?._tag
            === "TrackerGraphObservationIntentRecorded"
          && latestGraphOutcome?._tag === "TrackerGraphOutcomeObserved"
        ? {
          completeness: "Complete",
          consistency: "PotentiallyMixedTime",
          explicitlyCoveredModelTaskIds: yield* Effect.forEach(
            latestGraphIntent.operation.readShape.explicitlyCoveredTaskIds,
            identityMapping.taskToModel
          ),
          factFamily: "TargetMembership",
          freshness: "FreshAtReadBoundary",
          modelOperationId: yield* identityMapping.operationToModel(
            latestGraphIntent.operation.operationId
          ),
          modelPredecessorOperationIds: yield* Effect.forEach(
            latestGraphIntent.operation.predecessorOperationIds,
            identityMapping.operationToModel
          ),
          modelRevision: FrontierRecoveryModelRevision.make(
            // Negative one selects the final fixture revision component.
            // eslint-disable-next-line no-magic-numbers
            BigInt(latestGraphOutcome.outcome.revision.split("-").at(-1) ?? "")
          ),
          observationProfile: graphObservationProfile,
          readShape: "TargetClosureMembership",
          returnedModelTaskIds
        } as const
        : {
          completeness: "Complete",
          consistency: "PotentiallyMixedTime",
          explicitlyCoveredModelTaskIds: [],
          factFamily: "TargetMembership",
          freshness: "FreshAtReadBoundary",
          modelOperationId: initialGraphOperationIdentity,
          modelPredecessorOperationIds: [],
          modelRevision: initialModelRevision,
          observationProfile: "InitialObservation",
          readShape: "TargetClosureMembership",
          returnedModelTaskIds: taskEntries.map(({ model }) => model)
        } as const
      return {
        admissionCapacity: selection.admissionCapacity,
        admittedModelOperationIds: selection.admittedModelOperationIds,
        admittedModelTaskIds: selection.admittedModelTaskIds,
        admittedTransitionTags: selection.admittedTransitionTags,
        admissionExplanations: selection.admissionExplanations,
        admissionReservedModelTaskIds: selection.admissionReservedModelTaskIds,
        coordinatorRunning,
        frontierModelOperationIds: selection.frontierModelOperationIds,
        frontierModelTaskIds: selection.frontierModelTaskIds,
        frontierTransitionTags: selection.frontierTransitionTags,
        graphEvidence,
        graphKnowledge: reduced.managedRun.graphKnowledge,
        knownModelTaskIds,
        occupiedModelTaskIds: selection.occupiedModelTaskIds,
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
    orchestratorCommitsFreshTaskClaimIntent: (task: FrontierRecoveryModelTaskId) =>
      runFrontierRecoveryReconstructionAction(
        { _tag: "orchestratorCommitsFreshTaskClaimIntent", task },
        rawControls
      ),
    crash: () => runFrontierRecoveryReconstructionAction({ _tag: "crash" }, rawControls),
    getState,
    init: () => runFrontierRecoveryReconstructionAction({ _tag: "init" }, rawControls),
    taskTrackerReportsCompatibleTargetClosureReplacement: () =>
      runFrontierRecoveryReconstructionAction(
        { _tag: "taskTrackerReportsCompatibleTargetClosureReplacement" },
        rawControls
      ),
    taskTrackerReportsIncomparableTargetClosureMembership: () =>
      runFrontierRecoveryReconstructionAction(
        { _tag: "taskTrackerReportsIncomparableTargetClosureMembership" },
        rawControls
      ),
    taskTrackerReportsProvenAbsenceInTargetClosure: () =>
      runFrontierRecoveryReconstructionAction(
        { _tag: "taskTrackerReportsProvenAbsenceInTargetClosure" },
        rawControls
      ),
    orchestratorCommitsNextFreshTaskClaimIntent: () =>
      runFrontierRecoveryReconstructionAction(
        { _tag: "orchestratorCommitsNextFreshTaskClaimIntent" },
        rawControls
      ),
    restart: () => runFrontierRecoveryReconstructionAction({ _tag: "restart" }, rawControls)
  } as const
})
