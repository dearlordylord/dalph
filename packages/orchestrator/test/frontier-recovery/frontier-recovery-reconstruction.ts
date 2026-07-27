/* eslint-disable max-lines -- This closed adapter keeps action execution and its journal projection together. */
import { Effect, Option } from "effect"
import { makeActivationOwnershipRegistry } from "../../src/activation-coordinator.js"
import { OperationId, ProviderObservationId, TaskRevision } from "../../src/domain.js"
import type { TaskId } from "../../src/domain.js"
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
import {
  deriveRunnableFrontier,
  ResponsibilityDisposition,
  type RunnableFrontier
} from "../../src/runnable-frontier.js"
import { makeSelectedTransitionIdentity, selectedTransitionKey } from "../../src/selected-transition.js"
import { makeTaskAdmissionController } from "../../src/task-admission-controller.js"
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
import type {
  FrontierRecoveryActivationAction,
  FrontierRecoveryModelTaskId,
  TargetClosureObservationInput
} from "./frontier-recovery-conformance.js"
import {
  firstClaimOperationIdentity,
  frontierRecoveryClaimOperationEntries as claimOperationEntries,
  frontierRecoveryClaimOwner,
  frontierRecoveryClaimTokenFor,
  frontierRecoveryGraphObservationEntries as graphObservationEntries,
  frontierRecoveryRunId as runId,
  frontierRecoveryTarget as target,
  frontierRecoveryTaskEntries as taskEntries,
  initialGraphOperationId as graphOperationId,
  initialGraphOperationIdentity,
  initialModelRevision,
  minimumModelRevision,
  modelRevisionFromTracker,
  modelTaskA,
  modelTaskB,
  modelTaskC,
  modelTaskD,
  replacementModelRevision,
  secondClaimOperationIdentity,
  targetClosureReplacementOperationIdentity,
  trackerRevisionFromModel
} from "./frontier-recovery-fixture-identities.js"
import { projectFrontierRecoveryExactManagedState } from "./frontier-recovery-normalized-projections.js"
import type {
  FrontierRecoveryReconstructionProjection,
  MakeFrontierRecoveryReconstructionControlsOptions
} from "./frontier-recovery-projection.js"
import { frontierRecoveryReconstructionIssue } from "./frontier-recovery-projection.js"
import { selectFrontierRecoveryAdmission } from "./frontier-recovery-selection.js"

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
  let activationController = yield* makeTaskAdmissionController({
    capacity: options.capacity,
    freshOccupiedInvocations: [],
    reconstructedReservedPositions: []
  })
  let activationOwnership = yield* makeActivationOwnershipRegistry(runId)
  let activationDerived: RunnableFrontier = {
    explanations: [],
    transitions: []
  }
  let activationSelected: RunnableFrontier = {
    explanations: [],
    transitions: []
  }
  let providerWorkers: ReadonlyMap<TaskId, OperationId> = new Map()
  let activationTriggerPending = true
  let freshlyObservedTaskIds: ReadonlySet<TaskId> = new Set()
  let postIntentExitedTaskIds: ReadonlySet<TaskId> = new Set()
  let preIntentInterruptedTaskIds: ReadonlySet<TaskId> = new Set()
  let resultsRecordedTaskIds: ReadonlySet<TaskId> = new Set()

  const deriveActivationFrontier = Effect.fn(
    "FrontierRecoveryReconstruction.deriveActivationFrontier"
  )(function*() {
    const reduced = reduceManagedHistory(
      runId,
      yield* options.journal.read(runId)
    )
    if (reduced._tag === "InvalidManagedHistory") {
      return yield* frontierRecoveryReconstructionIssue(
        "InvalidManagedHistory",
        reduced.issues.map(({ detail }) => detail).join("; ")
      )
    }
    return deriveRunnableFrontier({
      freshEligibleTasks: taskEntries
        .filter(({ model }) =>
          (options.freshEligibleModelTaskIds ?? [modelTaskA, modelTaskC])
            .includes(model)
        )
        .map(({ branded, model }) => ({
          taskId: branded,
          taskRevision: TaskRevision.make(`M2-revision:${model}`)
        })),
      responsibility: reduced.managedRun.responsibility,
      responsibilityFacts: reduced.managedRun.responsibility.entries.map(
        (responsibility) => ({
          disposition: ResponsibilityDisposition.Ready(),
          responsibility
        })
      )
    })
  })

  const activationTransitionFor = Effect.fn(
    "FrontierRecoveryReconstruction.activationTransitionFor"
  )(function*(modelTaskId: FrontierRecoveryModelTaskId) {
    const taskId = yield* identityMapping.taskFromModel(modelTaskId)
    const transition = activationDerived.transitions.find(
      (candidate) => candidate.taskId === taskId
    )
    return transition === undefined
      ? yield* new FrontierRecoveryConformanceIssue({
        detail: `M2 activation has no derived transition for task ${modelTaskId}`,
        reason: "MissingMapping"
      })
      : transition
  })

  const activationOperationFor = (
    modelTaskId: FrontierRecoveryModelTaskId
  ) =>
    identityMapping.operationFromModel(
      modelTaskId === modelTaskA
        ? firstClaimOperationIdentity
        : secondClaimOperationIdentity
    )

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
      return yield* frontierRecoveryReconstructionIssue(
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
      || input.revision < minimumModelRevision
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
        revision: yield* trackerRevisionFromModel(input.revision),
        taskIds
      })
    )
  })

  const runActivationAction = Effect.fn(
    "FrontierRecoveryReconstruction.runActivationAction"
  )(function*(action: FrontierRecoveryActivationAction) {
    const taskAction = "task" in action ? action : undefined
    const transition = taskAction === undefined
      ? undefined
      : yield* activationTransitionFor(taskAction.task)
    const selected = transition === undefined
      ? undefined
      : makeSelectedTransitionIdentity(runId, transition)

    switch (action._tag) {
      case "deriveActivationPass": {
        activationDerived = yield* deriveActivationFrontier()
        activationSelected = yield* activationOwnership.exclude(
          activationDerived
        )
        activationTriggerPending = false
        return
      }
      case "excludeOwnedTransitions": {
        activationSelected = yield* activationOwnership.exclude(
          activationDerived
        )
        activationTriggerPending = false
        return
      }
      case "reserveTaskAdmissionPosition": {
        if (transition === undefined) return
        yield* activationController.admit(
          {
            explanations: activationSelected.explanations,
            transitions: [transition]
          },
          runId
        )
        activationSelected = {
          ...activationSelected,
          transitions: activationSelected.transitions.filter(
            (candidate) => candidate !== transition
          )
        }
        postIntentExitedTaskIds = new Set(
          [...postIntentExitedTaskIds].filter((taskId) => taskId !== transition.taskId)
        )
        preIntentInterruptedTaskIds = new Set(
          [...preIntentInterruptedTaskIds].filter((taskId) => taskId !== transition.taskId)
        )
        return
      }
      case "claimActivationOwnership": {
        if (transition === undefined) return
        const registered = yield* activationOwnership.register(transition)
        if (registered !== undefined) {
          activationSelected = {
            ...activationSelected,
            transitions: activationSelected.transitions.filter(
              ({ taskId }) => taskId !== transition.taskId
            )
          }
        }
        return
      }
      case "rejectDuplicateOwnership": {
        if (transition === undefined) return
        const registered = yield* activationOwnership.register(transition)
        const snapshot = yield* activationOwnership.snapshot()
        const key = registered?.key
          ?? [...snapshot.owners]
            .find(([, entry]) => entry.transition.taskId === transition.taskId)?.[0]
        if (key !== undefined) yield* activationOwnership.isolate(key)
        return
      }
      case "recordOwnedOperationIntent": {
        if (transition === undefined || selected === undefined) return
        const operationId = yield* activationOperationFor(action.task)
        yield* activationController.bindReservedPosition(
          selected,
          operationId
        )
        const owner = [...(yield* activationOwnership.snapshot()).owners]
          .find(([, entry]) => entry.transition.taskId === transition.taskId)
        if (owner !== undefined) {
          yield* activationOwnership.bindOperation(owner[0], operationId)
        }
        return
      }
      case "interruptBeforeOwnership": {
        if (selected !== undefined) {
          yield* activationController.cancelReservedPosition(selected)
          preIntentInterruptedTaskIds = new Set([
            ...preIntentInterruptedTaskIds,
            selected.subjectTaskId
          ])
          activationTriggerPending = true
        }
        return
      }
      case "interruptAfterOwnershipBeforeIntent": {
        if (transition === undefined || selected === undefined) return
        const owner = [...(yield* activationOwnership.snapshot()).owners]
          .find(([, entry]) => entry.transition.taskId === transition.taskId)
        yield* activationController.cancelReservedPosition(selected)
        if (owner !== undefined) {
          yield* activationOwnership.remove(owner[0])
        }
        preIntentInterruptedTaskIds = new Set([
          ...preIntentInterruptedTaskIds,
          transition.taskId
        ])
        activationTriggerPending = true
        return
      }
      case "interruptAfterIntent": {
        if (transition === undefined) return
        const owner = [...(yield* activationOwnership.snapshot()).owners]
          .find(([, entry]) => entry.transition.taskId === transition.taskId)
        if (owner !== undefined) {
          yield* activationOwnership.remove(owner[0])
        }
        postIntentExitedTaskIds = new Set([
          ...postIntentExitedTaskIds,
          transition.taskId
        ])
        activationTriggerPending = true
        return
      }
      case "recordOwnedResultAndRelease": {
        if (transition === undefined) return
        const owner = [...(yield* activationOwnership.snapshot()).owners]
          .find(([, entry]) => entry.transition.taskId === transition.taskId)
        if (owner !== undefined) {
          const ownedOperationId = Option.getOrUndefined(
            owner[1].operationId
          )
          if (ownedOperationId !== undefined) {
            yield* activationController.releaseTaskAdmissionPosition(
              ownedOperationId
            )
          } else {
            yield* activationController.cancelReservedPosition(
              owner[1].selected
            )
          }
          yield* activationOwnership.remove(owner[0])
        }
        resultsRecordedTaskIds = new Set([
          ...resultsRecordedTaskIds,
          transition.taskId
        ])
        providerWorkers = new Map(
          [...providerWorkers].filter(([taskId]) => taskId !== transition.taskId)
        )
        activationTriggerPending = true
        return
      }
      case "observeCapacityConsumed": {
        if (transition === undefined) return
        const operationId = yield* activationOperationFor(action.task)
        providerWorkers = new Map([
          ...providerWorkers,
          [transition.taskId, operationId]
        ])
        freshlyObservedTaskIds = new Set([
          ...freshlyObservedTaskIds,
          transition.taskId
        ])
        activationTriggerPending = true
        yield* activationController.applyFreshInvocationObservation({
          _tag: "FreshCapacityConsumed",
          observationId: ProviderObservationId.make(
            `M2-consumed:${action.task}`
          ),
          operationId,
          taskId: transition.taskId
        })
        return
      }
      case "observeCapacityReleased":
      case "stopProviderWorker": {
        if (transition === undefined) return
        const operationId = yield* activationOperationFor(action.task)
        providerWorkers = new Map(
          [...providerWorkers].filter(([taskId]) => taskId !== transition.taskId)
        )
        freshlyObservedTaskIds = new Set([
          ...freshlyObservedTaskIds,
          transition.taskId
        ])
        activationTriggerPending = true
        yield* activationController.applyFreshInvocationObservation({
          _tag: "FreshCapacityReleased",
          observationId: ProviderObservationId.make(
            `M2-released:${action.task}`
          ),
          operationId,
          taskId: transition.taskId
        })
        return
      }
      case "crashCoordinatorWithActivation": {
        coordinatorRunning = false
        activationOwnership = yield* makeActivationOwnershipRegistry(runId)
        activationController = yield* makeTaskAdmissionController({
          capacity: options.capacity,
          freshOccupiedInvocations: [],
          reconstructedReservedPositions: []
        })
        activationDerived = { explanations: [], transitions: [] }
        activationSelected = { explanations: [], transitions: [] }
        activationTriggerPending = false
        return
      }
      case "reconstructActivation": {
        coordinatorRunning = true
        activationOwnership = yield* makeActivationOwnershipRegistry(runId)
        activationController = yield* makeTaskAdmissionController({
          capacity: options.capacity,
          freshOccupiedInvocations: [...providerWorkers].map(
            ([taskId, operationId], index) => ({
              observationId: ProviderObservationId.make(
                `M2-reconstructed:${index}`
              ),
              operationId,
              taskId
            })
          ),
          reconstructedReservedPositions: []
        })
        activationTriggerPending = true
        return
      }
    }
  })

  const rawControls = {
    activation: (action: FrontierRecoveryActivationAction) => runActivationAction(action).pipe(Effect.orDie),
    orchestratorCommitsFreshTaskClaimIntent: (modelTaskId: FrontierRecoveryModelTaskId) =>
      Effect.gen(function*() {
        if (!coordinatorRunning) {
          return yield* frontierRecoveryReconstructionIssue(
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
          owner: frontierRecoveryClaimOwner,
          taskId,
          token: frontierRecoveryClaimTokenFor(modelTaskId)
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
    taskTrackerReturnsTargetClosureReadAtNextRevision: () =>
      appendTargetClosureObservation({
        explicitlyCoveredTasks: [],
        operation: targetClosureReplacementOperationIdentity,
        predecessorOperations: [],
        revision: replacementModelRevision,
        tasks: taskEntries.map(({ model }) => model)
      }),
    taskTrackerReturnsTargetClosureReadWithPredecessor: () =>
      appendTargetClosureObservation({
        explicitlyCoveredTasks: [],
        operation: targetClosureReplacementOperationIdentity,
        predecessorOperations: [initialGraphOperationIdentity],
        revision: replacementModelRevision,
        tasks: [modelTaskA, modelTaskC, modelTaskD]
      }),
    taskTrackerReturnsTargetClosureReadWithExplicitAbsenceCoverage: () =>
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
          return yield* frontierRecoveryReconstructionIssue(
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
        return yield* frontierRecoveryReconstructionIssue(
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
      const projectionMapping = {
        operationToModel: identityMapping.operationToModel,
        revisionToModel: modelRevisionFromTracker,
        taskToModel: identityMapping.taskToModel
      }
      const exactManagedState = yield* projectFrontierRecoveryExactManagedState(
        reduced.managedRun.graphKnowledge,
        reduced.managedRun.workflowHistory.records,
        reduced.managedRun.responsibility,
        target,
        projectionMapping
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
      const latestGraphIntent = records.findLast(
        ({ event }) => event._tag === "TrackerGraphObservationIntentRecorded"
      )?.event
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
      const graphReadCommon = latestGraphIntent?._tag
            === "TrackerGraphObservationIntentRecorded"
          && latestGraphOutcome?._tag === "TrackerGraphOutcomeObserved"
        ? {
          completeness: "Complete" as const,
          consistency: "PotentiallyMixedTime" as const,
          factFamily: "TargetMembership" as const,
          freshness: "FreshAtReadBoundary" as const,
          modelOperationId: yield* identityMapping.operationToModel(
            latestGraphIntent.operation.operationId
          ),
          modelRevision: yield* modelRevisionFromTracker(
            latestGraphOutcome.outcome.revision
          ),
          readShape: "TargetClosureMembership" as const,
          returnedModelTaskIds
        }
        : {
          completeness: "Complete" as const,
          consistency: "PotentiallyMixedTime" as const,
          factFamily: "TargetMembership" as const,
          freshness: "FreshAtReadBoundary" as const,
          modelOperationId: initialGraphOperationIdentity,
          modelRevision: initialModelRevision,
          readShape: "TargetClosureMembership" as const,
          returnedModelTaskIds: taskEntries.map(({ model }) => model)
        }
      const graphEvidence = graphObservationProfile === "ProvenAbsence"
          && latestGraphIntent?._tag === "TrackerGraphObservationIntentRecorded"
        ? {
          ...graphReadCommon,
          explicitlyCoveredModelTaskIds: yield* Effect.forEach(
            latestGraphIntent.operation.readShape.explicitlyCoveredTaskIds,
            identityMapping.taskToModel
          ),
          observationProfile: "ProvenAbsence" as const
        }
        : graphObservationProfile === "IncomparableMembership"
            && latestGraphIntent?._tag === "TrackerGraphObservationIntentRecorded"
        ? {
          ...graphReadCommon,
          modelPredecessorOperationIds: yield* Effect.forEach(
            latestGraphIntent.operation.predecessorOperationIds,
            identityMapping.operationToModel
          ),
          observationProfile: "IncomparableMembership" as const
        }
        : {
          ...graphReadCommon,
          observationProfile: graphObservationProfile === "CompatibleReplacement"
            ? "CompatibleReplacement" as const
            : "InitialObservation" as const
        }
      const ownershipSnapshot = yield* activationOwnership.snapshot()
      const ownershipProjection = yield* activationOwnership.exclude(
        activationDerived
      )
      const controllerSnapshot = yield* activationController.snapshot()
      const projectTaskIds = (
        taskIds: Iterable<TaskId>
      ) =>
        Effect.forEach(
          [...taskIds].sort(),
          identityMapping.taskToModel
        )
      const activationOwners = yield* Effect.forEach(
        [...ownershipSnapshot.owners].sort(([left], [right]) => left.localeCompare(right)),
        ([, owner]) =>
          Effect.gen(function*() {
            const operationId = Option.getOrUndefined(owner.operationId)
            return {
              ...(operationId === undefined
                ? {}
                : {
                  modelOperationId: yield* identityMapping.operationToModel(operationId)
                }),
              modelTaskId: yield* identityMapping.taskToModel(
                owner.transition.taskId
              ),
              phase: operationId === undefined
                ? "PreIntent" as const
                : "PostIntent" as const
            }
          })
      )
      const ownerByKey = ownershipSnapshot.owners
      return {
        activation: {
          activationInProgressModelTaskIds: yield* projectTaskIds(
            ownershipProjection.explanations.flatMap(
              (explanation) =>
                explanation._tag === "ActivationInProgress"
                  ? [explanation.taskId]
                  : []
            )
          ),
          derivedModelTaskIds: yield* projectTaskIds(
            activationDerived.transitions.map(({ taskId }) => taskId)
          ),
          freshlyObservedModelTaskIds: yield* projectTaskIds(
            freshlyObservedTaskIds
          ),
          isolatedModelTaskIds: yield* projectTaskIds(
            [...ownershipSnapshot.isolatedTransitionKeys].flatMap((key) => {
              const owner = ownerByKey.get(key)
              if (owner !== undefined) return [owner.transition.taskId]
              const transition = activationDerived.transitions.find(
                (candidate) =>
                  selectedTransitionKey(
                    makeSelectedTransitionIdentity(runId, candidate)
                  ) === key
              )
              return transition === undefined ? [] : [transition.taskId]
            })
          ),
          owners: activationOwners,
          postIntentExitedModelTaskIds: yield* projectTaskIds(
            postIntentExitedTaskIds
          ),
          preIntentInterruptedModelTaskIds: yield* projectTaskIds(
            preIntentInterruptedTaskIds
          ),
          providerConsumingModelTaskIds: yield* projectTaskIds(
            providerWorkers.keys()
          ),
          reservedPositions: yield* Effect.forEach(
            controllerSnapshot.reservedPositions,
            ({ correlation, taskId }) =>
              Effect.gen(function*() {
                const operationId = correlation._tag === "OperationReservation"
                  ? correlation.operationId
                  : undefined
                return {
                  correlation: operationId === undefined
                    ? "SelectedTransition" as const
                    : "Operation" as const,
                  ...(operationId === undefined
                    ? {}
                    : {
                      modelOperationId: yield* identityMapping.operationToModel(operationId)
                    }),
                  modelTaskId: yield* identityMapping.taskToModel(taskId)
                }
              })
          ),
          resultsRecordedModelTaskIds: yield* projectTaskIds(
            resultsRecordedTaskIds
          ),
          runnerModelTaskIds: yield* projectTaskIds(
            [...ownerByKey.values()].map(({ transition }) => transition.taskId)
          ),
          selectedModelTaskIds: yield* projectTaskIds(
            activationSelected.transitions.map(({ taskId }) => taskId)
          ),
          triggerPending: activationTriggerPending
        },
        admissionCapacity: selection.admissionCapacity,
        admittedTransitionOperations: selection.admittedTransitionOperations,
        admittedModelTaskIds: selection.admittedModelTaskIds,
        admittedTransitionTags: selection.admittedTransitionTags,
        admissionExplanations: selection.admissionExplanations,
        admissionReservedModelTaskIds: selection.admissionReservedModelTaskIds,
        coordinatorRunning,
        frontierTransitionOperations: selection.frontierTransitionOperations,
        frontierModelTaskIds: selection.frontierModelTaskIds,
        frontierTransitionTags: selection.frontierTransitionTags,
        graphEvidence,
        graphKnowledge: reduced.managedRun.graphKnowledge,
        graphKnowledgeProjection: exactManagedState.graphKnowledgeProjection,
        knownModelTaskIds,
        occupiedModelTaskIds: selection.occupiedModelTaskIds,
        pause: reduced.managedRun.pause,
        responsibility: reduced.managedRun.responsibility,
        responsibilityProjection: exactManagedState.responsibilityProjection,
        responsibleModelTaskIds,
        workflowHistory: reduced.managedRun.workflowHistory.records,
        workflowHistoryProjection: exactManagedState.workflowHistoryProjection,
        workflowEventTags: reduced.managedRun.workflowHistory.records.map(
          ({ event }) => event._tag
        )
      } satisfies FrontierRecoveryReconstructionProjection
    }
  )
  const runAction = (action: unknown) => runFrontierRecoveryReconstructionAction(action, rawControls)
  return {
    activation: runAction,
    orchestratorCommitsFreshTaskClaimIntent: (task: FrontierRecoveryModelTaskId) =>
      runAction({ _tag: "orchestratorCommitsFreshTaskClaimIntent", task }),
    crash: () => runAction({ _tag: "crash" }),
    getState,
    init: () => runAction({ _tag: "init" }),
    taskTrackerReturnsTargetClosureReadAtNextRevision: () =>
      runAction({ _tag: "taskTrackerReturnsTargetClosureReadAtNextRevision" }),
    taskTrackerReturnsTargetClosureReadWithPredecessor: () =>
      runAction({ _tag: "taskTrackerReturnsTargetClosureReadWithPredecessor" }),
    taskTrackerReturnsTargetClosureReadWithExplicitAbsenceCoverage: () =>
      runAction({ _tag: "taskTrackerReturnsTargetClosureReadWithExplicitAbsenceCoverage" }),
    orchestratorCommitsNextFreshTaskClaimIntent: () =>
      runAction({ _tag: "orchestratorCommitsNextFreshTaskClaimIntent" }),
    restart: () => runAction({ _tag: "restart" })
  } as const
})
