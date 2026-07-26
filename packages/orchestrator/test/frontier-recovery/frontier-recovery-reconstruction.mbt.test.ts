import { it } from "@effect/vitest"
import { defineDriver, ITFBigInt, ITFMap, ITFSet, ITFVariant, stateCheck } from "@firfi/quint-connect/effect"
import { quintIt } from "@firfi/quint-connect/vitest"
import { Context, Effect, Layer, Ref, Schema } from "effect"
import { TaskWorkCapacity } from "../../src/domain.js"
import { JournalStore, memoryJournalStoreLayer } from "../../src/journal-store.js"
import {
  FrontierRecoveryModelCapacity,
  FrontierRecoveryModelOperationId,
  FrontierRecoveryModelRevision,
  FrontierRecoveryModelTaskId,
  type FrontierRecoveryReconstructionActionFields
} from "./frontier-recovery-conformance.js"
import {
  type FrontierRecoveryReconstructionProjection,
  makeFrontierRecoveryReconstructionControls
} from "./frontier-recovery-reconstruction.js"

const actionSchema = {
  crash: {},
  init: {},
  initCapacityOneResponsibilityFirstProfile: {},
  initStoppedCoordinator: {},
  orchestratorCommitsFirstFreshTaskClaimIntent: {},
  orchestratorCommitsFreshTaskClaimIntent: { task: ITFBigInt },
  orchestratorCommitsNextFreshTaskClaimIntent: {},
  restart: {},
  taskTrackerReportsCompatibleTargetClosureReplacement: {},
  taskTrackerReportsIncomparableTargetClosureMembership: {},
  taskTrackerReportsProvenAbsenceInTargetClosure: {}
} satisfies FrontierRecoveryReconstructionActionFields & {
  readonly initCapacityOneResponsibilityFirstProfile: Record<never, never>
  readonly initStoppedCoordinator: Record<never, never>
  readonly orchestratorCommitsFirstFreshTaskClaimIntent: Record<never, never>
}

const ModelTargetClosureReadEvidence = {
  completeness: Schema.Literal("Complete"),
  consistency: Schema.Literal("PotentiallyMixedTime"),
  factFamily: Schema.Literal("TargetMembership"),
  freshness: Schema.Literal("FreshAtReadBoundary"),
  operationId: ITFBigInt,
  readShape: Schema.Literal("TargetClosureMembership"),
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

const ModelProjection = Schema.Struct({
  state: Schema.Struct({
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
    selectorProjection: Schema.Struct({
      admittedTaskIds: ITFSet(ITFBigInt),
      capacity: ITFBigInt,
      explanations: ITFSet(ModelAdmissionExplanation),
      frontierTaskIds: ITFSet(ITFBigInt),
      occupiedTaskIds: ITFSet(ITFBigInt),
      operationIds: ITFMap(ITFBigInt, ITFBigInt),
      reservationTaskIds: ITFSet(ITFBigInt),
      transitionTags: ITFMap(ITFBigInt, Schema.String)
    }),
    workflow: ITFMap(
      ITFBigInt,
      Schema.Struct({ responsibility: Schema.Unknown })
    )
  })
})

const variantTag = (value: unknown): string => {
  if (typeof value === "string") return value
  if (typeof value === "object" && value !== null && "tag" in value) {
    return String(value.tag)
  }
  return String(value)
}

const sortedBigInts = <Value extends bigint>(
  values: Iterable<Value>
): ReadonlyArray<Value> => [...values].sort((left, right) => left < right ? -1 : left > right ? 1 : 0)

type GraphProfile =
  | "CompatibleReplacement"
  | "IncomparableMembership"
  | "ProvenAbsence"

// Negative two can never be a mapped operation and makes a missing model export fail comparison.

const missingModelOperationId = FrontierRecoveryModelOperationId.make(-2n)

type ReconstructionComparable =
  & Pick<
    FrontierRecoveryReconstructionProjection,
    | "admissionCapacity"
    | "admittedModelOperationIds"
    | "admittedModelTaskIds"
    | "admittedTransitionTags"
    | "admissionExplanations"
    | "admissionReservedModelTaskIds"
    | "coordinatorRunning"
    | "frontierModelOperationIds"
    | "frontierModelTaskIds"
    | "frontierTransitionTags"
    | "graphEvidence"
    | "knownModelTaskIds"
    | "occupiedModelTaskIds"
    | "responsibleModelTaskIds"
    | "workflowEventTags"
  >
  & {
    readonly pause: {
      readonly run: { readonly _tag: string }
      readonly tasks: { readonly _tag: string }
    }
  }

const modelGraphEvidenceFrom = (
  value: typeof ModelReconstructionGraphEvidence.Type
): FrontierRecoveryReconstructionProjection["graphEvidence"] => {
  const read = value.tag === "ProvenAbsenceGraphObservation"
      || value.tag === "IncomparableMembershipGraphObservation"
    ? value.value.read
    : value.value
  const common = {
    completeness: read.completeness,
    consistency: read.consistency,
    factFamily: read.factFamily,
    freshness: read.freshness,
    modelOperationId: FrontierRecoveryModelOperationId.make(
      read.operationId
    ),
    modelRevision: FrontierRecoveryModelRevision.make(read.revision),
    readShape: read.readShape,
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

const makeReconstructionDriver = (
  configuredCapacity: 1 | 2,
  initiallyResponsibleTask?: 0 | 2,
  startStopped = false
) =>
  defineDriver(
    actionSchema,
    () => {
      const capacity = TaskWorkCapacity.make(configuredCapacity)
      const services = Effect.runSync(
        Layer.build(memoryJournalStoreLayer).pipe(Effect.scoped)
      )
      const journal = Context.get(services, JournalStore)
      const controls = Effect.runSync(
        makeFrontierRecoveryReconstructionControls({
          capacity,
          coordinatorRunning: true,
          journal
        }).pipe(Effect.orDie)
      )
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
            const stopped = yield* makeFrontierRecoveryReconstructionControls({
              capacity,
              coordinatorRunning: false,
              journal
            })
            yield* Ref.set(controlsRef, stopped)
          }
        })
      return {
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
            Effect.flatMap((current) => current.getState())
          ),
        init: initialize,
        initCapacityOneResponsibilityFirstProfile: initialize,
        initStoppedCoordinator: initialize,
        taskTrackerReportsCompatibleTargetClosureReplacement: () =>
          Ref.get(controlsRef).pipe(
            Effect.flatMap((current) => current.taskTrackerReportsCompatibleTargetClosureReplacement())
          ),
        taskTrackerReportsIncomparableTargetClosureMembership: () =>
          Ref.get(controlsRef).pipe(
            Effect.flatMap((current) => current.taskTrackerReportsIncomparableTargetClosureMembership())
          ),
        taskTrackerReportsProvenAbsenceInTargetClosure: () =>
          Ref.get(controlsRef).pipe(
            Effect.flatMap((current) => current.taskTrackerReportsProvenAbsenceInTargetClosure())
          ),
        orchestratorCommitsNextFreshTaskClaimIntent: () =>
          Ref.get(controlsRef).pipe(
            Effect.flatMap((current) => current.orchestratorCommitsNextFreshTaskClaimIntent())
          ),
        restart: () =>
          Effect.gen(function*() {
            const freshControls = yield* makeFrontierRecoveryReconstructionControls({
              capacity,
              coordinatorRunning: false,
              journal
            })
            yield* freshControls.restart()
            yield* Ref.set(controlsRef, freshControls)
            return yield* freshControls.getState()
          })
      }
    }
  )

const normalizeImportedModelState = (raw: unknown): unknown => {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return raw
  if ("state" in raw) return raw
  const importedState = Object.entries(raw).find(([key]) => key.endsWith("::state"))
  return importedState === undefined ? raw : { state: importedState[1] }
}

const decodeReconstructionModelState = (raw: unknown) =>
  Schema.decodeUnknownEffect(ModelProjection)(
    normalizeImportedModelState(raw)
  ).pipe(
    Effect.map(({ state }) => {
      const responsibleModelTaskIds = sortedBigInts(
        [...state.workflow]
          .filter(([, workflow]) => variantTag(workflow.responsibility) === "Outstanding")
          .map(([task]) => task)
      ).map((task) => FrontierRecoveryModelTaskId.make(task))
      const graphEvidence = modelGraphEvidenceFrom(
        state.reconstructionGraphEvidence
      )
      const graphProfile = graphProfileFrom(graphEvidence)
      const selector = state.selectorProjection
      const frontierModelTaskIds = sortedBigInts(
        selector.frontierTaskIds
      ).map((task) => FrontierRecoveryModelTaskId.make(task))
      const admittedModelTaskIds = sortedBigInts(
        selector.admittedTaskIds
      ).map((task) => FrontierRecoveryModelTaskId.make(task))
      const transitionTagFor = (taskId: bigint): string =>
        selector.transitionTags.get(taskId) ?? "MissingModelTransition"
      return {
        admissionCapacity: FrontierRecoveryModelCapacity.make(
          selector.capacity
        ),
        admittedModelOperationIds: admittedModelTaskIds.map((taskId) =>
          FrontierRecoveryModelOperationId.make(
            selector.operationIds.get(taskId) ?? missingModelOperationId
          )
        ),
        admittedModelTaskIds,
        admittedTransitionTags: admittedModelTaskIds.map(transitionTagFor),
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
        frontierModelOperationIds: frontierModelTaskIds.map((taskId) =>
          FrontierRecoveryModelOperationId.make(
            selector.operationIds.get(taskId) ?? missingModelOperationId
          )
        ),
        frontierModelTaskIds,
        frontierTransitionTags: frontierModelTaskIds.map(transitionTagFor),
        graphEvidence,
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
        workflowEventTags: graphProfile !== undefined
          ? [
            "TrackerGraphObservationIntentRecorded",
            "TrackerGraphOutcomeObserved",
            "TrackerGraphObservationIntentRecorded",
            "TrackerGraphOutcomeObserved"
          ]
          : responsibleModelTaskIds.length === 0
          ? [
            "TrackerGraphObservationIntentRecorded",
            "TrackerGraphOutcomeObserved"
          ]
          : [
            "TrackerGraphObservationIntentRecorded",
            "TrackerGraphOutcomeObserved",
            ...responsibleModelTaskIds.map(() => "TaskClaimAcquisitionIntended" as const)
          ]
      }
    }),
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
  model.admissionCapacity === implementation.admissionCapacity
  && model.admittedModelOperationIds.join(",")
    === implementation.admittedModelOperationIds.join(",")
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
  && model.frontierModelOperationIds.join(",")
    === implementation.frontierModelOperationIds.join(",")
  && model.frontierTransitionTags.join(",")
    === implementation.frontierTransitionTags.join(",")
  && model.knownModelTaskIds.join(",")
    === implementation.knownModelTaskIds.join(",")
  && model.occupiedModelTaskIds.join(",")
    === implementation.occupiedModelTaskIds.join(",")
  && model.responsibleModelTaskIds.join(",")
    === implementation.responsibleModelTaskIds.join(",")
  && graphEvidenceMatches(model.graphEvidence, implementation.graphEvidence)
  && JSON.stringify(model.pause) === JSON.stringify(implementation.pause)
  && model.workflowEventTags.join(",")
    === implementation.workflowEventTags.join(",")

const reconstructionStateCheck = stateCheck(
  decodeReconstructionModelState,
  compareReconstructionState
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
  const { action: profile, seed, witness } of [
    {
      action: "taskTrackerReportsProvenAbsenceInTargetClosure",
      seed: "145",
      witness: "taskTrackerProvenAbsenceReadReached"
    },
    {
      action: "taskTrackerReportsIncomparableTargetClosureMembership",
      seed: "146",
      witness: "taskTrackerIncomparableMembershipReadReached"
    },
    {
      action: "taskTrackerReportsCompatibleTargetClosureReplacement",
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

for (
  const scenario of [
    {
      driverFactory: makeReconstructionDriver(2),
      name: "direct fresh-claim intent",
      step: "orchestratorCommitsFirstFreshTaskClaimIntent"
    },
    {
      driverFactory: makeReconstructionDriver(2),
      name: "coordinator crash",
      step: "crash"
    },
    {
      driverFactory: makeReconstructionDriver(2, undefined, true),
      init: "initStoppedCoordinator",
      name: "coordinator restart",
      step: "restart"
    }
  ] as const
) {
  quintIt(
    it.effect,
    `compares exact reconstruction projections after ${scenario.name}`,
    {
      backend: "typescript",
      driverFactory: scenario.driverFactory,
      ...(scenario.init === undefined ? {} : { init: scenario.init }),
      main: "frontierRecoveryCapacityTwo",
      maxSteps: 1,
      nTraces: 2,
      seed: "144",
      spec: "specs/frontierRecovery.qnt",
      stateCheck: reconstructionStateCheck,
      step: scenario.step
    },
    30_000
  )
}
