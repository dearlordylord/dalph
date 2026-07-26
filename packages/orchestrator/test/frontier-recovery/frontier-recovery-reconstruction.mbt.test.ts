import { it } from "@effect/vitest"
import { defineDriver, ITFBigInt, ITFMap, ITFSet, ITFVariant, stateCheck } from "@firfi/quint-connect/effect"
import { quintIt } from "@firfi/quint-connect/vitest"
import { Context, Effect, Layer, Ref, Schema } from "effect"
import { TaskWorkCapacity } from "../../src/domain.js"
import { JournalStore, memoryJournalStoreLayer } from "../../src/journal-store.js"
import type { FrontierRecoveryReconstructionActionFields } from "./frontier-recovery-conformance.js"
import {
  type FrontierRecoveryReconstructionProjection,
  makeFrontierRecoveryReconstructionControls
} from "./frontier-recovery-reconstruction.js"

const actionSchema = {
  commitFirstIntent: { task: ITFBigInt },
  crash: {},
  init: {},
  observeCompatibleReplacement: {},
  observeIncomparableMembership: {},
  observeProvenAbsence: {},
  reconstructionStep: {},
  restart: {}
} satisfies FrontierRecoveryReconstructionActionFields

const ModelReconstructionGraphEvidence = ITFVariant({
  CompatibleReplacementGraphObservation: Schema.Struct({
    returnedTaskIds: ITFSet(ITFBigInt)
  }),
  IncomparableMembershipGraphObservation: Schema.Struct({
    predecessorOperationIds: ITFSet(ITFBigInt),
    returnedTaskIds: ITFSet(ITFBigInt)
  }),
  InitialReconstructionGraphObservation: Schema.Struct({
    returnedTaskIds: ITFSet(ITFBigInt)
  }),
  ProvenAbsenceGraphObservation: Schema.Struct({
    explicitlyCoveredTaskIds: ITFSet(ITFBigInt),
    returnedTaskIds: ITFSet(ITFBigInt)
  })
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
      explanationTags: ITFSet(Schema.String),
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
    | "admissionExplanationTags"
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
  const returnedModelTaskIds = sortedBigInts(value.value.returnedTaskIds)
  return value.tag === "ProvenAbsenceGraphObservation"
    ? {
      disposition: "ProvenAbsence",
      explicitlyCoveredModelTaskIds: sortedBigInts(
        value.value.explicitlyCoveredTaskIds
      ),
      returnedModelTaskIds
    }
    : value.tag === "IncomparableMembershipGraphObservation"
    ? {
      disposition: "IncomparableMembership",
      predecessorModelOperationIds: sortedBigInts(
        value.value.predecessorOperationIds
      ),
      returnedModelTaskIds
    }
    : value.tag === "CompatibleReplacementGraphObservation"
    ? { disposition: "CompatibleReplacement", returnedModelTaskIds }
    : { disposition: "InitialObservation", returnedModelTaskIds }
}

const graphProfileFrom = (
  evidence: FrontierRecoveryReconstructionProjection["graphEvidence"]
): GraphProfile | undefined =>
  evidence.disposition === "ProvenAbsence"
    ? "ProvenAbsence"
    : evidence.disposition === "IncomparableMembership"
    ? "IncomparableMembership"
    : evidence.disposition === "CompatibleReplacement"
    ? "CompatibleReplacement"
    : undefined

const graphEvidenceMatches = (
  left: FrontierRecoveryReconstructionProjection["graphEvidence"],
  right: FrontierRecoveryReconstructionProjection["graphEvidence"]
): boolean =>
  left.disposition === right.disposition
  && left.returnedModelTaskIds.join(",")
    === right.returnedModelTaskIds.join(",")
  && (
    left.disposition !== "ProvenAbsence"
    || (
      right.disposition === "ProvenAbsence"
      && left.explicitlyCoveredModelTaskIds.join(",")
        === right.explicitlyCoveredModelTaskIds.join(",")
    )
  )
  && (
    left.disposition !== "IncomparableMembership"
    || (
      right.disposition === "IncomparableMembership"
      && left.predecessorModelOperationIds.join(",")
        === right.predecessorModelOperationIds.join(",")
    )
  )

const exactGraphProfileMatches = (
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
  const explicitlyCoveredTaskIds = graphEvidence.disposition
      === "ProvenAbsence"
    ? graphEvidence.explicitlyCoveredModelTaskIds.map(modelTaskName)
    : []
  const predecessorOperationIds = graphEvidence.disposition
      === "IncomparableMembership"
    ? graphEvidence.predecessorModelOperationIds.map((operation) => `frontier-recovery-graph-observation-${operation}`)
    : []
  const target = "frontier-recovery-reconstruction-target"
  const runId = "frontier-recovery-reconstruction-run"
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
        version: 4
      },
      key: "operation:frontier-recovery-graph-observation-0:intent",
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
        version: 4
      },
      key: "operation:frontier-recovery-graph-observation-0:outcome",
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
            version: 4
          },
          key: `operation:${operationId}:intent`,
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
    operationId: "frontier-recovery-graph-observation-2",
    predecessorOperationIds,
    readShape: {
      _tag: "TargetClosureMembership",
      explicitlyCoveredTaskIds
    },
    target
  }
  const expectedHistory = [
    ...initialHistory,
    {
      event: {
        _tag: "TrackerGraphObservationIntentRecorded",
        operation: operationTwo,
        version: 4
      },
      key: "operation:frontier-recovery-graph-observation-2:intent",
      position: 3,
      runId
    },
    {
      event: {
        _tag: "TrackerGraphOutcomeObserved",
        operationId: "frontier-recovery-graph-observation-2",
        outcome: {
          _tag: "TrackerGraphObserved",
          revision: "frontier-recovery-revision-1",
          taskIds: tasks
        },
        version: 4
      },
      key: "operation:frontier-recovery-graph-observation-2:outcome",
      position: 4,
      runId
    }
  ]
  const observationTwo = {
    _tag: "TaskTrackerTargetClosureObserved",
    completeness: "Complete",
    consistency: "PotentiallyMixedTime",
    explicitlyCoveredTaskIds,
    factFamilies: ["TargetMembership"],
    freshness: "FreshAtReadBoundary",
    observedAt: 4,
    operationId: "frontier-recovery-graph-observation-2",
    provenAbsentTaskIds: profile === "ProvenAbsence"
      ? ["frontier-recovery-task-B"]
      : [],
    revision: "frontier-recovery-revision-1",
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

const reconstructionDriver = defineDriver(
  actionSchema,
  () => {
    const services = Effect.runSync(
      Layer.build(memoryJournalStoreLayer).pipe(Effect.scoped)
    )
    const journal = Context.get(services, JournalStore)
    const controls = Effect.runSync(
      makeFrontierRecoveryReconstructionControls({
        capacity: TaskWorkCapacity.make(2),
        coordinatorRunning: true,
        journal
      }).pipe(Effect.orDie)
    )
    const controlsRef = Effect.runSync(Ref.make(controls))
    return {
      commitFirstIntent: ({ task }) =>
        Ref.get(controlsRef).pipe(
          Effect.flatMap((current) => current.commitFirstIntent(task))
        ),
      crash: () =>
        Ref.get(controlsRef).pipe(
          Effect.flatMap((current) => current.crash())
        ),
      getState: () =>
        Ref.get(controlsRef).pipe(
          Effect.flatMap((current) => current.getState())
        ),
      init: () =>
        Ref.get(controlsRef).pipe(
          Effect.flatMap((current) => current.init())
        ),
      observeCompatibleReplacement: () =>
        Ref.get(controlsRef).pipe(
          Effect.flatMap((current) => current.observeCompatibleReplacement())
        ),
      observeIncomparableMembership: () =>
        Ref.get(controlsRef).pipe(
          Effect.flatMap((current) => current.observeIncomparableMembership())
        ),
      observeProvenAbsence: () =>
        Ref.get(controlsRef).pipe(
          Effect.flatMap((current) => current.observeProvenAbsence())
        ),
      reconstructionStep: () =>
        Ref.get(controlsRef).pipe(
          Effect.flatMap((current) => current.reconstructionStep())
        ),
      restart: () =>
        Effect.gen(function*() {
          const freshControls = yield* makeFrontierRecoveryReconstructionControls({
            capacity: TaskWorkCapacity.make(2),
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

const decodeReconstructionModelState = (raw: unknown) =>
  Schema.decodeUnknownEffect(ModelProjection)(raw).pipe(
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
        admissionExplanationTags: [...selector.explanationTags].sort(),
        admissionReservedModelTaskIds: sortedBigInts(
          selector.reservationTaskIds
        ),
        coordinatorRunning: state.coordinator.running,
        frontierModelOperationIds: frontierModelTaskIds.map((taskId) => selector.operationIds.get(taskId) ?? -2n),
        frontierModelTaskIds,
        frontierTransitionTags: frontierModelTaskIds.map(transitionTagFor),
        graphEvidence,
        knownModelTaskIds: sortedBigInts(state.knowledge.keys()),
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
  && model.admissionExplanationTags.join(",")
    === implementation.admissionExplanationTags.join(",")
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
  && exactGraphProfileMatches(
    graphProfileFrom(model.graphEvidence),
    model.graphEvidence,
    model.responsibleModelTaskIds,
    implementation
  )

const reconstructionStateCheck = stateCheck(
  decodeReconstructionModelState,
  compareReconstructionState
)

quintIt(it.effect, "replays the M2 reconstruction slice through production reducers", {
  backend: "typescript",
  driverFactory: reconstructionDriver,
  maxSteps: 2,
  nTraces: 8,
  seed: "144",
  spec: "specs/frontierRecovery.qnt",
  step: "reconstructionStep",
  stateCheck: reconstructionStateCheck
}, 30_000)

for (
  const { action: profile, seed } of [
    { action: "observeProvenAbsence", seed: "145" },
    { action: "observeIncomparableMembership", seed: "146" },
    { action: "observeCompatibleReplacement", seed: "147" }
  ] as const
) {
  quintIt(it.effect, `replays M2 ${profile} through the production graph reducer`, {
    backend: "typescript",
    driverFactory: reconstructionDriver,
    maxSteps: 2,
    nTraces: 2,
    seed,
    spec: "specs/frontierRecovery.qnt",
    step: profile,
    stateCheck: reconstructionStateCheck
  }, 30_000)
}
