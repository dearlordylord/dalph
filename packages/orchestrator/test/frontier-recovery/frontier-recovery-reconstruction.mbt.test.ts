import { it } from "@effect/vitest"
import { defineDriver, ITFBigInt, ITFMap, ITFSet, ITFTuple, ITFVariant, stateCheck } from "@firfi/quint-connect/effect"
import { quintIt } from "@firfi/quint-connect/vitest"
import { Context, Effect, Layer, Ref, Schema } from "effect"
import { ProviderObservationId, TaskWorkCapacity } from "../../src/domain.js"
import { JournalStore, memoryJournalStoreLayer } from "../../src/journal-store.js"
import {
  type FrontierRecoveryActivationAction,
  FrontierRecoveryConformanceIssue,
  FrontierRecoveryModelCapacity,
  FrontierRecoveryModelJournalPosition,
  FrontierRecoveryModelOperationId,
  FrontierRecoveryModelRevision,
  FrontierRecoveryModelTaskId,
  type FrontierRecoveryReconstructionActionFields
} from "./frontier-recovery-conformance.js"
import { conflictingCapacityOperationId, frontierRecoveryTaskEntries } from "./frontier-recovery-fixture-identities.js"
import type {
  FrontierRecoveryActivationProjection,
  FrontierRecoveryReconstructionProjection
} from "./frontier-recovery-projection.js"
import { makeFrontierRecoveryReconstructionControls } from "./frontier-recovery-reconstruction.js"

const actionSchema = {
  capacityCorrelationAbsentConnectionStep: {},
  capacityCorrelationAdmissionConnectionStep: {},
  capacityCorrelationConflictConnectionStep: {},
  capacityCorrelationInterruptedConnectionStep: {},
  capacityCorrelationReconstructionConnectionStep: {},
  capacityCorrelationTerminalConnectionStep: {},
  capacityCorrelationUnknownConnectionStep: {},
  claimActivationOwnership: { task: ITFBigInt },
  crash: {},
  crashCoordinatorWithActivation: {},
  deriveActivationPass: {},
  excludeOwnedTransitions: {},
  init: {},
  initAwaitingProviderEvidenceActivationProfile: {},
  initCapacityOneResponsibilityFirstProfile: {},
  initCorrelationConflictActivationProfile: {},
  initInvalidCurrentCapacityHistory: {},
  initStoppedCoordinator: {},
  interruptAfterIntent: { task: ITFBigInt },
  interruptAfterOwnershipBeforeIntent: { task: ITFBigInt },
  interruptBeforeOwnership: { task: ITFBigInt },
  observeCapacityAbsent: { task: ITFBigInt },
  observeCapacityConsumed: { task: ITFBigInt },
  observeCapacityInterrupted: { task: ITFBigInt },
  observeCapacityReleased: { task: ITFBigInt },
  observeCapacityUnknown: { task: ITFBigInt },
  observeConflictingCapacityCorrelation: {
    observedOperationId: ITFBigInt,
    task: ITFBigInt
  },
  observeConflictingOperationReleased: {
    observedOperationId: ITFBigInt,
    task: ITFBigInt
  },
  readProviderInvocationForReconstruction: { task: ITFBigInt },
  orchestratorCommitsFirstFreshTaskClaimIntent: {},
  orchestratorCommitsFreshTaskClaimIntent: { task: ITFBigInt },
  orchestratorCommitsNextFreshTaskClaimIntent: {},
  reconstructActivation: {},
  recordOwnedOperationIntent: { task: ITFBigInt },
  recordOwnedResultAndRelease: { task: ITFBigInt },
  rejectDuplicateOwnership: { task: ITFBigInt },
  reserveTaskAdmissionPosition: { task: ITFBigInt },
  restart: {},
  stopProviderWorker: { task: ITFBigInt },
  taskTrackerReturnsTargetClosureReadAtNextRevision: {},
  taskTrackerReturnsTargetClosureReadWithPredecessor: {},
  taskTrackerReturnsTargetClosureReadWithExplicitAbsenceCoverage: {},
  validateCurrentCapacityHistoryBeforeReconstruction: {}
} satisfies FrontierRecoveryReconstructionActionFields & {
  readonly capacityCorrelationAbsentConnectionStep: Record<never, never>
  readonly capacityCorrelationAdmissionConnectionStep: Record<never, never>
  readonly capacityCorrelationConflictConnectionStep: Record<never, never>
  readonly capacityCorrelationInterruptedConnectionStep: Record<never, never>
  readonly capacityCorrelationReconstructionConnectionStep: Record<never, never>
  readonly capacityCorrelationTerminalConnectionStep: Record<never, never>
  readonly capacityCorrelationUnknownConnectionStep: Record<never, never>
  readonly initCapacityOneResponsibilityFirstProfile: Record<never, never>
  readonly initCorrelationConflictActivationProfile: Record<never, never>
  readonly initAwaitingProviderEvidenceActivationProfile: Record<never, never>
  readonly initInvalidCurrentCapacityHistory: Record<never, never>
  readonly initStoppedCoordinator: Record<never, never>
  readonly orchestratorCommitsFirstFreshTaskClaimIntent: Record<never, never>
}

const ModelComplete = ITFVariant({
  Complete: ITFTuple()
})
const ModelPotentiallyMixedTime = ITFVariant({
  PotentiallyMixedTime: ITFTuple()
})
const ModelTargetMembership = ITFVariant({
  TargetMembership: ITFTuple()
})
const ModelFreshAtReadBoundary = ITFVariant({
  FreshAtReadBoundary: ITFTuple()
})
const ModelTargetClosureMembership = ITFVariant({
  TargetClosureMembership: ITFTuple()
})
const ModelFrontierRecoveryTargetClosure = ITFVariant({
  FrontierRecoveryTargetClosure: ITFTuple()
})
const ModelFrontierRecoveryClaimOwner = ITFVariant({
  FrontierRecoveryClaimOwner: ITFTuple()
})

const ModelTargetClosureReadEvidence = {
  completeness: ModelComplete,
  consistency: ModelPotentiallyMixedTime,
  factFamily: ModelTargetMembership,
  freshness: ModelFreshAtReadBoundary,
  operationId: ITFBigInt,
  readShape: ModelTargetClosureMembership,
  revision: ITFBigInt,
  returnedTaskIds: ITFSet(ITFBigInt)
} as const

const ModelReconstructionGraphEvidence = ITFVariant({
  CompatibleReplacementGraphObservation: Schema.Struct(ModelTargetClosureReadEvidence),
  IncomparableMembershipGraphObservation: Schema.Struct({
    predecessorOperationIds: ITFSet(ITFBigInt),
    read: Schema.Struct(ModelTargetClosureReadEvidence)
  }),
  InitialReconstructionGraphObservation: Schema.Struct(ModelTargetClosureReadEvidence),
  ProvenAbsenceGraphObservation: Schema.Struct({
    explicitlyCoveredTaskIds: ITFSet(ITFBigInt),
    read: Schema.Struct(ModelTargetClosureReadEvidence)
  })
})

const ModelAdmissionExplanation = Schema.Struct({
  tag: Schema.Literal("CapacityWait"),
  taskId: ITFBigInt,
  wakeCondition: Schema.Literal(
    "CapacityReleasedOrReconstructedStateChanged"
  )
})

const ModelTransitionOperation = ITFVariant({
  DurableTransitionOperation: Schema.Struct({ operationId: ITFBigInt }),
  FreshTransitionWithoutOperation: ITFTuple()
})

const ModelTargetClosureObservation = Schema.Struct({
  completeness: ModelComplete,
  consistency: ModelPotentiallyMixedTime,
  explicitlyCoveredTaskIds: ITFSet(ITFBigInt),
  factFamily: ModelTargetMembership,
  freshness: ModelFreshAtReadBoundary,
  observedAt: ITFBigInt,
  provenAbsentTaskIds: ITFSet(ITFBigInt),
  read: Schema.Struct(ModelTargetClosureReadEvidence),
  target: ModelFrontierRecoveryTargetClosure
})

const ModelGraphKnowledge = ITFVariant({
  ReconstructedTargetClosureConflict: Schema.Struct({
    observations: Schema.Array(ModelTargetClosureObservation)
  }),
  ReconstructedTargetClosureObserved: ModelTargetClosureObservation
})

const ModelClaimToken = ITFVariant({
  FrontierRecoveryClaimToken: Schema.Struct({ taskId: ITFBigInt })
})

const ModelActivationOwner = ITFVariant({
  NoActivationOwner: ITFTuple(),
  PostIntentActivationOwner: Schema.Struct({ operationId: ITFBigInt }),
  PreIntentActivationOwner: ITFTuple()
})

const ModelActivationPosition = ITFVariant({
  ActivationPositionAwaitingProviderEvidence: Schema.Struct({ operationId: ITFBigInt }),
  ActivationPositionCorrelationConflict: Schema.Struct({
    expectedOperationId: ITFBigInt,
    observedOperationId: ITFBigInt
  }),
  ActivationPositionNotUsing: ITFTuple(),
  ActivationPositionReserved: Schema.Struct({ selectedTaskId: ITFBigInt }),
  ActivationPositionWorking: Schema.Struct({ operationId: ITFBigInt })
})

const ModelProviderInvocationObservation = ITFVariant({
  ProviderInvocationAbsent: Schema.Struct({ operationId: ITFBigInt }),
  ProviderInvocationActive: Schema.Struct({ operationId: ITFBigInt }),
  ProviderInvocationInterrupted: Schema.Struct({ operationId: ITFBigInt }),
  ProviderInvocationNotObserved: ITFTuple(),
  ProviderInvocationTerminal: Schema.Struct({ operationId: ITFBigInt }),
  ProviderInvocationUnknown: Schema.Struct({ operationId: ITFBigInt })
})

const ModelActivation = Schema.Struct({
  activationInProgress: ITFSet(ITFBigInt),
  configuredCapacity: ITFBigInt,
  derivedTransitions: ITFSet(ITFBigInt),
  duplicateReservationLeaks: ITFSet(ITFBigInt),
  freshlyObservedCapacity: ITFSet(ITFBigInt),
  isolatedSubjects: ITFSet(ITFBigInt),
  lastReleaseCorrelation: Schema.Unknown,
  ownerRegistrationCounts: ITFMap(ITFBigInt, ITFBigInt),
  owners: ITFMap(ITFBigInt, Schema.Unknown),
  positions: ITFMap(ITFBigInt, Schema.Unknown),
  postIntentExited: ITFSet(ITFBigInt),
  preIntentInterrupted: ITFSet(ITFBigInt),
  freshProviderInvocationObservations: ITFMap(
    ITFBigInt,
    Schema.Unknown
  ),
  resultsRecorded: ITFSet(ITFBigInt),
  runners: ITFSet(ITFBigInt),
  selectedTransitions: ITFSet(ITFBigInt),
  triggerPending: Schema.Boolean
})

const ModelWorkflowRecord = ITFVariant({
  ReconstructionClaimIntent: Schema.Struct({
    operationId: ITFBigInt,
    owner: ModelFrontierRecoveryClaimOwner,
    position: ITFBigInt,
    predecessorOperationIds: ITFSet(ITFBigInt),
    taskId: ITFBigInt,
    token: ModelClaimToken
  }),
  ReconstructionGraphObservationIntent: Schema.Struct({
    explicitlyCoveredTaskIds: ITFSet(ITFBigInt),
    operationId: ITFBigInt,
    position: ITFBigInt,
    predecessorOperationIds: ITFSet(ITFBigInt)
  }),
  ReconstructionGraphOutcome: Schema.Struct({
    operationId: ITFBigInt,
    position: ITFBigInt,
    returnedTaskIds: ITFSet(ITFBigInt),
    revision: ITFBigInt
  })
})

const ModelResponsibility = ITFVariant({
  NoReconstructionResponsibility: ITFTuple(),
  ReconstructionClaimResponsibility: Schema.Struct({
    beganAt: ITFBigInt,
    operationId: ITFBigInt,
    owner: ModelFrontierRecoveryClaimOwner,
    taskId: ITFBigInt,
    token: ModelClaimToken
  })
})

const ModelProjection = Schema.Struct({
  state: Schema.Struct({
    activation: ModelActivation,
    control: Schema.Struct({
      runPaused: Schema.Boolean,
      taskPaused: ITFMap(ITFBigInt, Schema.Boolean)
    }),
    coordinator: Schema.Struct({ running: Schema.Boolean }),
    knowledge: ITFMap(
      ITFBigInt,
      Schema.Struct({ observation: Schema.Unknown })
    ),
    reconstructionGraphEvidence: ModelReconstructionGraphEvidence,
    reconstructionGraphKnowledge: ModelGraphKnowledge,
    reconstructionResponsibility: ITFMap(ITFBigInt, Schema.Unknown),
    reconstructionWorkflowHistory: Schema.Array(ModelWorkflowRecord),
    selectorProjection: Schema.Struct({
      admittedTaskIds: ITFSet(ITFBigInt),
      capacity: ITFBigInt,
      explanations: ITFSet(ModelAdmissionExplanation),
      frontierTaskIds: ITFSet(ITFBigInt),
      occupiedTaskIds: ITFSet(ITFBigInt),
      reservationTaskIds: ITFSet(ITFBigInt),
      transitionOperations: ITFMap(ITFBigInt, Schema.Unknown),
      transitionTags: ITFMap(ITFBigInt, Schema.String)
    }),
    workflow: ITFMap(
      ITFBigInt,
      Schema.Struct({ responsibility: Schema.Unknown })
    )
  })
})

const sortedBigInts = <Value extends bigint>(
  values: Iterable<Value>
): ReadonlyArray<Value> => [...values].sort((left, right) => left < right ? -1 : left > right ? 1 : 0)

type GraphProfile =
  | "CompatibleReplacement"
  | "IncomparableMembership"
  | "ProvenAbsence"

type ReconstructionComparable =
  & Pick<
    FrontierRecoveryReconstructionProjection,
    | "admissionCapacity"
    | "admittedTransitionOperations"
    | "admittedModelTaskIds"
    | "admittedTransitionTags"
    | "admissionExplanations"
    | "admissionReservedModelTaskIds"
    | "coordinatorRunning"
    | "frontierTransitionOperations"
    | "frontierModelTaskIds"
    | "frontierTransitionTags"
    | "graphEvidence"
    | "graphKnowledgeProjection"
    | "knownModelTaskIds"
    | "occupiedModelTaskIds"
    | "responsibleModelTaskIds"
    | "responsibilityProjection"
    | "workflowHistoryProjection"
    | "workflowEventTags"
  >
  & {
    readonly activation: FrontierRecoveryActivationProjection
    readonly pause: {
      readonly run: { readonly _tag: string }
      readonly tasks: { readonly _tag: string }
    }
  }

const reconstructionComparableFrom = (
  state: FrontierRecoveryReconstructionProjection
): ReconstructionComparable => ({
  activation: state.activation,
  admissionCapacity: state.admissionCapacity,
  admittedModelTaskIds: state.admittedModelTaskIds,
  admittedTransitionOperations: state.admittedTransitionOperations,
  admittedTransitionTags: state.admittedTransitionTags,
  admissionExplanations: state.admissionExplanations,
  admissionReservedModelTaskIds: state.admissionReservedModelTaskIds,
  coordinatorRunning: state.coordinatorRunning,
  frontierModelTaskIds: state.frontierModelTaskIds,
  frontierTransitionOperations: state.frontierTransitionOperations,
  frontierTransitionTags: state.frontierTransitionTags,
  graphEvidence: state.graphEvidence,
  graphKnowledgeProjection: state.graphKnowledgeProjection,
  knownModelTaskIds: state.knownModelTaskIds,
  occupiedModelTaskIds: state.occupiedModelTaskIds,
  pause: state.pause,
  responsibleModelTaskIds: state.responsibleModelTaskIds,
  responsibilityProjection: state.responsibilityProjection,
  workflowEventTags: state.workflowEventTags,
  workflowHistoryProjection: state.workflowHistoryProjection
})

const modelGraphEvidenceFrom = (
  value: typeof ModelReconstructionGraphEvidence.Type
): FrontierRecoveryReconstructionProjection["graphEvidence"] => {
  const read = value.tag === "ProvenAbsenceGraphObservation"
      || value.tag === "IncomparableMembershipGraphObservation"
    ? value.value.read
    : value.value
  const common = {
    completeness: "Complete" as const,
    consistency: "PotentiallyMixedTime" as const,
    factFamily: "TargetMembership" as const,
    freshness: "FreshAtReadBoundary" as const,
    modelOperationId: FrontierRecoveryModelOperationId.make(
      read.operationId
    ),
    modelRevision: FrontierRecoveryModelRevision.make(read.revision),
    readShape: "TargetClosureMembership" as const,
    returnedModelTaskIds: sortedBigInts(read.returnedTaskIds).map(
      (task) => FrontierRecoveryModelTaskId.make(task)
    )
  }
  if (value.tag === "ProvenAbsenceGraphObservation") {
    return {
      ...common,
      explicitlyCoveredModelTaskIds: sortedBigInts(
        value.value.explicitlyCoveredTaskIds
      ).map((task) => FrontierRecoveryModelTaskId.make(task)),
      observationProfile: "ProvenAbsence"
    }
  }
  if (value.tag === "IncomparableMembershipGraphObservation") {
    return {
      ...common,
      modelPredecessorOperationIds: sortedBigInts(
        value.value.predecessorOperationIds
      ).map((operation) => FrontierRecoveryModelOperationId.make(operation)),
      observationProfile: "IncomparableMembership"
    }
  }
  return {
    ...common,
    observationProfile: value.tag === "CompatibleReplacementGraphObservation"
      ? "CompatibleReplacement"
      : "InitialObservation"
  }
}

const graphProfileFrom = (
  evidence: FrontierRecoveryReconstructionProjection["graphEvidence"]
): GraphProfile | undefined =>
  evidence.observationProfile === "ProvenAbsence"
    ? "ProvenAbsence"
    : evidence.observationProfile === "IncomparableMembership"
    ? "IncomparableMembership"
    : evidence.observationProfile === "CompatibleReplacement"
    ? "CompatibleReplacement"
    : undefined

const graphEvidenceMatches = (
  left: FrontierRecoveryReconstructionProjection["graphEvidence"],
  right: FrontierRecoveryReconstructionProjection["graphEvidence"]
): boolean =>
  JSON.stringify(left, (_, value) => typeof value === "bigint" ? value.toString() : value)
    === JSON.stringify(right, (_, value) => typeof value === "bigint" ? value.toString() : value)

const canonicalProjection = (value: unknown): unknown =>
  typeof value === "bigint"
    ? value.toString()
    : Array.isArray(value)
    ? value.map(canonicalProjection)
    : typeof value === "object" && value !== null
    ? Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalProjection(entry)])
    )
    : value

const normalizedProjectionMatches = (left: unknown, right: unknown): boolean =>
  JSON.stringify(canonicalProjection(left))
    === JSON.stringify(canonicalProjection(right))

const makeReconstructionDriver = (
  configuredCapacity: 1 | 2,
  initiallyResponsibleTask?: 0 | 2,
  startStopped = false,
  reconstructedReservedTasks: ReadonlyArray<0 | 2> = [],
  initiallyConflictingTaskA = false
) => {
  let closePreviousControls: Effect.Effect<void> = Effect.void
  const driver = defineDriver(
    actionSchema,
    () => {
      let capacityCorrelationReconstructionStage = 0
      const capacity = TaskWorkCapacity.make(configuredCapacity)
      const services = Effect.runSync(
        Layer.build(memoryJournalStoreLayer).pipe(Effect.scoped)
      )
      const journal = Context.get(services, JournalStore)
      const controls = Effect.runSync(
        makeFrontierRecoveryReconstructionControls({
          capacity,
          coordinatorRunning: true,
          freshOccupiedInvocations: initiallyConflictingTaskA
            ? [{
              observationId: ProviderObservationId.make(
                "M2-initial-conflicting-observation"
              ),
              operationId: conflictingCapacityOperationId,
              taskId: frontierRecoveryTaskEntries[0].branded
            }]
            : [],
          journal,
          reconstructedReservedModelTaskIds: reconstructedReservedTasks.map(
            (task) => FrontierRecoveryModelTaskId.make(BigInt(task))
          )
        }).pipe(Effect.orDie)
      )
      closePreviousControls = controls.close()
      const controlsRef = Effect.runSync(Ref.make(controls))
      const initialize = () =>
        Effect.gen(function*() {
          const current = yield* Ref.get(controlsRef)
          yield* current.init()
          if (initiallyResponsibleTask !== undefined) {
            yield* current.orchestratorCommitsFreshTaskClaimIntent(
              FrontierRecoveryModelTaskId.make(
                BigInt(initiallyResponsibleTask)
              )
            )
          }
          if (startStopped) {
            yield* current.close()
            const stopped = yield* makeFrontierRecoveryReconstructionControls({
              capacity,
              coordinatorRunning: false,
              freshOccupiedInvocations: initiallyConflictingTaskA
                ? [{
                  observationId: ProviderObservationId.make(
                    "M2-initial-conflicting-observation"
                  ),
                  operationId: conflictingCapacityOperationId,
                  taskId: frontierRecoveryTaskEntries[0].branded
                }]
                : [],
              journal,
              reconstructedReservedModelTaskIds: reconstructedReservedTasks.map(
                (task) => FrontierRecoveryModelTaskId.make(BigInt(task))
              )
            })
            yield* Ref.set(controlsRef, stopped)
            closePreviousControls = stopped.close()
          }
        })
      const activation = (action: FrontierRecoveryActivationAction) =>
        Ref.get(controlsRef).pipe(
          Effect.flatMap((current) => current.activation(action))
        )
      const activationForTask = (
        _tag: Extract<
          FrontierRecoveryActivationAction,
          { readonly task: unknown }
        >["_tag"],
        task: bigint
      ) =>
        activation({
          _tag,
          task: FrontierRecoveryModelTaskId.make(task)
        } as Extract<FrontierRecoveryActivationAction, { readonly task: unknown }>)
      const activationWithObservedOperation = (
        _tag:
          | "observeConflictingCapacityCorrelation"
          | "observeConflictingOperationReleased",
        task: bigint,
        observedOperationId: bigint
      ) =>
        activation({
          _tag,
          observedOperationId: FrontierRecoveryModelOperationId.make(observedOperationId),
          task: FrontierRecoveryModelTaskId.make(task)
        })
      return {
        capacityCorrelationAbsentConnectionStep: () => activationForTask("observeCapacityAbsent", 0n),
        capacityCorrelationAdmissionConnectionStep: () =>
          activationWithObservedOperation(
            "observeConflictingCapacityCorrelation",
            0n,
            101n
          ),
        capacityCorrelationConflictConnectionStep: () =>
          activationWithObservedOperation(
            "observeConflictingCapacityCorrelation",
            0n,
            101n
          ),
        capacityCorrelationInterruptedConnectionStep: () => activationForTask("observeCapacityInterrupted", 0n),
        capacityCorrelationReconstructionConnectionStep: () => {
          capacityCorrelationReconstructionStage += 1
          if (capacityCorrelationReconstructionStage === 1) {
            return activation({ _tag: "crashCoordinatorWithActivation" })
          }
          if (capacityCorrelationReconstructionStage === 2) {
            return activationForTask(
              "readProviderInvocationForReconstruction",
              0n
            )
          }
          return activation({ _tag: "reconstructActivation" })
        },
        capacityCorrelationTerminalConnectionStep: () =>
          activationWithObservedOperation(
            "observeConflictingOperationReleased",
            0n,
            101n
          ),
        capacityCorrelationUnknownConnectionStep: () => activationForTask("observeCapacityUnknown", 0n),
        claimActivationOwnership: ({ task }) => activationForTask("claimActivationOwnership", task),
        crashCoordinatorWithActivation: () => activation({ _tag: "crashCoordinatorWithActivation" }),
        deriveActivationPass: () => activation({ _tag: "deriveActivationPass" }),
        excludeOwnedTransitions: () => activation({ _tag: "excludeOwnedTransitions" }),
        orchestratorCommitsFirstFreshTaskClaimIntent: () =>
          Ref.get(controlsRef).pipe(
            Effect.flatMap((current) =>
              current.orchestratorCommitsFreshTaskClaimIntent(
                FrontierRecoveryModelTaskId.make(0n)
              )
            )
          ),
        orchestratorCommitsFreshTaskClaimIntent: ({ task }) =>
          Ref.get(controlsRef).pipe(
            Effect.flatMap((current) =>
              current.orchestratorCommitsFreshTaskClaimIntent(
                FrontierRecoveryModelTaskId.make(task)
              )
            )
          ),
        crash: () =>
          Ref.get(controlsRef).pipe(
            Effect.flatMap((current) => current.crash())
          ),
        getState: () =>
          Ref.get(controlsRef).pipe(
            Effect.flatMap((current) =>
              current.getState().pipe(
                Effect.map(reconstructionComparableFrom)
              )
            )
          ),
        init: initialize,
        initAwaitingProviderEvidenceActivationProfile: initialize,
        initCapacityOneResponsibilityFirstProfile: initialize,
        initCorrelationConflictActivationProfile: initialize,
        initInvalidCurrentCapacityHistory: () =>
          initialize().pipe(
            Effect.andThen(
              activation({
                _tag: "validateCurrentCapacityHistoryBeforeReconstruction"
              })
            )
          ),
        initStoppedCoordinator: initialize,
        interruptAfterIntent: ({ task }) => activationForTask("interruptAfterIntent", task),
        interruptAfterOwnershipBeforeIntent: ({ task }) =>
          activationForTask("interruptAfterOwnershipBeforeIntent", task),
        interruptBeforeOwnership: ({ task }) => activationForTask("interruptBeforeOwnership", task),
        observeCapacityConsumed: ({ task }) => activationForTask("observeCapacityConsumed", task),
        observeCapacityAbsent: ({ task }) => activationForTask("observeCapacityAbsent", task),
        observeCapacityInterrupted: ({ task }) => activationForTask("observeCapacityInterrupted", task),
        observeCapacityReleased: ({ task }) => activationForTask("observeCapacityReleased", task),
        observeCapacityUnknown: ({ task }) => activationForTask("observeCapacityUnknown", task),
        observeConflictingCapacityCorrelation: ({
          observedOperationId,
          task
        }) =>
          activationWithObservedOperation(
            "observeConflictingCapacityCorrelation",
            task,
            observedOperationId
          ),
        observeConflictingOperationReleased: ({
          observedOperationId,
          task
        }) =>
          activationWithObservedOperation(
            "observeConflictingOperationReleased",
            task,
            observedOperationId
          ),
        readProviderInvocationForReconstruction: ({ task }) =>
          activationForTask(
            "readProviderInvocationForReconstruction",
            task
          ),
        taskTrackerReturnsTargetClosureReadAtNextRevision: () =>
          Ref.get(controlsRef).pipe(
            Effect.flatMap((current) => current.taskTrackerReturnsTargetClosureReadAtNextRevision())
          ),
        taskTrackerReturnsTargetClosureReadWithPredecessor: () =>
          Ref.get(controlsRef).pipe(
            Effect.flatMap((current) => current.taskTrackerReturnsTargetClosureReadWithPredecessor())
          ),
        taskTrackerReturnsTargetClosureReadWithExplicitAbsenceCoverage: () =>
          Ref.get(controlsRef).pipe(
            Effect.flatMap((current) => current.taskTrackerReturnsTargetClosureReadWithExplicitAbsenceCoverage())
          ),
        orchestratorCommitsNextFreshTaskClaimIntent: () =>
          Ref.get(controlsRef).pipe(
            Effect.flatMap((current) => current.orchestratorCommitsNextFreshTaskClaimIntent())
          ),
        reconstructActivation: () => activation({ _tag: "reconstructActivation" }),
        recordOwnedOperationIntent: ({ task }) => activationForTask("recordOwnedOperationIntent", task),
        recordOwnedResultAndRelease: ({ task }) => activationForTask("recordOwnedResultAndRelease", task),
        rejectDuplicateOwnership: ({ task }) => activationForTask("rejectDuplicateOwnership", task),
        reserveTaskAdmissionPosition: ({ task }) => activationForTask("reserveTaskAdmissionPosition", task),
        restart: () =>
          Effect.gen(function*() {
            const current = yield* Ref.get(controlsRef)
            yield* current.close()
            const freshControls = yield* makeFrontierRecoveryReconstructionControls({
              capacity,
              coordinatorRunning: false,
              freshOccupiedInvocations: initiallyConflictingTaskA
                ? [{
                  observationId: ProviderObservationId.make(
                    "M2-initial-conflicting-observation"
                  ),
                  operationId: conflictingCapacityOperationId,
                  taskId: frontierRecoveryTaskEntries[0].branded
                }]
                : [],
              journal,
              reconstructedReservedModelTaskIds: reconstructedReservedTasks.map(
                (task) => FrontierRecoveryModelTaskId.make(BigInt(task))
              )
            })
            yield* freshControls.restart()
            yield* Ref.set(controlsRef, freshControls)
            closePreviousControls = freshControls.close()
            return yield* freshControls.getState()
          }),
        stopProviderWorker: ({ task }) => activationForTask("stopProviderWorker", task),
        validateCurrentCapacityHistoryBeforeReconstruction: () =>
          activation({
            _tag: "validateCurrentCapacityHistoryBeforeReconstruction"
          })
      }
    }
  )
  return {
    create: () => closePreviousControls.pipe(Effect.andThen(driver.create()))
  }
}

const normalizeImportedModelState = (raw: unknown): unknown => {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return raw
  if ("state" in raw) return raw
  const importedState = Object.entries(raw).find(([key]) => key.endsWith("::state"))
  return importedState === undefined ? raw : { state: importedState[1] }
}

const modelGraphObservationProjection = (
  observation: typeof ModelTargetClosureObservation.Type
) => ({
  completeness: "Complete" as const,
  consistency: "PotentiallyMixedTime" as const,
  explicitlyCoveredModelTaskIds: sortedBigInts(
    observation.explicitlyCoveredTaskIds
  ).map((task) => FrontierRecoveryModelTaskId.make(task)),
  factFamily: "TargetMembership" as const,
  freshness: "FreshAtReadBoundary" as const,
  modelObservedAt: FrontierRecoveryModelJournalPosition.make(
    observation.observedAt
  ),
  modelOperationId: FrontierRecoveryModelOperationId.make(
    observation.read.operationId
  ),
  modelRevision: FrontierRecoveryModelRevision.make(
    observation.read.revision
  ),
  provenAbsentModelTaskIds: sortedBigInts(
    observation.provenAbsentTaskIds
  ).map((task) => FrontierRecoveryModelTaskId.make(task)),
  returnedModelTaskIds: sortedBigInts(
    observation.read.returnedTaskIds
  ).map((task) => FrontierRecoveryModelTaskId.make(task)),
  target: "FrontierRecoveryTargetClosure" as const
})

const modelGraphKnowledgeProjection = (
  knowledge: typeof ModelGraphKnowledge.Type
) =>
  knowledge.tag === "ReconstructedTargetClosureObserved"
    ? {
      _tag: "TargetClosureObserved" as const,
      observation: modelGraphObservationProjection(knowledge.value)
    }
    : {
      _tag: "TargetClosureConflict" as const,
      observations: knowledge.value.observations.map(
        modelGraphObservationProjection
      )
    }

const modelWorkflowHistoryProjection = (
  history: ReadonlyArray<typeof ModelWorkflowRecord.Type>
): FrontierRecoveryReconstructionProjection["workflowHistoryProjection"] =>
  history.map((record) => {
    const modelOperationId = FrontierRecoveryModelOperationId.make(
      record.value.operationId
    )
    const modelPosition = FrontierRecoveryModelJournalPosition.make(
      record.value.position
    )
    if (record.tag === "ReconstructionGraphObservationIntent") {
      return {
        _tag: "GraphObservationIntent" as const,
        explicitlyCoveredModelTaskIds: sortedBigInts(
          record.value.explicitlyCoveredTaskIds
        ).map((task) => FrontierRecoveryModelTaskId.make(task)),
        modelOperationId,
        modelPosition,
        modelPredecessorOperationIds: sortedBigInts(
          record.value.predecessorOperationIds
        ).map((operation) => FrontierRecoveryModelOperationId.make(operation))
      }
    }
    if (record.tag === "ReconstructionGraphOutcome") {
      return {
        _tag: "GraphOutcome" as const,
        modelOperationId,
        modelPosition,
        modelRevision: FrontierRecoveryModelRevision.make(
          record.value.revision
        ),
        returnedModelTaskIds: sortedBigInts(
          record.value.returnedTaskIds
        ).map((task) => FrontierRecoveryModelTaskId.make(task))
      }
    }
    const modelTaskId = FrontierRecoveryModelTaskId.make(record.value.taskId)
    return {
      _tag: "ClaimIntent" as const,
      modelOperationId,
      modelPosition,
      modelPredecessorOperationIds: sortedBigInts(
        record.value.predecessorOperationIds
      ).map((operation) => FrontierRecoveryModelOperationId.make(operation)),
      modelTaskId,
      owner: "FrontierRecoveryClaimOwner" as const,
      token: { modelTaskId }
    }
  })

const modelResponsibilityProjection = (
  responsibility: ReadonlyMap<bigint, typeof ModelResponsibility.Type>
): FrontierRecoveryReconstructionProjection["responsibilityProjection"] =>
  [...responsibility.entries()]
    .flatMap(([, entry]) => {
      if (entry.tag === "NoReconstructionResponsibility") return []
      const modelTaskId = FrontierRecoveryModelTaskId.make(
        entry.value.taskId
      )
      return [{
        beganAt: FrontierRecoveryModelJournalPosition.make(
          entry.value.beganAt
        ),
        modelOperationId: FrontierRecoveryModelOperationId.make(
          entry.value.operationId
        ),
        modelTaskId,
        owner: "FrontierRecoveryClaimOwner" as const,
        token: { modelTaskId }
      }]
    })
    .sort((left, right) =>
      left.modelTaskId < right.modelTaskId
        ? -1
        : left.modelTaskId > right.modelTaskId
        ? 1
        : 0
    )

const decodeReconstructionModelState = (
  raw: unknown
): Effect.Effect<ReconstructionComparable> =>
  Schema.decodeUnknownEffect(ModelProjection)(
    normalizeImportedModelState(raw)
  ).pipe(
    Effect.flatMap(({ state }) =>
      Effect.gen(function*() {
        const reconstructionResponsibility = new Map(
          yield* Effect.forEach(
            [...state.reconstructionResponsibility],
            ([task, value]) =>
              Schema.decodeUnknownEffect(ModelResponsibility)(value).pipe(
                Effect.map((decoded) => [task, decoded] as const)
              )
          )
        )
        const responsibleModelTaskIds = sortedBigInts(
          [...reconstructionResponsibility]
            .filter(([, responsibility]) => responsibility.tag === "ReconstructionClaimResponsibility")
            .map(([task]) => task)
        ).map((task) => FrontierRecoveryModelTaskId.make(task))
        const graphEvidence = modelGraphEvidenceFrom(
          state.reconstructionGraphEvidence
        )
        const graphProfile = graphProfileFrom(graphEvidence)
        const selector = state.selectorProjection
        const modelTaskIds = (
          values: Iterable<bigint>
        ): ReadonlyArray<FrontierRecoveryModelTaskId> =>
          sortedBigInts(values).map((task) => FrontierRecoveryModelTaskId.make(task))
        const decodedActivationOwners = yield* Effect.forEach(
          [...state.activation.owners],
          ([task, owner]) =>
            Schema.decodeUnknownEffect(ModelActivationOwner)(owner).pipe(
              Effect.map((decoded) => [task, decoded] as const)
            )
        )
        const activationOwners = decodedActivationOwners
          .flatMap(([task, owner]) =>
            owner.tag === "NoActivationOwner"
              ? []
              : [{
                ...(owner.tag === "PostIntentActivationOwner"
                  ? {
                    modelOperationId: FrontierRecoveryModelOperationId.make(
                      owner.value.operationId
                    )
                  }
                  : {}),
                modelTaskId: FrontierRecoveryModelTaskId.make(task),
                phase: owner.tag === "PostIntentActivationOwner"
                  ? "PostIntent" as const
                  : "PreIntent" as const
              }]
          )
          .sort((left, right) =>
            left.modelTaskId < right.modelTaskId
              ? -1
              : left.modelTaskId > right.modelTaskId
              ? 1
              : 0
          )
        const decodedActivationPositions = yield* Effect.forEach(
          [...state.activation.positions],
          ([task, position]) =>
            Schema.decodeUnknownEffect(ModelActivationPosition)(position).pipe(
              Effect.map((decoded) => [task, decoded] as const)
            )
        )
        const decodedProviderInvocationObservations = yield* Effect.forEach(
          [...state.activation.freshProviderInvocationObservations],
          ([task, observation]) =>
            Schema.decodeUnknownEffect(ModelProviderInvocationObservation)(
              observation
            ).pipe(Effect.map((decoded) => [task, decoded] as const))
        )
        const activationReservedPositions: FrontierRecoveryActivationProjection["reservedPositions"] =
          decodedActivationPositions.flatMap<
            FrontierRecoveryActivationProjection["reservedPositions"][number]
          >(([task, position]) => {
            if (
              position.tag === "ActivationPositionNotUsing"
              || position.tag === "ActivationPositionWorking"
            ) return []
            if (position.tag === "ActivationPositionReserved") {
              return [{
                correlation: "SelectedTransition" as const,
                modelTaskId: FrontierRecoveryModelTaskId.make(task)
              }]
            }
            return [{
              correlation: "Operation" as const,
              ...(position.tag === "ActivationPositionCorrelationConflict"
                ? {
                  conflictingModelOperationId: FrontierRecoveryModelOperationId.make(
                    position.value.observedOperationId
                  )
                }
                : {}),
              modelOperationId: FrontierRecoveryModelOperationId.make(
                position.tag === "ActivationPositionCorrelationConflict"
                  ? position.value.expectedOperationId
                  : position.value.operationId
              ),
              modelTaskId: FrontierRecoveryModelTaskId.make(task)
            }]
          }).sort((left, right) =>
            left.modelTaskId < right.modelTaskId
              ? -1
              : left.modelTaskId > right.modelTaskId
              ? 1
              : 0
          )
        const transitionOperationFor = (
          taskId: FrontierRecoveryModelTaskId
        ) =>
          Effect.gen(function*() {
            const operation = selector.transitionOperations.get(taskId)
            if (operation === undefined) {
              return yield* new FrontierRecoveryConformanceIssue({
                detail: `M2 selector projection omitted transition operation for task ${taskId}`,
                reason: "MissingMapping"
              })
            }
            const decoded = yield* Schema.decodeUnknownEffect(
              ModelTransitionOperation
            )(operation)
            return decoded.tag === "DurableTransitionOperation"
              ? {
                _tag: "DurableTransitionOperation" as const,
                modelOperationId: FrontierRecoveryModelOperationId.make(
                  decoded.value.operationId
                )
              }
              : { _tag: "FreshTransitionWithoutOperation" as const }
          })
        const frontierModelTaskIds = sortedBigInts(
          selector.frontierTaskIds
        ).map((task) => FrontierRecoveryModelTaskId.make(task))
        const admittedModelTaskIds = sortedBigInts(
          selector.admittedTaskIds
        ).map((task) => FrontierRecoveryModelTaskId.make(task))
        const workflowHistoryProjection = modelWorkflowHistoryProjection(
          state.reconstructionWorkflowHistory
        )
        const workflowEventTags = workflowHistoryProjection.map((record) =>
          record._tag === "GraphObservationIntent"
            ? "TrackerGraphObservationIntentRecorded" as const
            : record._tag === "GraphOutcome"
            ? "TrackerGraphOutcomeObserved" as const
            : "TaskClaimAcquisitionIntended" as const
        )
        const transitionTagFor = (taskId: bigint) => {
          const tag = selector.transitionTags.get(taskId)
          return tag === undefined
            ? Effect.fail(
              new FrontierRecoveryConformanceIssue({
                detail: `M2 selector projection omitted transition tag for task ${taskId}`,
                reason: "MissingMapping"
              })
            )
            : Effect.succeed(tag)
        }
        return {
          activation: {
            activationInProgressModelTaskIds: modelTaskIds(
              state.activation.activationInProgress
            ),
            derivedModelTaskIds: modelTaskIds(
              state.activation.derivedTransitions
            ),
            freshlyObservedModelTaskIds: modelTaskIds(
              state.activation.freshlyObservedCapacity
            ),
            isolatedModelTaskIds: modelTaskIds(
              state.activation.isolatedSubjects
            ),
            owners: activationOwners,
            postIntentExitedModelTaskIds: modelTaskIds(
              state.activation.postIntentExited
            ),
            preIntentInterruptedModelTaskIds: modelTaskIds(
              state.activation.preIntentInterrupted
            ),
            providerConsumingModelTaskIds: modelTaskIds(
              new Set(
                decodedProviderInvocationObservations.flatMap(
                  ([task, observation]) =>
                    observation.tag === "ProviderInvocationActive"
                      ? [task]
                      : []
                )
              )
            ),
            reservedPositions: activationReservedPositions,
            resultsRecordedModelTaskIds: modelTaskIds(
              state.activation.resultsRecorded
            ),
            runnerModelTaskIds: modelTaskIds(state.activation.runners),
            selectedModelTaskIds: modelTaskIds(
              state.activation.selectedTransitions
            ),
            triggerPending: state.activation.triggerPending
          },
          admissionCapacity: FrontierRecoveryModelCapacity.make(
            selector.capacity
          ),
          admittedTransitionOperations: yield* Effect.forEach(
            admittedModelTaskIds,
            transitionOperationFor
          ),
          admittedModelTaskIds,
          admittedTransitionTags: yield* Effect.forEach(
            admittedModelTaskIds,
            transitionTagFor
          ),
          admissionExplanations: [...selector.explanations]
            .map(({ tag, taskId, wakeCondition }) => ({
              modelTaskId: FrontierRecoveryModelTaskId.make(taskId),
              tag,
              wakeCondition
            }))
            .sort((left, right) =>
              left.modelTaskId < right.modelTaskId
                ? -1
                : left.modelTaskId > right.modelTaskId
                ? 1
                : 0
            ),
          admissionReservedModelTaskIds: sortedBigInts(
            selector.reservationTaskIds
          ).map((task) => FrontierRecoveryModelTaskId.make(task)),
          coordinatorRunning: state.coordinator.running,
          frontierTransitionOperations: yield* Effect.forEach(
            frontierModelTaskIds,
            transitionOperationFor
          ),
          frontierModelTaskIds,
          frontierTransitionTags: yield* Effect.forEach(
            frontierModelTaskIds,
            transitionTagFor
          ),
          graphEvidence,
          graphKnowledgeProjection: modelGraphKnowledgeProjection(
            state.reconstructionGraphKnowledge
          ),
          knownModelTaskIds: graphProfile === "ProvenAbsence"
            ? graphEvidence.returnedModelTaskIds
            : sortedBigInts(state.knowledge.keys()).map((task) => FrontierRecoveryModelTaskId.make(task)),
          occupiedModelTaskIds: sortedBigInts(
            selector.occupiedTaskIds
          ).map((task) => FrontierRecoveryModelTaskId.make(task)),
          pause: {
            run: {
              _tag: state.control.runPaused
                ? "RunPaused" as const
                : "RunUnpaused" as const
            },
            tasks: {
              _tag: [...state.control.taskPaused.values()].some(Boolean)
                ? "SomeTaskPauses" as const
                : "NoTaskPauses" as const
            }
          },
          responsibleModelTaskIds,
          responsibilityProjection: modelResponsibilityProjection(
            reconstructionResponsibility
          ),
          workflowEventTags,
          workflowHistoryProjection
        } satisfies ReconstructionComparable
      })
    ),
    Effect.orDie
  )

const explanationIdentity = (explanation: {
  readonly modelTaskId: bigint
  readonly tag: string
  readonly wakeCondition: string
}): string => `${explanation.modelTaskId}:${explanation.tag}:${explanation.wakeCondition}`

const explanationIdentities = (
  explanations: ReconstructionComparable["admissionExplanations"]
): string => explanations.map(explanationIdentity).sort().join(",")

const compareReconstructionState = (
  model: ReconstructionComparable,
  implementation: ReconstructionComparable
): boolean =>
  normalizedProjectionMatches(model.activation, implementation.activation)
  && model.admissionCapacity === implementation.admissionCapacity
  && JSON.stringify(model.admittedTransitionOperations, (_, value) =>
      typeof value === "bigint" ? value.toString() : value)
    === JSON.stringify(implementation.admittedTransitionOperations, (_, value) =>
      typeof value === "bigint" ? value.toString() : value)
  && model.coordinatorRunning === implementation.coordinatorRunning
  && model.admittedModelTaskIds.join(",")
    === implementation.admittedModelTaskIds.join(",")
  && model.admittedTransitionTags.join(",")
    === implementation.admittedTransitionTags.join(",")
  && explanationIdentities(model.admissionExplanations)
    === explanationIdentities(implementation.admissionExplanations)
  && model.admissionReservedModelTaskIds.join(",")
    === implementation.admissionReservedModelTaskIds.join(",")
  && model.frontierModelTaskIds.join(",")
    === implementation.frontierModelTaskIds.join(",")
  && JSON.stringify(model.frontierTransitionOperations, (_, value) =>
      typeof value === "bigint" ? value.toString() : value)
    === JSON.stringify(implementation.frontierTransitionOperations, (_, value) =>
      typeof value === "bigint" ? value.toString() : value)
  && model.frontierTransitionTags.join(",")
    === implementation.frontierTransitionTags.join(",")
  && model.knownModelTaskIds.join(",")
    === implementation.knownModelTaskIds.join(",")
  && model.occupiedModelTaskIds.join(",")
    === implementation.occupiedModelTaskIds.join(",")
  && model.responsibleModelTaskIds.join(",")
    === implementation.responsibleModelTaskIds.join(",")
  && graphEvidenceMatches(model.graphEvidence, implementation.graphEvidence)
  && normalizedProjectionMatches(
    model.graphKnowledgeProjection,
    implementation.graphKnowledgeProjection
  )
  && JSON.stringify(model.pause) === JSON.stringify(implementation.pause)
  && normalizedProjectionMatches(
    model.responsibilityProjection,
    implementation.responsibilityProjection
  )
  && normalizedProjectionMatches(
    model.workflowHistoryProjection,
    implementation.workflowHistoryProjection
  )
  && model.workflowEventTags.join(",")
    === implementation.workflowEventTags.join(",")

const reconstructionStateCheck = stateCheck(
  decodeReconstructionModelState,
  compareReconstructionState
)

const compareCapacityCorrelationState = (
  model: ReconstructionComparable,
  implementation: ReconstructionComparable
): boolean =>
  normalizedProjectionMatches(model.activation, implementation.activation)
  && model.admissionCapacity === implementation.admissionCapacity
  && model.admittedModelTaskIds.join(",")
    === implementation.admittedModelTaskIds.join(",")
  && explanationIdentities(model.admissionExplanations)
    === explanationIdentities(implementation.admissionExplanations)
  && model.admissionReservedModelTaskIds.join(",")
    === implementation.admissionReservedModelTaskIds.join(",")
  && model.occupiedModelTaskIds.join(",")
    === implementation.occupiedModelTaskIds.join(",")
  && model.coordinatorRunning === implementation.coordinatorRunning

const capacityCorrelationStateCheck = stateCheck(
  decodeReconstructionModelState,
  compareCapacityCorrelationState
)

for (const configuredCapacity of [1, 2] as const) {
  quintIt(
    it.effect,
    `replays the M2 capacity-${configuredCapacity} reconstruction slice through production reducers`,
    {
      backend: "typescript",
      driverFactory: makeReconstructionDriver(configuredCapacity),
      main: configuredCapacity === 1
        ? "frontierRecoveryCapacityOne"
        : "frontierRecoveryCapacityTwo",
      maxSteps: 2,
      nTraces: 8,
      seed: configuredCapacity === 1 ? "131" : "144",
      spec: "specs/frontierRecovery.qnt",
      step: "orchestratorCommitsNextFreshTaskClaimIntent",
      stateCheck: reconstructionStateCheck
    },
    60_000
  )
}

quintIt(
  it.effect,
  "replays M2 capacity-one responsibility-first selection through production reducers",
  {
    backend: "typescript",
    driverFactory: makeReconstructionDriver(1, 2),
    init: "initCapacityOneResponsibilityFirstProfile",
    main: "frontierRecoveryCapacityOne",
    maxSteps: 2,
    nTraces: 8,
    seed: "132",
    spec: "specs/frontierRecovery.qnt",
    step: "orchestratorCommitsNextFreshTaskClaimIntent",
    stateCheck: reconstructionStateCheck
  },
  60_000
)

for (
  const profile of [
    {
      name: "activation ownership and exact result release",
      step: "activationOwnershipProfileStep"
    },
    {
      name: "activation interruption and provider evidence",
      step: "activationInterruptionProfileStep"
    },
    {
      name: "activation crash and reconstruction",
      step: "activationCrashReconstructionProfileStep"
    }
  ] as const
) {
  quintIt(
    it.effect,
    `replays generated ${profile.name} commands`,
    {
      backend: "typescript",
      driverFactory: makeReconstructionDriver(2),
      main: "frontierRecoveryCapacityTwo",
      maxSteps: 18,
      nTraces: 12,
      seed: "132152",
      spec: "specs/frontierRecovery.qnt",
      stateCheck: reconstructionStateCheck,
      step: profile.step
    },
    60_000
  )
}

for (
  const scenario of [
    {
      capacity: 2,
      driverFactory: makeReconstructionDriver(2, 0, false, [0]),
      init: "initAwaitingProviderEvidenceActivationProfile",
      maxSteps: 2,
      name: "the seeded capacity-two correlation portfolio",
      nTraces: 32,
      seed: "13101",
      step: "capacityCorrelationConnectionPortfolioStep",
      witnesses: [
        "capacityCorrelationConflictReached",
        "differentlyCorrelatedTerminalRetainsExpectedPositionReached",
        "unknownCapacityEvidenceRetainsExactConflictReached",
        "matchingCapacityAbsenceReleasesPositionReached",
        "matchingCapacityInterruptionReleasesPositionReached",
        "capacityTwoConflictAdmitsIndependentTaskReached",
        "invalidCapacityHistoryRejectedBeforeFrontierReached"
      ]
    },
    {
      capacity: 1,
      driverFactory: makeReconstructionDriver(1, 0, false, [0]),
      init: "initAwaitingProviderEvidenceActivationProfile",
      maxSteps: 3,
      name: "capacity one explaining why C waits behind conflicted A",
      nTraces: 2,
      seed: "13107",
      step: "capacityCorrelationAdmissionConnectionStep",
      witnesses: ["capacityOneConflictExplainsIndependentTaskWaitReached"]
    },
    {
      capacity: 2,
      driverFactory: makeReconstructionDriver(2, 0, false, [0], true),
      init: "initCorrelationConflictActivationProfile",
      maxSteps: 1,
      name: "restart reconstructing the exact provider correlation conflict",
      nTraces: 2,
      seed: "13108",
      step: "capacityCorrelationReconstructionConnectionStep",
      witnesses: ["restartReconstructsExactCapacityConflictReached"]
    }
  ] as const
) {
  quintIt(
    it.effect,
    `replays M2 ${scenario.name} through production capacity state`,
    {
      backend: "typescript",
      driverFactory: scenario.driverFactory,
      init: scenario.init,
      main: scenario.capacity === 1
        ? "frontierRecoveryCapacityOne"
        : "frontierRecoveryCapacityTwo",
      maxSteps: scenario.maxSteps,
      nTraces: scenario.nTraces,
      seed: scenario.seed,
      spec: "specs/frontierRecovery.qnt",
      stateCheck: capacityCorrelationStateCheck,
      step: scenario.step,
      witnesses: scenario.witnesses
    },
    60_000
  )
}

for (
  const { action: profile, seed, witness } of [
    {
      action: "taskTrackerReturnsTargetClosureReadWithExplicitAbsenceCoverage",
      seed: "145",
      witness: "taskTrackerProvenAbsenceReadReached"
    },
    {
      action: "taskTrackerReturnsTargetClosureReadWithPredecessor",
      seed: "146",
      witness: "taskTrackerIncomparableMembershipReadReached"
    },
    {
      action: "taskTrackerReturnsTargetClosureReadAtNextRevision",
      seed: "147",
      witness: "taskTrackerCompatibleReplacementReadReached"
    }
  ] as const
) {
  quintIt(it.effect, `replays M2 ${profile} through the production graph reducer`, {
    backend: "typescript",
    driverFactory: makeReconstructionDriver(2),
    main: "frontierRecoveryCapacityTwo",
    maxSteps: 2,
    nTraces: 2,
    seed,
    spec: "specs/frontierRecovery.qnt",
    step: profile,
    stateCheck: reconstructionStateCheck,
    witnesses: [witness]
  }, 30_000)
}

quintIt(
  it.effect,
  "replays a generated own-then-derive-before-result activation prefix",
  {
    backend: "typescript",
    driverFactory: makeReconstructionDriver(2),
    main: "frontierRecoveryCapacityTwo",
    maxSteps: 4,
    nTraces: 24,
    seed: "132151",
    spec: "specs/frontierRecovery.qnt",
    stateCheck: reconstructionStateCheck,
    step: "activationOwnedThenDerivedPrefixStep",
    witnesses: ["activationOwnershipBeforeIntentReached"]
  },
  60_000
)
