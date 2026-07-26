import { Schema } from "effect"

export const PROJECTION_VERSION = 3 as const

export type TraceKind = "sampled" | "restart" | "counterexample"

export interface ArtifactProvenance {
  readonly dalphRevision: string
  readonly init: string
  readonly modelRevision: string
  readonly modelSha256: string
  readonly projectionVersion: typeof PROJECTION_VERSION
  readonly quintVersion: "0.32.0"
  readonly rendererVersion: "effect-analyzer@2.1.0"
  readonly seed: string
  readonly step: string
  readonly traceKind: TraceKind
}

export interface DecisionEntry {
  readonly modelOperationId: string
  readonly modelTaskId: string
  readonly transitionTag: string
}

export interface AdmissionExplanation {
  readonly modelTaskId: string
  readonly tag: "CapacityWait"
  readonly wakeCondition: "CapacityReleasedOrReconstructedStateChanged"
}

export interface MbtComparableProjection {
  readonly admissionCapacity: string
  readonly admittedModelOperationIds: ReadonlyArray<string>
  readonly admittedModelTaskIds: ReadonlyArray<string>
  readonly admittedTransitionTags: ReadonlyArray<string>
  readonly admissionExplanations: ReadonlyArray<AdmissionExplanation>
  readonly admissionReservedModelTaskIds: ReadonlyArray<string>
  readonly coordinatorRunning: boolean
  readonly frontierModelOperationIds: ReadonlyArray<string>
  readonly frontierModelTaskIds: ReadonlyArray<string>
  readonly frontierTransitionTags: ReadonlyArray<string>
  readonly occupiedModelTaskIds: ReadonlyArray<string>
}

export interface FrameComparison {
  readonly firstDivergentField?: keyof MbtComparableProjection
  readonly status: "Match" | "Mismatch" | "NotSupplied"
}

export interface NormalizedFrame {
  readonly action: string
  readonly admission: ReadonlyArray<DecisionEntry>
  readonly capacity: string
  readonly comparison: FrameComparison
  readonly coordinatorStatus: "Running" | "Crashed"
  readonly explanations: ReadonlyArray<AdmissionExplanation>
  readonly frontier: ReadonlyArray<DecisionEntry>
  readonly occupiedModelTaskIds: ReadonlyArray<string>
  readonly pickedModelTaskId?: string
  readonly position: `S${number}`
  readonly rawItfState: Readonly<Record<string, unknown>>
  readonly reservedModelTaskIds: ReadonlyArray<string>
  readonly step: number
}

export interface NormalizedTrace {
  readonly fidelity: {
    readonly decodedFields: ReadonlyArray<string>
    readonly projectedAwayFields: ReadonlyArray<string>
    readonly unsupportedInputs: ReadonlyArray<string>
  }
  readonly frames: ReadonlyArray<NormalizedFrame>
  readonly provenance: ArtifactProvenance
}

export type TraceDecodeReason =
  | "MalformedIdentity"
  | "LossyInteger"
  | "MissingDecisionField"
  | "UnknownAction"
  | "InvalidItf"
  | "ProjectionMismatch"

/**
 * The artifact boundary refused to guess after encountering an unsupported,
 * incomplete, or lossy Quint trace representation.
 */
export class TraceDecodeError extends Schema.TaggedErrorClass<TraceDecodeError>()(
  "QuintTraceView.TraceDecodeError",
  {
    detail: Schema.String,
    reason: Schema.Literals([
      "MalformedIdentity",
      "LossyInteger",
      "MissingDecisionField",
      "UnknownAction",
      "InvalidItf",
      "ProjectionMismatch"
    ])
  }
) {}

const BigIntWire = Schema.Struct({ "#bigint": Schema.String })
const SetOfBigIntWire = Schema.Struct({
  "#set": Schema.Array(BigIntWire)
})
const ExplanationWire = Schema.Struct({
  tag: Schema.Literal("CapacityWait"),
  taskId: BigIntWire,
  wakeCondition: Schema.Literal(
    "CapacityReleasedOrReconstructedStateChanged"
  )
})
const SelectorProjectionWire = Schema.Struct({
  admittedTaskIds: SetOfBigIntWire,
  capacity: BigIntWire,
  explanations: Schema.Struct({
    "#set": Schema.Array(ExplanationWire)
  }),
  frontierTaskIds: SetOfBigIntWire,
  occupiedTaskIds: SetOfBigIntWire,
  operationIds: Schema.Struct({
    "#map": Schema.Array(Schema.Tuple([BigIntWire, BigIntWire]))
  }),
  reservationTaskIds: SetOfBigIntWire,
  transitionTags: Schema.Struct({
    "#map": Schema.Array(Schema.Tuple([BigIntWire, Schema.String]))
  })
})
const DisplayedModelStateWire = Schema.Struct({
  coordinator: Schema.Struct({ running: Schema.Boolean }),
  selectorProjection: SelectorProjectionWire
})
const ItfStateWire = Schema.Record(Schema.String, Schema.Unknown)
const ItfEnvelopeWire = Schema.Struct({
  "#meta": Schema.Struct({
    format: Schema.Literal("ITF"),
    source: Schema.String,
    status: Schema.String
  }),
  states: Schema.Array(ItfStateWire),
  vars: Schema.Array(Schema.String)
})

const reconstructionActions = new Set([
  "init",
  "commitFirstIntent",
  "crash",
  "observeCompatibleReplacement",
  "observeIncomparableMembership",
  "observeProvenAbsence",
  "reconstructionStep",
  "restart"
])
const counterexampleActions = new Set([
  ...reconstructionActions,
  "weakenedCapacityStep"
])
const modelTaskIdentities = new Set(["0", "1", "2", "3"])
const displayedFieldNames = [
  "#meta.index",
  "mbt::actionTaken",
  "mbt::nondetPicks.task",
  "state.coordinator.running",
  "state.selectorProjection.capacity",
  "state.selectorProjection.frontierTaskIds",
  "state.selectorProjection.admittedTaskIds",
  "state.selectorProjection.operationIds",
  "state.selectorProjection.transitionTags",
  "state.selectorProjection.explanations",
  "state.selectorProjection.reservationTaskIds",
  "state.selectorProjection.occupiedTaskIds"
] as const
const comparableFields: ReadonlyArray<keyof MbtComparableProjection> = [
  "admissionCapacity",
  "admittedModelOperationIds",
  "admittedModelTaskIds",
  "admittedTransitionTags",
  "admissionExplanations",
  "admissionReservedModelTaskIds",
  "coordinatorRunning",
  "frontierModelOperationIds",
  "frontierModelTaskIds",
  "frontierTransitionTags",
  "occupiedModelTaskIds"
]

const decodeSync = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  input: unknown,
  detail: string
): S["Type"] => {
  try {
    return Schema.decodeUnknownSync(schema)(input)
  } catch {
    throw new TraceDecodeError({ detail, reason: "MissingDecisionField" })
  }
}

const exactInteger = (
  wire: typeof BigIntWire.Type,
  identity: "operation" | "task" | "value"
): string => {
  if (!/^-?(0|[1-9][0-9]*)$/.test(wire["#bigint"])) {
    throw new TraceDecodeError({
      detail: `${identity} is not an exact ITF integer: ${wire["#bigint"]}`,
      reason: "LossyInteger"
    })
  }
  const normalized = BigInt(wire["#bigint"]).toString()
  if (identity === "task" && !modelTaskIdentities.has(normalized)) {
    throw new TraceDecodeError({
      detail: `unknown bounded model task identity ${normalized}`,
      reason: "MalformedIdentity"
    })
  }
  if (identity === "operation" && BigInt(normalized) < -1n) {
    throw new TraceDecodeError({
      detail: `invalid model operation identity ${normalized}`,
      reason: "MalformedIdentity"
    })
  }
  return normalized
}

const sortedIdentities = (
  wire: typeof SetOfBigIntWire.Type
): ReadonlyArray<string> =>
  wire["#set"]
    .map((identity) => exactInteger(identity, "task"))
    .sort((left, right) => Number(left) - Number(right))

const requiredStateValue = (
  rawState: Readonly<Record<string, unknown>>,
  key: string
): unknown => {
  if (!(key in rawState)) {
    throw new TraceDecodeError({
      detail: `missing ${key}`,
      reason: "MissingDecisionField"
    })
  }
  return rawState[key]
}

const stateModelValue = (
  rawState: Readonly<Record<string, unknown>>
): unknown => {
  const candidates = Object.entries(rawState)
    .filter(([key]) => key.endsWith("::state"))
  if (candidates.length !== 1) {
    throw new TraceDecodeError({
      detail: `expected one imported model state, found ${candidates.length}`,
      reason: "InvalidItf"
    })
  }
  return candidates[0]?.[1]
}

const pickedTaskFrom = (
  rawState: Readonly<Record<string, unknown>>
): string | undefined => {
  const picks = requiredStateValue(rawState, "mbt::nondetPicks")
  if (typeof picks !== "object" || picks === null || Array.isArray(picks)) {
    throw new TraceDecodeError({
      detail: "mbt::nondetPicks is not a record",
      reason: "InvalidItf"
    })
  }
  if (!("task" in picks)) return undefined
  if (
    typeof picks.task === "object"
    && picks.task !== null
    && !Array.isArray(picks.task)
    && "tag" in picks.task
  ) {
    if (picks.task.tag === "None") return undefined
    if (picks.task.tag === "Some" && "value" in picks.task) {
      return exactInteger(
        decodeSync(
          BigIntWire,
          picks.task.value,
          "malformed picked task identity"
        ),
        "task"
      )
    }
  }
  return exactInteger(
    decodeSync(BigIntWire, picks.task, "malformed picked task identity"),
    "task"
  )
}

const actionFrom = (
  rawState: Readonly<Record<string, unknown>>,
  traceKind: TraceKind
): string => {
  const action = requiredStateValue(rawState, "mbt::actionTaken")
  const allowed = traceKind === "counterexample"
    ? counterexampleActions
    : reconstructionActions
  if (typeof action !== "string" || !allowed.has(action)) {
    throw new TraceDecodeError({
      detail: `unknown ${traceKind} trace action ${String(action)}`,
      reason: "UnknownAction"
    })
  }
  return action
}

const indexFrom = (
  rawState: Readonly<Record<string, unknown>>,
  expected: number
): number => {
  const metadata = requiredStateValue(rawState, "#meta")
  if (
    typeof metadata !== "object"
    || metadata === null
    || Array.isArray(metadata)
    || !("index" in metadata)
    || typeof metadata.index !== "number"
    || !Number.isSafeInteger(metadata.index)
  ) {
    throw new TraceDecodeError({
      detail: "state index is not a safe integer",
      reason: "LossyInteger"
    })
  }
  if (metadata.index !== expected) {
    throw new TraceDecodeError({
      detail: `state index ${metadata.index} does not match position ${expected}`,
      reason: "InvalidItf"
    })
  }
  return metadata.index
}

const mapsFrom = (
  selector: typeof SelectorProjectionWire.Type
): {
  readonly operationIds: ReadonlyMap<string, string>
  readonly transitionTags: ReadonlyMap<string, string>
} => {
  const operationIds = new Map(
    selector.operationIds["#map"].map(([task, operation]) => [
      exactInteger(task, "task"),
      exactInteger(operation, "operation")
    ])
  )
  const transitionTags = new Map(
    selector.transitionTags["#map"].map(([task, tag]) => [
      exactInteger(task, "task"),
      tag
    ])
  )
  if (operationIds.size !== 4 || transitionTags.size !== 4) {
    throw new TraceDecodeError({
      detail:
        "operation and transition maps must contain each bounded model task exactly once",
      reason: "MalformedIdentity"
    })
  }
  return { operationIds, transitionTags }
}

const decisionEntries = (
  taskIds: ReadonlyArray<string>,
  operationIds: ReadonlyMap<string, string>,
  transitionTags: ReadonlyMap<string, string>
): ReadonlyArray<DecisionEntry> =>
  taskIds.map((modelTaskId) => {
    const modelOperationId = operationIds.get(modelTaskId)
    const transitionTag = transitionTags.get(modelTaskId)
    if (modelOperationId === undefined || transitionTag === undefined) {
      throw new TraceDecodeError({
        detail: `missing decision mapping for model task ${modelTaskId}`,
        reason: "MissingDecisionField"
      })
    }
    return { modelOperationId, modelTaskId, transitionTag }
  })

const explanationsFrom = (
  selector: typeof SelectorProjectionWire.Type
): ReadonlyArray<AdmissionExplanation> =>
  selector.explanations["#set"]
    .map(({ tag, taskId, wakeCondition }) => ({
      modelTaskId: exactInteger(taskId, "task"),
      tag,
      wakeCondition
    }))
    .sort((left, right) => Number(left.modelTaskId) - Number(right.modelTaskId))

export const toMbtComparable = (
  frame: Omit<NormalizedFrame, "comparison">
): MbtComparableProjection => ({
  admissionCapacity: frame.capacity,
  admittedModelOperationIds:
    frame.admission.map(({ modelOperationId }) => modelOperationId),
  admittedModelTaskIds:
    frame.admission.map(({ modelTaskId }) => modelTaskId),
  admittedTransitionTags:
    frame.admission.map(({ transitionTag }) => transitionTag),
  admissionExplanations: frame.explanations,
  admissionReservedModelTaskIds: frame.reservedModelTaskIds,
  coordinatorRunning: frame.coordinatorStatus === "Running",
  frontierModelOperationIds:
    frame.frontier.map(({ modelOperationId }) => modelOperationId),
  frontierModelTaskIds:
    frame.frontier.map(({ modelTaskId }) => modelTaskId),
  frontierTransitionTags:
    frame.frontier.map(({ transitionTag }) => transitionTag),
  occupiedModelTaskIds: frame.occupiedModelTaskIds
})

const comparisonFrom = (
  frame: Omit<NormalizedFrame, "comparison">,
  implementation: MbtComparableProjection | undefined
): FrameComparison => {
  if (implementation === undefined) return { status: "NotSupplied" }
  const model = toMbtComparable(frame)
  const firstDivergentField = comparableFields.find(
    (field) =>
      JSON.stringify(model[field]) !== JSON.stringify(implementation[field])
  )
  return firstDivergentField === undefined
    ? { status: "Match" }
    : { firstDivergentField, status: "Mismatch" }
}

const frameFrom = (
  rawState: Readonly<Record<string, unknown>>,
  index: number,
  traceKind: TraceKind,
  implementation: MbtComparableProjection | undefined
): NormalizedFrame => {
  const step = indexFrom(rawState, index)
  const state = decodeSync(
    DisplayedModelStateWire,
    stateModelValue(rawState),
    "a decision-bearing model field is missing or malformed"
  )
  const selector = state.selectorProjection
  const frontierTaskIds = sortedIdentities(selector.frontierTaskIds)
  const admittedTaskIds = sortedIdentities(selector.admittedTaskIds)
  const { operationIds, transitionTags } = mapsFrom(selector)
  const pickedModelTaskId = pickedTaskFrom(rawState)
  const frame: Omit<NormalizedFrame, "comparison"> = {
    action: actionFrom(rawState, traceKind),
    admission: decisionEntries(
      admittedTaskIds,
      operationIds,
      transitionTags
    ),
    capacity: exactInteger(selector.capacity, "value"),
    coordinatorStatus:
      state.coordinator.running ? "Running" as const : "Crashed" as const,
    explanations: explanationsFrom(selector),
    frontier: decisionEntries(
      frontierTaskIds,
      operationIds,
      transitionTags
    ),
    occupiedModelTaskIds: sortedIdentities(selector.occupiedTaskIds),
    ...(pickedModelTaskId === undefined ? {} : { pickedModelTaskId }),
    position: `S${step}` as const,
    rawItfState: rawState,
    reservedModelTaskIds: sortedIdentities(selector.reservationTaskIds),
    step
  }
  return {
    ...frame,
    comparison: comparisonFrom(frame, implementation)
  }
}

export const decodeTrace = (
  input: unknown,
  provenance: ArtifactProvenance,
  implementation: ReadonlyArray<MbtComparableProjection> = []
): NormalizedTrace => {
  let envelope: typeof ItfEnvelopeWire.Type
  try {
    envelope = Schema.decodeUnknownSync(ItfEnvelopeWire)(input)
  } catch {
    throw new TraceDecodeError({
      detail: "invalid ITF envelope",
      reason: "InvalidItf"
    })
  }
  if (envelope["#meta"].status !== "ok" && provenance.traceKind !== "counterexample") {
    throw new TraceDecodeError({
      detail: `non-counterexample trace status ${envelope["#meta"].status}`,
      reason: "InvalidItf"
    })
  }
  if (
    implementation.length !== 0
    && implementation.length !== envelope.states.length
  ) {
    throw new TraceDecodeError({
      detail: "implementation projection count does not equal ITF state count",
      reason: "ProjectionMismatch"
    })
  }
  return {
    fidelity: {
      decodedFields: displayedFieldNames,
      projectedAwayFields: [
        "authority",
        "control epochs",
        "effect identity sets and counters",
        "full knowledge",
        "request identity sets and counters",
        "workflow fields other than the exported selector projection"
      ],
      unsupportedInputs: [
        "actions outside the closed reconstruction/counterexample inventories",
        "model task identities outside 0..3",
        "non-ITF or non-exact integer encodings",
        "selector projections without task-specific explanations",
        "traces containing more than one imported ::state variable"
      ]
    },
    frames: envelope.states.map((rawState, index) =>
      frameFrom(rawState, index, provenance.traceKind, implementation[index])
    ),
    provenance
  }
}
