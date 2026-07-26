import { it } from "@effect/vitest"
import { defineDriver, ITFBigInt, ITFMap, ITFSet, ITFVariant, stateCheck } from "@firfi/quint-connect/effect"
import { quintIt } from "@firfi/quint-connect/vitest"
import { Context, Effect, Layer, Ref, Schema } from "effect"
import { OperationId, TaskWorkCapacity } from "../../src/domain.js"
import { workflowJournalEventVersion } from "../../src/journal-event-version.js"
import { intentRecordKey, JournalStore, memoryJournalStoreLayer, outcomeRecordKey } from "../../src/journal-store.js"
import {
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
  orchestratorCommitsFreshTaskClaimIntent: { task: ITFBigInt },
  orchestratorCommitsNextFreshTaskClaimIntent: {},
  restart: {},
  taskTrackerReportsCompatibleTargetClosureReplacement: {},
  taskTrackerReportsIncomparableTargetClosureMembership: {},
  taskTrackerReportsProvenAbsenceInTargetClosure: {}
} satisfies FrontierRecoveryReconstructionActionFields & {
  readonly initCapacityOneResponsibilityFirstProfile: Record<never, never>
}

const ModelTargetClosureReadEvidence = {
  completeness: Schema.Literal("Complete"),
  consistency: Schema.Literal("PotentiallyMixedTime"),
  explicitlyCoveredTaskIds: ITFSet(ITFBigInt),
  factFamily: Schema.Literal("TargetMembership"),
  freshness: Schema.Literal("FreshAtReadBoundary"),
  operationId: ITFBigInt,
  predecessorOperationIds: ITFSet(ITFBigInt),
  readShape: Schema.Literal("TargetClosureMembership"),
  revision: ITFBigInt,
  returnedTaskIds: ITFSet(ITFBigInt)
} as const

const ModelReconstructionGraphEvidence = ITFVariant({
  CompatibleReplacementGraphObservation: Schema.Struct(ModelTargetClosureReadEvidence),
  IncomparableMembershipGraphObservation: Schema.Struct(ModelTargetClosureReadEvidence),
  InitialReconstructionGraphObservation: Schema.Struct(ModelTargetClosureReadEvidence),
  ProvenAbsenceGraphObservation: Schema.Struct(ModelTargetClosureReadEvidence)
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

const sortedBigInts = (values: Iterable<bigint>): ReadonlyArray<bigint> =>
  [...values].sort((left, right) => left < right ? -1 : left > right ? 1 : 0)

type GraphProfile =
  | "CompatibleReplacement"
  | "IncomparableMembership"
  | "ProvenAbsence"

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
  & Partial<
    Pick<
      FrontierRecoveryReconstructionProjection,
      "graphKnowledge" | "responsibility" | "workflowHistory"
    >
  >

const modelGraphEvidenceFrom = (
  value: typeof ModelReconstructionGraphEvidence.Type
): FrontierRecoveryReconstructionProjection["graphEvidence"] => {
  const observationProfile = value.tag === "ProvenAbsenceGraphObservation"
    ? "ProvenAbsence" as const
    : value.tag === "IncomparableMembershipGraphObservation"
    ? "IncomparableMembership" as const
    : value.tag === "CompatibleReplacementGraphObservation"
    ? "CompatibleReplacement" as const
    : "InitialObservation" as const
  return {
    completeness: value.value.completeness,
    consistency: value.value.consistency,
    explicitlyCoveredModelTaskIds: sortedBigInts(
      value.value.explicitlyCoveredTaskIds
    ),
    factFamily: value.value.factFamily,
    freshness: value.value.freshness,
    modelOperationId: value.value.operationId,
    modelPredecessorOperationIds: sortedBigInts(
      value.value.predecessorOperationIds
    ),
    modelRevision: value.value.revision,
    observationProfile,
    readShape: value.value.readShape,
    returnedModelTaskIds: sortedBigInts(value.value.returnedTaskIds)
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

// This oracle derives an expected projection from M2 output and compares it
// after production reducers run. It never writes or substitutes production state.
const modelEvidenceMatchesExactProductionProjection = (
  profile: GraphProfile | undefined,
  graphEvidence: FrontierRecoveryReconstructionProjection["graphEvidence"],
  responsibleModelTaskIds: ReadonlyArray<bigint>,
  implementation: {
    readonly graphKnowledge?: {
      readonly targetClosures: ReadonlyArray<unknown>
    }
    readonly workflowHistory?: ReadonlyArray<{
      readonly event: unknown
      readonly key: string
      readonly position: number
      readonly runId: string
    }>
    readonly responsibility?: { readonly entries: ReadonlyArray<unknown> }
  }
): boolean => {
  if (
    implementation.graphKnowledge === undefined
    || implementation.responsibility === undefined
    || implementation.workflowHistory === undefined
  ) return false
  const allTasks = [
    "frontier-recovery-task-A",
    "frontier-recovery-task-B",
    "frontier-recovery-task-C",
    "frontier-recovery-task-D"
  ]
  const modelTaskName = (task: bigint): string => `frontier-recovery-task-${["A", "B", "C", "D"][Number(task)]}`
  const tasks = graphEvidence.returnedModelTaskIds.map(modelTaskName)
  const explicitlyCoveredTaskIds = graphEvidence.explicitlyCoveredModelTaskIds.map(modelTaskName)
  const predecessorOperationIds = graphEvidence.modelPredecessorOperationIds.map(
    (operation) => `frontier-recovery-graph-observation-${operation}`
  )
  const target = "frontier-recovery-reconstruction-target"
  const runId = "frontier-recovery-reconstruction-run"
  const initialGraphOperationId = OperationId.make(
    "frontier-recovery-graph-observation-0"
  )
  const operationZero = {
    _tag: "ReadTrackerGraph",
    operationId: "frontier-recovery-graph-observation-0",
    predecessorOperationIds: [],
    readShape: {
      _tag: "TargetClosureMembership",
      explicitlyCoveredTaskIds: []
    },
    target
  }
  const initialHistory = [
    {
      event: {
        _tag: "TrackerGraphObservationIntentRecorded",
        operation: operationZero,
        version: workflowJournalEventVersion
      },
      key: intentRecordKey(initialGraphOperationId),
      position: 1,
      runId
    },
    {
      event: {
        _tag: "TrackerGraphOutcomeObserved",
        operationId: "frontier-recovery-graph-observation-0",
        outcome: {
          _tag: "TrackerGraphObserved",
          revision: "frontier-recovery-revision-0",
          taskIds: allTasks
        },
        version: workflowJournalEventVersion
      },
      key: outcomeRecordKey(initialGraphOperationId),
      position: 2,
      runId
    }
  ]
  const observationZero = {
    _tag: "TaskTrackerTargetClosureObserved",
    completeness: "Complete",
    consistency: "PotentiallyMixedTime",
    explicitlyCoveredTaskIds: [],
    factFamilies: ["TargetMembership"],
    freshness: "FreshAtReadBoundary",
    observedAt: 2,
    operationId: "frontier-recovery-graph-observation-0",
    provenAbsentTaskIds: [],
    revision: "frontier-recovery-revision-0",
    target,
    taskIds: allTasks
  }
  if (profile === undefined) {
    const claimSubjects = responsibleModelTaskIds.map((modelTask, index) => {
      const taskName = modelTaskName(modelTask)
      const operationIdentity = modelTask === 0n ? 1 : 3
      const operationId = `frontier-recovery-claim-operation-${operationIdentity}`
      const brandedOperationId = OperationId.make(operationId)
      const acquisition = {
        operationId,
        owner: "frontier-recovery-owner",
        taskId: taskName,
        token: `frontier-recovery-token-${modelTask}`
      }
      return {
        acquisition,
        record: {
          event: {
            _tag: "TaskClaimAcquisitionIntended",
            operation: {
              _tag: "AcquireTaskClaim",
              acquisition,
              predecessorOperationIds: [
                "frontier-recovery-graph-observation-0"
              ]
            },
            version: workflowJournalEventVersion
          },
          key: intentRecordKey(brandedOperationId),
          position: index + 3,
          runId
        }
      }
    })
    const expectedResponsibility = {
      entries: claimSubjects.map(({ acquisition }, index) => ({
        _tag: "TaskClaimResponsibility",
        acquisition,
        beganAt: index + 3,
        taskId: acquisition.taskId
      }))
    }
    return JSON.stringify(implementation.workflowHistory)
        === JSON.stringify(
          [
            ...initialHistory,
            ...claimSubjects.map(({ record }) => record)
          ]
        )
      && JSON.stringify(implementation.graphKnowledge)
        === JSON.stringify({ targetClosures: [observationZero] })
      && JSON.stringify(implementation.responsibility)
        === JSON.stringify(expectedResponsibility)
  }
  const operationTwo = {
    _tag: "ReadTrackerGraph",
    operationId: `frontier-recovery-graph-observation-${graphEvidence.modelOperationId}`,
    predecessorOperationIds,
    readShape: {
      _tag: graphEvidence.readShape,
      explicitlyCoveredTaskIds
    },
    target
  }
  const replacementGraphOperationId = OperationId.make(
    operationTwo.operationId
  )
  const expectedHistory = [
    ...initialHistory,
    {
      event: {
        _tag: "TrackerGraphObservationIntentRecorded",
        operation: operationTwo,
        version: workflowJournalEventVersion
      },
      key: intentRecordKey(replacementGraphOperationId),
      position: 3,
      runId
    },
    {
      event: {
        _tag: "TrackerGraphOutcomeObserved",
        operationId: `frontier-recovery-graph-observation-${graphEvidence.modelOperationId}`,
        outcome: {
          _tag: "TrackerGraphObserved",
          revision: `frontier-recovery-revision-${graphEvidence.modelRevision}`,
          taskIds: tasks
        },
        version: workflowJournalEventVersion
      },
      key: outcomeRecordKey(replacementGraphOperationId),
      position: 4,
      runId
    }
  ]
  const observationTwo = {
    _tag: "TaskTrackerTargetClosureObserved",
    completeness: graphEvidence.completeness,
    consistency: graphEvidence.consistency,
    explicitlyCoveredTaskIds,
    factFamilies: [graphEvidence.factFamily],
    freshness: graphEvidence.freshness,
    observedAt: 4,
    operationId: `frontier-recovery-graph-observation-${graphEvidence.modelOperationId}`,
    provenAbsentTaskIds: explicitlyCoveredTaskIds.filter(
      (taskId) => !tasks.includes(taskId)
    ),
    revision: `frontier-recovery-revision-${graphEvidence.modelRevision}`,
    target,
    taskIds: tasks
  }
  const expectedGraphKnowledge = {
    targetClosures: profile === "IncomparableMembership"
      ? [{
        _tag: "TaskTrackerTargetClosureKnowledgeConflict",
        observations: [observationZero, observationTwo],
        target
      }]
      : [observationTwo]
  }
  return JSON.stringify(implementation.workflowHistory)
      === JSON.stringify(expectedHistory)
    && JSON.stringify(implementation.graphKnowledge)
      === JSON.stringify(expectedGraphKnowledge)
    && JSON.stringify(implementation.responsibility)
      === JSON.stringify({ entries: [] })
}

const makeReconstructionDriver = (
  configuredCapacity: 1 | 2,
  initiallyResponsibleTask?: 0 | 2
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
        Ref.get(controlsRef).pipe(
          Effect.flatMap((current) =>
            current.init().pipe(
              Effect.andThen(
                initiallyResponsibleTask === undefined
                  ? Effect.void
                  : current.orchestratorCommitsFreshTaskClaimIntent(
                    FrontierRecoveryModelTaskId.make(
                      BigInt(initiallyResponsibleTask)
                    )
                  )
              )
            )
          )
        )
      return {
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
      )
      const graphEvidence = modelGraphEvidenceFrom(
        state.reconstructionGraphEvidence
      )
      const graphProfile = graphProfileFrom(graphEvidence)
      const selector = state.selectorProjection
      const frontierModelTaskIds = sortedBigInts(selector.frontierTaskIds)
      const admittedModelTaskIds = sortedBigInts(selector.admittedTaskIds)
      const transitionTagFor = (taskId: bigint): string =>
        selector.transitionTags.get(taskId) ?? "MissingModelTransition"
      return {
        admissionCapacity: selector.capacity,
        admittedModelOperationIds: admittedModelTaskIds.map((taskId) => selector.operationIds.get(taskId) ?? -2n),
        admittedModelTaskIds,
        admittedTransitionTags: admittedModelTaskIds.map(transitionTagFor),
        admissionExplanations: [...selector.explanations]
          .map(({ tag, taskId, wakeCondition }) => ({
            modelTaskId: taskId,
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
        ),
        coordinatorRunning: state.coordinator.running,
        frontierModelOperationIds: frontierModelTaskIds.map((taskId) => selector.operationIds.get(taskId) ?? -2n),
        frontierModelTaskIds,
        frontierTransitionTags: frontierModelTaskIds.map(transitionTagFor),
        graphEvidence,
        knownModelTaskIds: graphProfile === "ProvenAbsence"
          ? graphEvidence.returnedModelTaskIds
          : sortedBigInts(state.knowledge.keys()),
        occupiedModelTaskIds: sortedBigInts(selector.occupiedTaskIds),
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
  implementation.graphKnowledge !== undefined
  && implementation.responsibility !== undefined
  && implementation.workflowHistory !== undefined
  && model.admissionCapacity === implementation.admissionCapacity
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
  && modelEvidenceMatchesExactProductionProjection(
    graphProfileFrom(model.graphEvidence),
    model.graphEvidence,
    model.responsibleModelTaskIds,
    implementation
  )

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
