/* eslint-disable max-lines -- This closed adapter keeps action execution and its journal projection together. */
import { Deferred, Effect, Exit, Fiber, Option, Queue, Scope } from "effect"
import {
  ActivationCause,
  type ActivationCoordinator,
  makeActivationCoordinator,
  type OwnedTransitionExecution
} from "../../src/activation-coordinator.js"
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
  type RunnableFrontier,
  type RunnableFrontierTransition,
  runnableTransitionTaskId
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

type ActivationCoordinatorInput = Parameters<
  typeof makeActivationCoordinator
>[0]
type ActivationCoordinatorControl = NonNullable<
  ActivationCoordinatorInput["control"]
>
type ActivationCoordinatorCheckpoint = Parameters<
  ActivationCoordinatorControl["checkpoint"]
>[0]
type ActivationCoordinatorCheckpointFailure = Effect.Error<
  ReturnType<ActivationCoordinatorControl["checkpoint"]>
>
type ActivationOwnershipSnapshot = ActivationCoordinatorCheckpoint["observation"]["ownership"]

const CheckpointFailure = {
  InterruptActivation: (): ActivationCoordinatorCheckpointFailure => ({
    _tag: "InterruptActivation"
  }),
  RejectDuplicateOwnership: (): ActivationCoordinatorCheckpointFailure => ({
    _tag: "RejectDuplicateOwnership"
  })
} as const

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
  const activationOperationFor = (
    modelTaskId: FrontierRecoveryModelTaskId
  ) =>
    identityMapping.operationFromModel(
      modelTaskId === modelTaskA
        ? firstClaimOperationIdentity
        : secondClaimOperationIdentity
    )
  let coordinatorRunning = options.coordinatorRunning
  let capacityHistoryRejected = false
  const reconstructedReservedPositions = yield* Effect.forEach(
    options.reconstructedReservedModelTaskIds ?? [],
    (modelTaskId) =>
      Effect.all({
        operationId: activationOperationFor(modelTaskId),
        taskId: identityMapping.taskFromModel(modelTaskId)
      })
  )
  let activationController = yield* makeTaskAdmissionController({
    capacity: options.capacity,
    freshOccupiedInvocations: options.freshOccupiedInvocations ?? [],
    reconstructedReservedPositions
  })
  let derivedFrontierObservation: RunnableFrontier = {
    explanations: [],
    transitions: []
  }
  let selectedFrontierObservation: RunnableFrontier = {
    explanations: [],
    transitions: []
  }
  let providerWorkers: ReadonlyMap<TaskId, OperationId> = new Map(
    (options.freshOccupiedInvocations ?? []).map(
      ({ operationId, taskId }) => [taskId, operationId]
    )
  )
  let providerObservationTaskIds: ReadonlySet<TaskId> = new Set(providerWorkers.keys())
  let providerObservedActiveTaskIds: ReadonlySet<TaskId> = new Set(providerWorkers.keys())
  let activationCheckpointHistory: ReadonlyArray<ActivationCoordinatorCheckpoint> = []
  let activationProjectionEvents: ReadonlyArray<
    "Derived" | "ReactivationRequested"
  > = ["ReactivationRequested"]
  let latestActivationCheckpoint: ActivationCoordinatorCheckpoint | undefined
  let pendingActivationCheckpoints: ReadonlyArray<{
    readonly checkpoint: ActivationCoordinatorCheckpoint
    readonly decision: Deferred.Deferred<
      void,
      ActivationCoordinatorCheckpointFailure
    >
  }> = []
  let heldActivationCheckpoints: typeof pendingActivationCheckpoints = []
  let activationCoordinator: ActivationCoordinator | undefined
  let activationScope: Scope.Closeable | undefined
  const incomingActivationCheckpoints = yield* Queue.unbounded<{
    readonly checkpoint: ActivationCoordinatorCheckpoint
    readonly decision: Deferred.Deferred<
      void,
      ActivationCoordinatorCheckpointFailure
    >
  }>()
  let runnerCommands: ReadonlyMap<
    TaskId,
    Queue.Queue<
      | { readonly _tag: "Complete" }
      | { readonly _tag: "Interrupt" }
      | { readonly _tag: "RecordIntent"; readonly operationId: OperationId }
    >
  > = new Map()

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

  const rememberCheckpoint = (
    checkpoint: ActivationCoordinatorCheckpoint
  ) => {
    latestActivationCheckpoint = checkpoint
    activationCheckpointHistory = [...activationCheckpointHistory, checkpoint]
    if (checkpoint._tag === "FrontierDerived") {
      derivedFrontierObservation = checkpoint.frontier
    } else if (checkpoint._tag === "OwnedTransitionsExcluded") {
      selectedFrontierObservation = checkpoint.frontier
      activationProjectionEvents = [...activationProjectionEvents, "Derived"]
    } else if (checkpoint._tag === "AdmissionReserved") {
      selectedFrontierObservation = {
        ...selectedFrontierObservation,
        transitions: selectedFrontierObservation.transitions.filter(
          (candidate) =>
            runnableTransitionTaskId(candidate)
              !== runnableTransitionTaskId(checkpoint.transition)
        )
      }
    } else if (
      checkpoint._tag === "AdmissionReservationCancelled"
      || checkpoint._tag === "OwnershipReleased"
    ) {
      activationProjectionEvents = [
        ...activationProjectionEvents,
        "ReactivationRequested"
      ]
    }
  }

  const takeActivationCheckpoint = Effect.fn(
    "FrontierRecoveryReconstruction.takeActivationCheckpoint"
  )(function*(
    tag: ActivationCoordinatorCheckpoint["_tag"],
    taskId?: TaskId
  ) {
    const matchesRequestedCheckpoint = (
      pending: {
        readonly checkpoint: ActivationCoordinatorCheckpoint
      }
    ) =>
      pending.checkpoint._tag === tag
      && (
        taskId === undefined
        || (
          "transition" in pending.checkpoint
          && runnableTransitionTaskId(pending.checkpoint.transition) === taskId
        )
      )

    for (;;) {
      const held = heldActivationCheckpoints.find(matchesRequestedCheckpoint)
      if (held !== undefined) {
        return held
      }
      const index = pendingActivationCheckpoints.findIndex(
        matchesRequestedCheckpoint
      )
      if (index >= 0) {
        const pending = pendingActivationCheckpoints[index]
        if (pending !== undefined) {
          pendingActivationCheckpoints = pendingActivationCheckpoints.filter(
            (_, candidateIndex) => candidateIndex !== index
          )
          rememberCheckpoint(pending.checkpoint)
          heldActivationCheckpoints = [
            ...heldActivationCheckpoints,
            pending
          ]
          return pending
        }
      }
      pendingActivationCheckpoints = [
        ...pendingActivationCheckpoints,
        yield* Queue.take(incomingActivationCheckpoints).pipe(
          Effect.timeout("2 seconds"),
          Effect.catchTag("TimeoutError", () =>
            new FrontierRecoveryConformanceIssue({
              detail: `production coordinator did not reach checkpoint ${tag}`,
              reason: "LossyProjection"
            }))
        )
      ]
    }
  })

  const settleCheckpoint = Effect.fn(
    "FrontierRecoveryReconstruction.settleCheckpoint"
  )(function*(
    pending: {
      readonly decision: Deferred.Deferred<
        void,
        ActivationCoordinatorCheckpointFailure
      >
    },
    failure?: ActivationCoordinatorCheckpointFailure
  ) {
    heldActivationCheckpoints = heldActivationCheckpoints.filter(
      ({ decision }) => decision !== pending.decision
    )
    yield* failure === undefined
      ? Deferred.succeed(pending.decision, undefined)
      : Deferred.fail(pending.decision, failure)
  })

  const observeOwnershipRelease = Effect.fn(
    "FrontierRecoveryReconstruction.observeOwnershipRelease"
  )(function*(taskId: TaskId) {
    const released = yield* takeActivationCheckpoint(
      "OwnershipReleased",
      taskId
    )
    runnerCommands = new Map(
      [...runnerCommands].filter(([candidate]) => candidate !== taskId)
    )
    yield* settleCheckpoint(released)
  })

  const observeAdmissionReservationCancellation = Effect.fn(
    "FrontierRecoveryReconstruction.observeAdmissionReservationCancellation"
  )(function*(taskId: TaskId) {
    const cancelled = yield* takeActivationCheckpoint(
      "AdmissionReservationCancelled",
      taskId
    )
    yield* settleCheckpoint(cancelled)
  })

  const reachOwnershipExclusion = Effect.fn(
    "FrontierRecoveryReconstruction.reachOwnershipExclusion"
  )(function*() {
    const held = heldActivationCheckpoints.find(
      ({ checkpoint }) => checkpoint._tag === "OwnedTransitionsExcluded"
    )
    if (held !== undefined) return held
    const derived = yield* takeActivationCheckpoint("FrontierDerived")
    yield* settleCheckpoint(derived)
    return yield* takeActivationCheckpoint("OwnedTransitionsExcluded")
  })

  const runControlledTransition = Effect.fn(
    "FrontierRecoveryReconstruction.runControlledTransition"
  )(function*(
    transition: RunnableFrontierTransition,
    execution: OwnedTransitionExecution
  ) {
    const commands = yield* Queue.unbounded<
      | { readonly _tag: "Complete" }
      | { readonly _tag: "Interrupt" }
      | { readonly _tag: "RecordIntent"; readonly operationId: OperationId }
    >()
    runnerCommands = new Map([
      ...runnerCommands,
      [runnableTransitionTaskId(transition), commands]
    ])
    for (;;) {
      const command = yield* Queue.take(commands)
      switch (command._tag) {
        case "Complete":
          return
        case "Interrupt":
          return yield* Effect.interrupt
        case "RecordIntent":
          yield* execution.recordIntent(command.operationId)
      }
    }
  })

  const awaitRunnerCommands = Effect.fn(
    "FrontierRecoveryReconstruction.awaitRunnerCommands"
  )(function*(taskId: TaskId) {
    return yield* Effect.gen(function*() {
      for (;;) {
        const commands = runnerCommands.get(taskId)
        if (commands !== undefined) return commands
        yield* Effect.yieldNow
      }
    }).pipe(
      Effect.timeout("2 seconds"),
      Effect.catchTag("TimeoutError", () =>
        new FrontierRecoveryConformanceIssue({
          detail: `production coordinator did not start the runner for ${taskId}`,
          reason: "LossyProjection"
        }))
    )
  })

  const makeControlledCoordinator = Effect.fn(
    "FrontierRecoveryReconstruction.makeControlledCoordinator"
  )(function*() {
    const scope = yield* Scope.make()
    const coordinator = yield* makeActivationCoordinator({
      admissionController: activationController,
      control: {
        checkpoint: (checkpoint) =>
          Effect.gen(function*() {
            const decision = yield* Deferred.make<
              void,
              ActivationCoordinatorCheckpointFailure
            >()
            yield* Queue.offer(incomingActivationCheckpoints, {
              checkpoint,
              decision
            })
            yield* Deferred.await(decision)
          })
      },
      readFrontier: deriveActivationFrontier(),
      runId,
      runTransition: runControlledTransition
    }).pipe(Scope.provide(scope))
    activationCoordinator = coordinator
    activationScope = scope
  })

  const ensureCoordinatorSignal = Effect.fn(
    "FrontierRecoveryReconstruction.ensureCoordinatorSignal"
  )(function*() {
    const coordinator = activationCoordinator
    const scope = activationScope
    if (coordinator === undefined || scope === undefined) {
      return yield* frontierRecoveryReconstructionIssue(
        "CoordinatorStopped",
        "a stopped coordinator cannot derive activation"
      )
    }
    yield* coordinator.signal(ActivationCause.Resume()).pipe(
      Effect.ignore,
      Effect.forkIn(scope),
      Effect.asVoid
    )
  })

  const releasePendingTerminalCheckpoints = Effect.fn(
    "FrontierRecoveryReconstruction.releasePendingTerminalCheckpoints"
  )(function*() {
    const terminal = pendingActivationCheckpoints.filter(
      ({ checkpoint }) => checkpoint._tag === "OwnershipReleased"
    )
    pendingActivationCheckpoints = pendingActivationCheckpoints.filter(
      ({ checkpoint }) => checkpoint._tag !== "OwnershipReleased"
    )
    const heldTerminal = heldActivationCheckpoints.filter(
      ({ checkpoint }) => checkpoint._tag === "OwnershipReleased"
    )
    heldActivationCheckpoints = heldActivationCheckpoints.filter(
      ({ checkpoint }) => checkpoint._tag !== "OwnershipReleased"
    )
    yield* Effect.forEach(
      [...terminal, ...heldTerminal],
      ({ decision }) => Deferred.succeed(decision, undefined),
      { discard: true }
    )
  })

  const closeControlledCoordinator = Effect.fn(
    "FrontierRecoveryReconstruction.closeControlledCoordinator"
  )(function*() {
    const scope = activationScope
    if (scope === undefined) return
    const permitCheckpoints = Effect.forever(Effect.gen(function*() {
      let incoming: ReadonlyArray<
        (typeof pendingActivationCheckpoints)[number]
      > = []
      for (;;) {
        const next = yield* Queue.poll(incomingActivationCheckpoints)
        if (Option.isNone(next)) break
        incoming = [...incoming, next.value]
      }
      const checkpoints = [
        ...heldActivationCheckpoints,
        ...pendingActivationCheckpoints,
        ...incoming
      ]
      heldActivationCheckpoints = []
      pendingActivationCheckpoints = []
      yield* Effect.forEach(
        checkpoints,
        ({ decision }) => Deferred.succeed(decision, undefined),
        { discard: true }
      )
      yield* Effect.yieldNow
    }))
    const permitFiber = yield* permitCheckpoints.pipe(
      Effect.forkChild({ startImmediately: true })
    )
    yield* Scope.close(scope, Exit.void)
    yield* Fiber.interrupt(permitFiber)
  })

  if (coordinatorRunning) {
    yield* makeControlledCoordinator()
  }

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
    const taskId = taskAction === undefined
      ? undefined
      : yield* identityMapping.taskFromModel(taskAction.task)

    switch (action._tag) {
      case "deriveActivationPass": {
        yield* releasePendingTerminalCheckpoints()
        const priorExclusion = heldActivationCheckpoints.find(
          ({ checkpoint }) => checkpoint._tag === "OwnedTransitionsExcluded"
        )
        if (priorExclusion !== undefined) {
          yield* settleCheckpoint(
            priorExclusion,
            CheckpointFailure.InterruptActivation()
          )
          yield* Effect.yieldNow
        }
        const registered = heldActivationCheckpoints.find(
          ({ checkpoint }) => checkpoint._tag === "OwnershipRegistered"
        )
        if (registered !== undefined) yield* settleCheckpoint(registered)
        if (
          !pendingActivationCheckpoints.some(
            ({ checkpoint }) => checkpoint._tag === "FrontierDerived"
          )
          && !heldActivationCheckpoints.some(
            ({ checkpoint }) => checkpoint._tag === "FrontierDerived"
          )
        ) {
          yield* ensureCoordinatorSignal()
        }
        const derived = yield* takeActivationCheckpoint("FrontierDerived")
        yield* settleCheckpoint(derived)
        yield* takeActivationCheckpoint("OwnedTransitionsExcluded")
        return
      }
      case "excludeOwnedTransitions": {
        const registered = heldActivationCheckpoints.find(
          ({ checkpoint }) => checkpoint._tag === "OwnershipRegistered"
        )
        if (registered !== undefined) yield* settleCheckpoint(registered)
        yield* reachOwnershipExclusion()
        return
      }
      case "reserveTaskAdmissionPosition": {
        if (taskId === undefined) return
        const excluded = yield* reachOwnershipExclusion()
        yield* settleCheckpoint(excluded)
        yield* takeActivationCheckpoint("AdmissionReserved", taskId)
        return
      }
      case "claimActivationOwnership": {
        if (taskId === undefined) return
        const excluded = heldActivationCheckpoints.find(
          ({ checkpoint }) => checkpoint._tag === "OwnedTransitionsExcluded"
        )
        if (excluded !== undefined) {
          yield* settleCheckpoint(excluded)
        }
        const reserved = yield* takeActivationCheckpoint(
          "AdmissionReserved",
          taskId
        )
        yield* settleCheckpoint(reserved)
        const owned = yield* takeActivationCheckpoint(
          "OwnershipRegistered",
          taskId
        )
        yield* settleCheckpoint(owned)
        yield* awaitRunnerCommands(taskId)
        return
      }
      case "rejectDuplicateOwnership": {
        if (taskId === undefined) return
        const reserved = yield* takeActivationCheckpoint(
          "AdmissionReserved",
          taskId
        )
        yield* settleCheckpoint(reserved)
        const owned = yield* takeActivationCheckpoint(
          "OwnershipRegistered",
          taskId
        )
        yield* settleCheckpoint(
          owned,
          CheckpointFailure.RejectDuplicateOwnership()
        )
        yield* awaitRunnerCommands(taskId)
        yield* takeActivationCheckpoint("FrontierDerived")
        return
      }
      case "recordOwnedOperationIntent": {
        if (taskId === undefined) return
        const operationId = yield* activationOperationFor(action.task)
        let commands = runnerCommands.get(taskId)
        if (commands === undefined) {
          const owned = yield* takeActivationCheckpoint(
            "OwnershipRegistered",
            taskId
          )
          yield* settleCheckpoint(owned)
          commands = yield* awaitRunnerCommands(taskId)
        }
        yield* Queue.offer(commands, {
          _tag: "RecordIntent",
          operationId
        })
        yield* takeActivationCheckpoint("IntentBound", taskId)
        return
      }
      case "interruptBeforeOwnership": {
        if (taskId === undefined) return
        const reserved = yield* takeActivationCheckpoint(
          "AdmissionReserved",
          taskId
        )
        yield* settleCheckpoint(
          reserved,
          CheckpointFailure.InterruptActivation()
        )
        yield* observeAdmissionReservationCancellation(taskId)
        return
      }
      case "interruptAfterOwnershipBeforeIntent": {
        if (taskId === undefined) return
        const commands = runnerCommands.get(taskId)
        if (commands === undefined) {
          const owned = yield* takeActivationCheckpoint(
            "OwnershipRegistered",
            taskId
          )
          yield* settleCheckpoint(
            owned,
            CheckpointFailure.InterruptActivation()
          )
        } else {
          yield* Queue.offer(commands, { _tag: "Interrupt" })
          const returned = yield* takeActivationCheckpoint(
            "OperationReturned",
            taskId
          )
          yield* settleCheckpoint(returned)
        }
        yield* observeOwnershipRelease(taskId)
        return
      }
      case "interruptAfterIntent": {
        if (taskId === undefined) return
        const intended = yield* takeActivationCheckpoint("IntentBound", taskId)
        yield* settleCheckpoint(
          intended,
          CheckpointFailure.InterruptActivation()
        )
        const returned = yield* takeActivationCheckpoint(
          "OperationReturned",
          taskId
        )
        yield* settleCheckpoint(returned)
        yield* observeOwnershipRelease(taskId)
        return
      }
      case "recordOwnedResultAndRelease": {
        if (taskId === undefined) return
        const intended = heldActivationCheckpoints.find(
          ({ checkpoint }) =>
            checkpoint._tag === "IntentBound"
            && runnableTransitionTaskId(checkpoint.transition) === taskId
        )
        if (intended !== undefined) yield* settleCheckpoint(intended)
        let commands = runnerCommands.get(taskId)
        if (commands === undefined) {
          const owned = yield* takeActivationCheckpoint(
            "OwnershipRegistered",
            taskId
          )
          yield* settleCheckpoint(owned)
          commands = yield* awaitRunnerCommands(taskId)
        }
        yield* Queue.offer(commands, { _tag: "Complete" })
        const returned = yield* takeActivationCheckpoint(
          "OperationReturned",
          taskId
        )
        yield* settleCheckpoint(returned)
        yield* observeOwnershipRelease(taskId)
        providerWorkers = new Map(
          [...providerWorkers].filter(([candidate]) => candidate !== taskId)
        )
        providerObservedActiveTaskIds = new Set(
          [...providerObservedActiveTaskIds].filter(
            (candidate) => candidate !== taskId
          )
        )
        return
      }
      case "observeCapacityConsumed": {
        if (taskId === undefined) return
        const operationId = yield* activationOperationFor(action.task)
        providerWorkers = new Map([
          ...providerWorkers,
          [taskId, operationId]
        ])
        providerObservationTaskIds = new Set([
          ...providerObservationTaskIds,
          taskId
        ])
        providerObservedActiveTaskIds = new Set([
          ...providerObservedActiveTaskIds,
          taskId
        ])
        activationProjectionEvents = [
          ...activationProjectionEvents,
          "ReactivationRequested"
        ]
        yield* activationController.applyFreshInvocationObservation({
          _tag: "FreshCapacityConsumed",
          observationId: ProviderObservationId.make(
            `M2-consumed:${action.task}`
          ),
          operationId,
          taskId
        })
        return
      }
      case "observeConflictingCapacityCorrelation": {
        if (taskId === undefined) return
        const observedOperationId = yield* identityMapping.operationFromModel(
          action.observedOperationId
        )
        providerWorkers = new Map([
          ...providerWorkers,
          [taskId, observedOperationId]
        ])
        providerObservationTaskIds = new Set([
          ...providerObservationTaskIds,
          taskId
        ])
        providerObservedActiveTaskIds = new Set([
          ...providerObservedActiveTaskIds,
          taskId
        ])
        activationProjectionEvents = [
          ...activationProjectionEvents,
          "ReactivationRequested"
        ]
        yield* activationController.applyFreshInvocationObservation({
          _tag: "FreshCapacityConsumed",
          observationId: ProviderObservationId.make(
            `M2-conflicting:${action.task}:${action.observedOperationId}`
          ),
          operationId: observedOperationId,
          taskId
        })
        return
      }
      case "observeConflictingOperationReleased": {
        if (taskId === undefined) return
        const observedOperationId = yield* identityMapping.operationFromModel(
          action.observedOperationId
        )
        providerWorkers = new Map(
          [...providerWorkers].filter(([candidate]) => candidate !== taskId)
        )
        providerObservationTaskIds = new Set([
          ...providerObservationTaskIds,
          taskId
        ])
        providerObservedActiveTaskIds = new Set(
          [...providerObservedActiveTaskIds].filter(
            (candidate) => candidate !== taskId
          )
        )
        activationProjectionEvents = [
          ...activationProjectionEvents,
          "ReactivationRequested"
        ]
        yield* activationController.applyFreshInvocationObservation({
          _tag: "FreshCapacityReleased",
          observationId: ProviderObservationId.make(
            `M2-conflicting-released:${action.task}:${action.observedOperationId}`
          ),
          operationId: observedOperationId,
          taskId
        })
        return
      }
      case "observeCapacityReleased": {
        if (taskId === undefined) return
        const operationId = yield* activationOperationFor(action.task)
        providerWorkers = new Map(
          [...providerWorkers].filter(([candidate]) => candidate !== taskId)
        )
        providerObservationTaskIds = new Set([
          ...providerObservationTaskIds,
          taskId
        ])
        providerObservedActiveTaskIds = new Set(
          [...providerObservedActiveTaskIds].filter(
            (candidate) => candidate !== taskId
          )
        )
        activationProjectionEvents = [
          ...activationProjectionEvents,
          "ReactivationRequested"
        ]
        yield* activationController.applyFreshInvocationObservation({
          _tag: "FreshCapacityReleased",
          observationId: ProviderObservationId.make(
            `M2-released:${action.task}`
          ),
          operationId,
          taskId
        })
        return
      }
      case "observeCapacityAbsent":
      case "observeCapacityInterrupted": {
        if (taskId === undefined) return
        const operationId = yield* activationOperationFor(action.task)
        providerWorkers = new Map(
          [...providerWorkers].filter(([candidate]) => candidate !== taskId)
        )
        providerObservationTaskIds = new Set([
          ...providerObservationTaskIds,
          taskId
        ])
        providerObservedActiveTaskIds = new Set(
          [...providerObservedActiveTaskIds].filter(
            (candidate) => candidate !== taskId
          )
        )
        activationProjectionEvents = [
          ...activationProjectionEvents,
          "ReactivationRequested"
        ]
        yield* activationController.applyFreshInvocationObservation({
          _tag: "FreshCapacityReleased",
          observationId: ProviderObservationId.make(
            `M2-${action._tag}:${action.task}`
          ),
          operationId,
          taskId
        })
        return
      }
      case "observeCapacityUnknown": {
        if (taskId === undefined) return
        providerObservationTaskIds = new Set([
          ...providerObservationTaskIds,
          taskId
        ])
        providerObservedActiveTaskIds = new Set(
          [...providerObservedActiveTaskIds].filter(
            (candidate) => candidate !== taskId
          )
        )
        activationProjectionEvents = [
          ...activationProjectionEvents,
          "ReactivationRequested"
        ]
        return
      }
      case "stopProviderWorker": {
        if (taskId === undefined) return
        providerWorkers = new Map(
          [...providerWorkers].filter(([candidate]) => candidate !== taskId)
        )
        return
      }
      case "crashCoordinatorWithActivation": {
        yield* closeControlledCoordinator()
        coordinatorRunning = false
        activationController = yield* makeTaskAdmissionController({
          capacity: options.capacity,
          freshOccupiedInvocations: [],
          reconstructedReservedPositions: []
        })
        activationCoordinator = undefined
        activationScope = undefined
        pendingActivationCheckpoints = []
        heldActivationCheckpoints = []
        latestActivationCheckpoint = undefined
        activationProjectionEvents = []
        providerObservationTaskIds = new Set()
        providerObservedActiveTaskIds = new Set()
        derivedFrontierObservation = { explanations: [], transitions: [] }
        selectedFrontierObservation = { explanations: [], transitions: [] }
        runnerCommands = new Map()
        return
      }
      case "readProviderInvocationForReconstruction": {
        if (taskId === undefined) return
        providerObservationTaskIds = new Set([
          ...providerObservationTaskIds,
          taskId
        ])
        providerObservedActiveTaskIds = providerWorkers.has(taskId)
          ? new Set([...providerObservedActiveTaskIds, taskId])
          : new Set(
            [...providerObservedActiveTaskIds].filter(
              (candidate) => candidate !== taskId
            )
          )
        return
      }
      case "reconstructActivation": {
        coordinatorRunning = true
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
          reconstructedReservedPositions
        })
        pendingActivationCheckpoints = []
        heldActivationCheckpoints = []
        latestActivationCheckpoint = undefined
        activationProjectionEvents = ["ReactivationRequested"]
        derivedFrontierObservation = { explanations: [], transitions: [] }
        selectedFrontierObservation = { explanations: [], transitions: [] }
        yield* makeControlledCoordinator()
        return
      }
      case "validateCurrentCapacityHistoryBeforeReconstruction": {
        const taskId = yield* identityMapping.taskFromModel(modelTaskA)
        const validation = yield* makeTaskAdmissionController({
          capacity: options.capacity,
          freshOccupiedInvocations: [],
          reconstructedReservedPositions: [
            {
              operationId: yield* identityMapping.operationFromModel(
                firstClaimOperationIdentity
              ),
              taskId
            },
            {
              operationId: yield* identityMapping.operationFromModel(
                secondClaimOperationIdentity
              ),
              taskId
            }
          ]
        }).pipe(Effect.result)
        if (validation._tag === "Success") {
          return yield* new FrontierRecoveryConformanceIssue({
            detail: "production capacity reconstruction accepted two current operations for one task",
            reason: "LossyProjection"
          })
        }
        capacityHistoryRejected = true
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
      Effect.gen(function*() {
        yield* closeControlledCoordinator()
        coordinatorRunning = false
        activationCoordinator = undefined
        activationScope = undefined
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
          yield* identityMapping.taskToModel(
            runnableTransitionTaskId(transition)
          ).pipe(
            Effect.flatMap(
              rawControls.orchestratorCommitsFreshTaskClaimIntent
            )
          )
        }
      }),
    restart: () =>
      Effect.gen(function*() {
        coordinatorRunning = true
        if (activationCoordinator === undefined) {
          yield* makeControlledCoordinator()
        }
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
      const selected = yield* selectFrontier(
        reduced.managedRun.responsibility
      )
      const selection = capacityHistoryRejected
        ? {
          ...selected,
          admittedModelTaskIds: [],
          admittedTransitionOperations: [],
          admittedTransitionTags: [],
          admissionExplanations: [],
          admissionReservedModelTaskIds: [],
          admission: { explanations: [], transitions: [] },
          frontierModelTaskIds: [],
          frontierTransitionOperations: [],
          frontierTransitionTags: [],
          occupiedModelTaskIds: []
        }
        : selected
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
      const controllerSnapshot = yield* activationController.snapshot()
      const ownershipSnapshot: ActivationOwnershipSnapshot = latestActivationCheckpoint?.observation
        .ownership ?? {
        isolatedTransitionKeys: new Set<string>(),
        owners: new Map()
      }
      const releasedCheckpoints = activationCheckpointHistory.filter(
        (
          checkpoint
        ): checkpoint is Extract<
          ActivationCoordinatorCheckpoint,
          { readonly _tag: "OwnershipReleased" }
        > => checkpoint._tag === "OwnershipReleased"
      )
      const currentAttemptReleasedCheckpoints = activationCheckpointHistory
        .flatMap((checkpoint, index, history) =>
          checkpoint._tag === "OwnershipReleased"
            && !history.slice(index + 1).some(
              (candidate) =>
                candidate._tag === "AdmissionReserved"
                && runnableTransitionTaskId(candidate.transition)
                  === runnableTransitionTaskId(checkpoint.transition)
            )
            ? [checkpoint]
            : []
        )
      const currentAttemptAdmissionCancellations = activationCheckpointHistory
        .flatMap((checkpoint, index, history) =>
          checkpoint._tag === "AdmissionReservationCancelled"
            && !history.slice(index + 1).some(
              (candidate) =>
                candidate._tag === "AdmissionReserved"
                && runnableTransitionTaskId(candidate.transition)
                  === runnableTransitionTaskId(checkpoint.transition)
            )
            ? [runnableTransitionTaskId(checkpoint.transition)]
            : []
        )
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
                runnableTransitionTaskId(owner.transition)
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
            [...ownershipSnapshot.owners.values()].map(
              ({ transition }) => runnableTransitionTaskId(transition)
            )
          ),
          derivedModelTaskIds: yield* projectTaskIds(
            derivedFrontierObservation.transitions.map(
              runnableTransitionTaskId
            )
          ),
          freshlyObservedModelTaskIds: yield* projectTaskIds(
            providerObservationTaskIds
          ),
          isolatedModelTaskIds: yield* projectTaskIds(
            [...ownershipSnapshot.isolatedTransitionKeys].flatMap((key) => {
              const owner = ownerByKey.get(key)
              if (owner !== undefined) {
                return [runnableTransitionTaskId(owner.transition)]
              }
              const transition = derivedFrontierObservation.transitions.find(
                (candidate) =>
                  selectedTransitionKey(
                    makeSelectedTransitionIdentity(runId, candidate)
                  ) === key
              )
              return transition === undefined
                ? []
                : [runnableTransitionTaskId(transition)]
            })
          ),
          owners: activationOwners,
          postIntentExitedModelTaskIds: yield* projectTaskIds(
            new Set(
              currentAttemptReleasedCheckpoints.flatMap((checkpoint) =>
                checkpoint.runnerExit === "Failed"
                  && Option.isSome(checkpoint.operationId)
                  ? [runnableTransitionTaskId(checkpoint.transition)]
                  : []
              )
            )
          ),
          preIntentInterruptedModelTaskIds: yield* projectTaskIds(
            new Set(
              [
                ...currentAttemptAdmissionCancellations,
                ...currentAttemptReleasedCheckpoints.flatMap((checkpoint) =>
                  checkpoint.runnerExit === "Failed"
                    && Option.isNone(checkpoint.operationId)
                    ? [runnableTransitionTaskId(checkpoint.transition)]
                    : []
                )
              ]
            )
          ),
          providerConsumingModelTaskIds: yield* projectTaskIds(
            providerObservedActiveTaskIds
          ),
          reservedPositions: yield* Effect.forEach(
            controllerSnapshot.reservedPositions,
            ({ correlation, taskId }) =>
              Effect.gen(function*() {
                const operationId = correlation._tag === "OperationReservation"
                  ? correlation.operationId
                  : undefined
                const conflictingOperationId = operationId === undefined
                  ? undefined
                  : controllerSnapshot.occupied.find(
                    (invocation) =>
                      invocation.taskId === taskId
                      && invocation.operationId !== operationId
                  )?.operationId
                return {
                  correlation: operationId === undefined
                    ? "SelectedTransition" as const
                    : "Operation" as const,
                  ...(conflictingOperationId === undefined
                    ? {}
                    : {
                      conflictingModelOperationId: yield* identityMapping.operationToModel(
                        conflictingOperationId
                      )
                    }),
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
            new Set(
              releasedCheckpoints.flatMap((checkpoint) =>
                checkpoint.runnerExit === "Succeeded"
                  ? [runnableTransitionTaskId(checkpoint.transition)]
                  : []
              )
            )
          ),
          runnerModelTaskIds: yield* projectTaskIds(
            runnerCommands.keys()
          ),
          selectedModelTaskIds: yield* projectTaskIds(
            selectedFrontierObservation.transitions
              .filter((transition) =>
                !controllerSnapshot.reservedTaskIds.includes(
                  runnableTransitionTaskId(transition)
                )
              )
              .map(runnableTransitionTaskId)
          ),
          triggerPending: activationProjectionEvents.toReversed()[0]
            === "ReactivationRequested"
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
    advanceActivationAdmission: () =>
      Effect.gen(function*() {
        const excluded = yield* reachOwnershipExclusion()
        yield* settleCheckpoint(excluded)
        yield* Effect.yieldNow
        const snapshot = yield* activationController.snapshot()
        return {
          occupiedCount: snapshot.occupied.length,
          reservedPositionCount: snapshot.reservedPositions.length
        }
      }),
    activation: runAction,
    close: closeControlledCoordinator,
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
