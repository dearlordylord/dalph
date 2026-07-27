import { Effect, Schema } from "effect"

export const PROJECTION_VERSION = 5 as const

export const TraceKindSchema = Schema.Literals([
  "activation",
  "sampled",
  "restart",
  "counterexample",
  "story-crash-after-intent",
  "story-pause-independent",
  "story-pause-resume",
  "story-success",
  "story-lost-worktree",
  "story-blocker",
  "story-claim-loss",
  "story-git-rewrite",
  "story-external-completion",
  "explore-claim-c-then-claim-loss",
  "explore-claim-loss-then-claim-c",
  "explore-claim-c-then-git-rewrite",
  "explore-git-rewrite-then-claim-c",
  "explore-claim-c-then-authority-conflict",
  "explore-authority-conflict-then-claim-c"
])
export type TraceKind = typeof TraceKindSchema.Type

/** Identifies one bounded Quint model task, not a Dalph tracker task. */
export const ModelTaskId = Schema.Literals(["0", "1", "2", "3"]).pipe(
  Schema.brand("ModelTaskId")
)
export type ModelTaskId = typeof ModelTaskId.Type

/** Identifies one durable modeled workflow operation. */
export const ModelOperationId = Schema.String.check(
  Schema.isPattern(/^(0|[1-9][0-9]*)$/)
).pipe(Schema.brand("ModelOperationId"))
export type ModelOperationId = typeof ModelOperationId.Type

/** Carries the model's exact admission capacity without JavaScript number conversion. */
export const AdmissionCapacity = Schema.String.check(
  Schema.isPattern(/^(0|[1-9][0-9]*)$/)
).pipe(Schema.brand("AdmissionCapacity"))
export type AdmissionCapacity = typeof AdmissionCapacity.Type

/** Identifies one retained trace frame ordinal. */
export const TraceStep = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0)
).pipe(Schema.brand("TraceStep"))
export type TraceStep = typeof TraceStep.Type

/** Displays one retained trace frame without implying a model state identity. */
export const TracePosition = Schema.String.check(
  Schema.isPattern(/^S(0|[1-9][0-9]*)$/)
).pipe(Schema.brand("TracePosition"))
export type TracePosition = typeof TracePosition.Type

/** Identifies the Dalph source revision used to produce retained evidence. */
const DalphRevision = Schema.NonEmptyString.pipe(
  Schema.brand("DalphRevision")
)
/** Identifies the Quint model revision, independently of Dalph package lineage. */
const ModelRevision = Schema.NonEmptyString.pipe(
  Schema.brand("ModelRevision")
)
const ModelSha256 = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{64}$/)
).pipe(Schema.brand("ModelSha256"))
const TraceSeed = Schema.NonEmptyString.pipe(Schema.brand("TraceSeed"))
const FixtureFileName = Schema.String.check(
  Schema.isPattern(/^[a-z0-9][a-z0-9.-]*\.json$/)
).pipe(Schema.brand("FixtureFileName"))

const CommonArtifactProvenanceFields = {
  dalphRevision: DalphRevision,
  modelRevision: ModelRevision,
  modelSha256: ModelSha256,
  projectionVersion: Schema.Literal(PROJECTION_VERSION),
  quintVersion: Schema.Literal("0.32.0"),
  rendererVersion: Schema.Literal("observed-dag-prototype@1"),
  seed: TraceSeed,
  step: Schema.NonEmptyString
} as const
const NonStoryArtifactProvenanceSchema = Schema.Struct({
  ...CommonArtifactProvenanceFields,
  init: Schema.NonEmptyString,
  scenarioTest: Schema.optional(Schema.Never),
  scenarioTestSourceSha256: Schema.optional(Schema.Never),
  traceKind: Schema.Literals([
    "activation",
    "sampled",
    "restart",
    "counterexample"
  ])
})
const ExplorationArtifactProvenanceSchema = Schema.Struct({
  ...CommonArtifactProvenanceFields,
  init: Schema.Literal("initReconciliationProfile"),
  scenarioTest: Schema.optional(Schema.Never),
  scenarioTestSourceSha256: Schema.optional(Schema.Never),
  traceKind: Schema.Literals([
    "explore-claim-c-then-claim-loss",
    "explore-claim-loss-then-claim-c",
    "explore-claim-c-then-git-rewrite",
    "explore-git-rewrite-then-claim-c",
    "explore-claim-c-then-authority-conflict",
    "explore-authority-conflict-then-claim-c"
  ])
})
const storyProvenance = <
  const Kind extends string,
  const Test extends string
>(traceKind: Kind, scenarioTest: Test) =>
  Schema.Struct({
    ...CommonArtifactProvenanceFields,
    init: Schema.Literal(scenarioTest),
    scenarioTest: Schema.Literal(scenarioTest),
    scenarioTestSourceSha256: ModelSha256,
    traceKind: Schema.Literal(traceKind)
  })
export const ArtifactProvenanceSchema = Schema.Union([
  NonStoryArtifactProvenanceSchema,
  ExplorationArtifactProvenanceSchema,
  storyProvenance(
    "story-crash-after-intent",
    "crashAfterIntentRequiresFreshReadTest"
  ),
  storyProvenance(
    "story-pause-independent",
    "taskPauseLeavesIndependentBranchRunnableTest"
  ),
  storyProvenance(
    "story-pause-resume",
    "pauseInterruptResumeRereadsBeforeReinvocationTest"
  ),
  storyProvenance(
    "story-success",
    "completeProtocolKeepsFinalitiesDistinctTest"
  ),
  storyProvenance(
    "story-lost-worktree",
    "lostWorktreeRecordsAttemptOutcomeTest"
  ),
  storyProvenance(
    "story-blocker",
    "newBlockerWaitsWithoutStoppingUnrelatedTaskTest"
  ),
  storyProvenance(
    "story-claim-loss",
    "claimLossIsolatesOnlyAffectedTaskTest"
  ),
  storyProvenance(
    "story-git-rewrite",
    "rewrittenTargetIsolatesOnlyAffectedTaskTest"
  ),
  storyProvenance(
    "story-external-completion",
    "externallyCompletedTaskSettlesWithoutDuplicateEffectTest"
  )
])
export type ArtifactProvenance = typeof ArtifactProvenanceSchema.Type

const taggedWire = <const Tags extends ReadonlyArray<string>>(tags: Tags) =>
  Schema.Struct({
    tag: Schema.Literals(tags),
    value: Schema.Unknown
  })
const ClaimWire = taggedWire([
  "Unclaimed",
  "ActiveClaim",
  "CompletionClaim",
  "ForeignClaim"
])
const InvocationWire = taggedWire([
  "NoInvocation",
  "RunningInvocation",
  "AcceptedInvocation",
  "InterruptedInvocation"
])
const LifecycleWire = taggedWire(["Open", "Completed", "Closed"])
const AvailabilityWire = taggedWire(["Missing", "Available"])
const ReadabilityWire = taggedWire(["Readable", "Unreadable", "Conflicting"])
const ObservationWire = taggedWire([
  "NeverObserved",
  "UsableObservation",
  "UnreadableObservation",
  "ConflictingObservation"
])
const BoundaryWire = taggedWire([
  "ClaimBoundary",
  "WorktreeBoundary",
  "SessionBoundary",
  "InvocationBoundary",
  "PromotionBoundary",
  "CompletionClaimBoundary",
  "CompletionBoundary",
  "ClaimDeleteBoundary",
  "NoBoundary"
])
const IsolationWire = taggedWire([
  "NotIsolated",
  "ClaimAuthorityIsolated",
  "WorktreeLostIsolated",
  "GitLineageIsolated",
  "LifecycleIsolated",
  "MembershipIsolated",
  "ObservationIsolated",
  "RequestDidNotConvergeIsolated"
])
const ResponsibilityWire = taggedWire([
  "Unowned",
  "Outstanding",
  "Settled",
  "Relinquished"
])
const SettlementWire = taggedWire([
  "TaskUnsettled",
  "TrackerCompleted",
  "ResponsibilityRelinquished"
])

export interface DecisionEntry {
  readonly executorResourceUse:
    | "UsesNoTaskWorkCapacityPosition"
    | "UsesOneTaskWorkCapacityPosition"
  readonly modelTaskId: ModelTaskId
  readonly transitionOperation:
    | { readonly _tag: "FreshTransitionWithoutOperation" }
    | {
      readonly _tag: "DurableTransitionOperation"
      readonly modelOperationId: ModelOperationId
    }
  readonly transitionTag: string
}

export const AdmissionExplanationSchema = Schema.Struct({
  modelTaskId: ModelTaskId,
  tag: Schema.Literal("CapacityWait"),
  wakeCondition: Schema.Literal(
    "CapacityReleasedOrReconstructedStateChanged"
  )
})
export type AdmissionExplanation = typeof AdmissionExplanationSchema.Type

const TransitionOperationSchema = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("FreshTransitionWithoutOperation")
  }),
  Schema.Struct({
    _tag: Schema.Literal("DurableTransitionOperation"),
    modelOperationId: ModelOperationId
  })
])

const ActivationOwnerSchema = Schema.Struct({
  modelOperationId: Schema.optional(ModelOperationId),
  modelTaskId: ModelTaskId,
  phase: Schema.Literals(["PostIntent", "PreIntent"])
})

const ActivationReservedPositionSchema = Schema.Struct({
  correlation: Schema.Literals(["Operation", "SelectedTransition"]),
  modelOperationId: Schema.optional(ModelOperationId),
  modelTaskId: ModelTaskId
})

export const ActivationProjectionSchema = Schema.Struct({
  activationInProgressModelTaskIds: Schema.Array(ModelTaskId),
  derivedModelTaskIds: Schema.Array(ModelTaskId),
  freshlyObservedModelTaskIds: Schema.Array(ModelTaskId),
  isolatedModelTaskIds: Schema.Array(ModelTaskId),
  owners: Schema.Array(ActivationOwnerSchema),
  postIntentExitedModelTaskIds: Schema.Array(ModelTaskId),
  preIntentInterruptedModelTaskIds: Schema.Array(ModelTaskId),
  providerConsumingModelTaskIds: Schema.Array(ModelTaskId),
  reservedPositions: Schema.Array(ActivationReservedPositionSchema),
  resultsRecordedModelTaskIds: Schema.Array(ModelTaskId),
  runnerModelTaskIds: Schema.Array(ModelTaskId),
  selectedModelTaskIds: Schema.Array(ModelTaskId),
  triggerPending: Schema.Boolean
})
export type ActivationProjection = typeof ActivationProjectionSchema.Type

export const MbtComparableProjectionSchema = Schema.Struct({
  activation: ActivationProjectionSchema,
  admissionCapacity: AdmissionCapacity,
  admittedTransitionOperations: Schema.Array(TransitionOperationSchema),
  admittedModelTaskIds: Schema.Array(ModelTaskId),
  admittedTransitionTags: Schema.Array(Schema.String),
  admissionExplanations: Schema.Array(AdmissionExplanationSchema),
  admissionReservedModelTaskIds: Schema.Array(ModelTaskId),
  coordinatorRunning: Schema.Boolean,
  frontierTransitionOperations: Schema.Array(TransitionOperationSchema),
  frontierModelTaskIds: Schema.Array(ModelTaskId),
  frontierTransitionTags: Schema.Array(Schema.String),
  occupiedModelTaskIds: Schema.Array(ModelTaskId)
})
export type MbtComparableProjection =
  typeof MbtComparableProjectionSchema.Type

export type FrameComparison =
  | { readonly status: "Match" }
  | { readonly status: "NotSupplied" }
  | {
    readonly firstDivergentField: keyof MbtComparableProjection
    readonly status: "Mismatch"
  }

export interface NormalizedFrame {
  readonly action: string
  readonly activation: ActivationProjection
  readonly admission: ReadonlyArray<DecisionEntry>
  readonly capacity: AdmissionCapacity
  readonly comparison: FrameComparison
  readonly coordinatorStatus: "Running" | "Crashed"
  readonly explanations: ReadonlyArray<AdmissionExplanation>
  readonly frontier: ReadonlyArray<DecisionEntry>
  readonly occupiedModelTaskIds: ReadonlyArray<ModelTaskId>
  readonly pickedModelTaskId?: ModelTaskId
  readonly position: TracePosition
  readonly rawItfState: Readonly<Record<string, unknown>>
  readonly reservedModelTaskIds: ReadonlyArray<ModelTaskId>
  readonly runPaused: boolean
  readonly step: TraceStep
  readonly taskStates: ReadonlyArray<NormalizedTaskState>
}

export interface NormalizedTaskState {
  readonly authorityRevision: AdmissionCapacity
  readonly baseCompatible: boolean
  readonly boundary: (typeof BoundaryWire.Type)["tag"]
  readonly claim: (typeof ClaimWire.Type)["tag"]
  readonly inTarget: boolean
  readonly invocation: (typeof InvocationWire.Type)["tag"]
  readonly isolation: (typeof IsolationWire.Type)["tag"]
  readonly lifecycle: (typeof LifecycleWire.Type)["tag"]
  readonly knowledgeActivation: AdmissionCapacity
  readonly knowledgeRevision: AdmissionCapacity
  readonly modelTaskId: ModelTaskId
  readonly observation: (typeof ObservationWire.Type)["tag"]
  readonly paused: boolean
  readonly promoted: boolean
  readonly readability: (typeof ReadabilityWire.Type)["tag"]
  readonly responsibility: (typeof ResponsibilityWire.Type)["tag"]
  readonly settlement: (typeof SettlementWire.Type)["tag"]
  readonly worktree: (typeof AvailabilityWire.Type)["tag"]
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

export const FixtureManifestSchema = Schema.Struct({
  implementationProjection: Schema.optional(FixtureFileName),
  provenance: ArtifactProvenanceSchema,
  rawItf: FixtureFileName
})

export const ImplementationFixtureSchema = Schema.Struct({
  frames: Schema.Array(MbtComparableProjectionSchema),
  provenance: ArtifactProvenanceSchema
})

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

export const BigIntWire = Schema.Struct({ "#bigint": Schema.String })
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
const AuthorityStoryWire = Schema.Struct({
  baseCompatible: Schema.Boolean,
  claim: ClaimWire,
  inTarget: Schema.Boolean,
  invocation: InvocationWire,
  lifecycle: LifecycleWire,
  promoted: Schema.Boolean,
  readability: ReadabilityWire,
  revision: BigIntWire,
  worktree: AvailabilityWire
})
const KnowledgeStoryWire = Schema.Struct({
  activation: BigIntWire,
  durableRevision: BigIntWire,
  observation: ObservationWire
})
const WorkflowStoryWire = Schema.Struct({
  boundary: BoundaryWire,
  isolation: IsolationWire,
  responsibility: ResponsibilityWire,
  settlement: SettlementWire
})
const ExecutorResourceUseWire = taggedWire([
  "UsesNoTaskWorkCapacityPosition",
  "UsesOneTaskWorkCapacityPosition"
])
const TransitionOperationWire = taggedWire([
  "DurableTransitionOperation",
  "FreshTransitionWithoutOperation"
])
const ActivationOwnerWire = taggedWire([
  "NoActivationOwner",
  "PostIntentActivationOwner",
  "PreIntentActivationOwner"
])
const ActivationPositionWire = taggedWire([
  "ActivationPositionAvailable",
  "ActivationPositionOccupied",
  "ActivationPositionReserved",
  "ActivationPositionRetained"
])
export const SelectorProjectionWire = Schema.Struct({
  admittedTaskIds: SetOfBigIntWire,
  capacity: BigIntWire,
  executorResourceUses: Schema.Struct({
    "#map": Schema.Array(Schema.Tuple([BigIntWire, ExecutorResourceUseWire]))
  }),
  explanations: Schema.Struct({
    "#set": Schema.Array(ExplanationWire)
  }),
  frontierTaskIds: SetOfBigIntWire,
  occupiedTaskIds: SetOfBigIntWire,
  reservationTaskIds: SetOfBigIntWire,
  transitionOperations: Schema.Struct({
    "#map": Schema.Array(Schema.Tuple([BigIntWire, TransitionOperationWire]))
  }),
  transitionTags: Schema.Struct({
    "#map": Schema.Array(Schema.Tuple([BigIntWire, Schema.String]))
  })
})
export const DisplayedModelStateWire = Schema.Struct({
  activation: Schema.Struct({
    activationInProgress: SetOfBigIntWire,
    derivedTransitions: SetOfBigIntWire,
    freshlyObservedCapacity: SetOfBigIntWire,
    isolatedSubjects: SetOfBigIntWire,
    owners: Schema.Struct({
      "#map": Schema.Array(Schema.Tuple([BigIntWire, ActivationOwnerWire]))
    }),
    positions: Schema.Struct({
      "#map": Schema.Array(Schema.Tuple([BigIntWire, ActivationPositionWire]))
    }),
    postIntentExited: SetOfBigIntWire,
    preIntentInterrupted: SetOfBigIntWire,
    providerConsuming: SetOfBigIntWire,
    resultsRecorded: SetOfBigIntWire,
    runners: SetOfBigIntWire,
    selectedTransitions: SetOfBigIntWire,
    triggerPending: Schema.Boolean
  }),
  authority: Schema.Struct({
    "#map": Schema.Array(Schema.Tuple([BigIntWire, AuthorityStoryWire]))
  }),
  control: Schema.Struct({
    runPaused: Schema.Boolean,
    taskPaused: Schema.Struct({
      "#map": Schema.Array(Schema.Tuple([BigIntWire, Schema.Boolean]))
    })
  }),
  coordinator: Schema.Struct({ running: Schema.Boolean }),
  knowledge: Schema.Struct({
    "#map": Schema.Array(Schema.Tuple([BigIntWire, KnowledgeStoryWire]))
  }),
  selectorProjection: SelectorProjectionWire,
  workflow: Schema.Struct({
    "#map": Schema.Array(Schema.Tuple([BigIntWire, WorkflowStoryWire]))
  })
})
const ItfStateWire = Schema.Record(Schema.String, Schema.Unknown)
export const ItfEnvelopeWire = Schema.Struct({
  "#meta": Schema.Struct({
    format: Schema.Literal("ITF"),
    source: Schema.String,
    status: Schema.String
  }),
  states: Schema.Array(ItfStateWire),
  vars: Schema.Array(Schema.String)
})

export const retainedReconstructionActions = [
  "init",
  "deriveActivationPass",
  "excludeOwnedTransitions",
  "reserveTaskAdmissionPosition",
  "claimActivationOwnership",
  "rejectDuplicateOwnership",
  "recordOwnedOperationIntent",
  "interruptBeforeOwnership",
  "interruptAfterOwnershipBeforeIntent",
  "interruptAfterIntent",
  "recordOwnedResultAndRelease",
  "observeCapacityConsumed",
  "observeCapacityReleased",
  "crashCoordinatorWithActivation",
  "stopProviderWorker",
  "reconstructActivation",
  "orchestratorCommitsNextFreshTaskClaimIntent",
  "orchestratorCommitsFreshTaskClaimIntent",
  "taskTrackerReturnsTargetClosureReadWithExplicitAbsenceCoverage",
  "taskTrackerReturnsTargetClosureReadWithPredecessor",
  "taskTrackerReturnsTargetClosureReadAtNextRevision",
  "crash",
  "restart"
] as const
const reconstructionActions = new Set([
  ...retainedReconstructionActions,
  "initCapacityOneResponsibilityFirstProfile"
])
const counterexampleActions = new Set([
  ...reconstructionActions,
  "weakenedCapacityStep"
])
const storyActions = new Set([
  "advanceTargetCompatibly",
  "acceptInvocation",
  "addBlockerToC",
  "init",
  "applyAndRecordCurrentBoundary",
  "authorityBecomesConflicting",
  "authorityBecomesUnreadable",
  "classifyAuthorityConstraint",
  "commitFirstIntent",
  "commitResponsibleIntent",
  "completeClaim",
  "completeResponsibleBoundary",
  "completeSuccessfulTask",
  "crash",
  "externallyCompleteTask",
  "loseClaim",
  "loseWorktree",
  "initReconciliationProfile",
  "observeTask",
  "orchestratorCommitsFreshTaskClaimIntent",
  "recordBoundaryOutcome",
  "recordInterruptedInvocation",
  "providerAcceptsInvocation",
  "providerInterruptsInvocation",
  "reachInvocation",
  "requestApplies",
  "requestRunPause",
  "requestTaskPause",
  "requestTaskResume",
  "restart",
  "rewriteTarget",
  "settleExternalCompletion"
])
const displayedFieldNames = [
  "#meta.index",
  "mbt::actionTaken",
  "mbt::nondetPicks.task",
  "state.coordinator.running",
  "state.activation.{owners,positions,runners,selectedTransitions,activationInProgress,triggerPending}",
  "state.control.runPaused",
  "state.control.taskPaused",
  "state.authority.{lifecycle,claim,worktree,invocation,promoted,baseCompatible,inTarget,readability}",
  "state.authority.revision",
  "state.knowledge.{activation,durableRevision,observation}",
  "state.workflow.{boundary,responsibility,isolation,settlement}",
  "state.selectorProjection.capacity",
  "state.selectorProjection.frontierTaskIds",
  "state.selectorProjection.admittedTaskIds",
  "state.selectorProjection.transitionOperations",
  "state.selectorProjection.executorResourceUses",
  "state.selectorProjection.transitionTags",
  "state.selectorProjection.explanations",
  "state.selectorProjection.reservationTaskIds",
  "state.selectorProjection.occupiedTaskIds"
] as const
const comparableFields: ReadonlyArray<keyof MbtComparableProjection> = [
  "activation",
  "admissionCapacity",
  "admittedTransitionOperations",
  "admittedModelTaskIds",
  "admittedTransitionTags",
  "admissionExplanations",
  "admissionReservedModelTaskIds",
  "coordinatorRunning",
  "frontierTransitionOperations",
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

function exactInteger(
  wire: typeof BigIntWire.Type,
  identity: "operation"
): ModelOperationId
function exactInteger(
  wire: typeof BigIntWire.Type,
  identity: "task"
): ModelTaskId
function exactInteger(
  wire: typeof BigIntWire.Type,
  identity: "value"
): AdmissionCapacity
function exactInteger(
  wire: typeof BigIntWire.Type,
  identity: "operation" | "task" | "value"
): AdmissionCapacity | ModelOperationId | ModelTaskId {
  if (!/^-?(0|[1-9][0-9]*)$/.test(wire["#bigint"])) {
    throw new TraceDecodeError({
      detail: `${identity} is not an exact ITF integer: ${wire["#bigint"]}`,
      reason: "LossyInteger"
    })
  }
  const normalized = BigInt(wire["#bigint"]).toString()
  if (identity === "operation") {
    if (BigInt(normalized) < 0n) {
      throw new TraceDecodeError({
        detail: `invalid model operation identity ${normalized}`,
        reason: "MalformedIdentity"
      })
    }
    return decodeSync(
      ModelOperationId,
      normalized,
      `invalid model operation identity ${normalized}`
    )
  }
  if (identity === "task") {
    try {
      return Schema.decodeUnknownSync(ModelTaskId)(normalized)
    } catch {
      throw new TraceDecodeError({
        detail: `unknown bounded model task identity ${normalized}`,
        reason: "MalformedIdentity"
      })
    }
  }
  if (BigInt(normalized) < 0n) {
    throw new TraceDecodeError({
      detail: `negative admission capacity ${normalized}`,
      reason: "LossyInteger"
    })
  }
  return decodeSync(
    AdmissionCapacity,
    normalized,
    `invalid admission capacity ${normalized}`
  )
}

const sortedIdentities = (
  wire: typeof SetOfBigIntWire.Type
): ReadonlyArray<ModelTaskId> =>
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
): ModelTaskId | undefined => {
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
    : traceKind.startsWith("story-") || traceKind.startsWith("explore-")
      ? storyActions
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
): TraceStep => {
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
  return decodeSync(TraceStep, metadata.index, "invalid trace step")
}

const mapsFrom = (
  selector: typeof SelectorProjectionWire.Type
): {
  readonly executorResourceUses: ReadonlyMap<
    ModelTaskId,
    DecisionEntry["executorResourceUse"]
  >
  readonly transitionOperations: ReadonlyMap<
    ModelTaskId,
    DecisionEntry["transitionOperation"]
  >
  readonly transitionTags: ReadonlyMap<ModelTaskId, string>
} => {
  const executorResourceUses = new Map(
    selector.executorResourceUses["#map"].map(([task, resourceUse]) => [
      exactInteger(task, "task"),
      resourceUse.tag
    ] as const)
  )
  const transitionOperations = new Map<
    ModelTaskId,
    DecisionEntry["transitionOperation"]
  >(
    selector.transitionOperations["#map"].map(([task, operation]) => {
      const modelTaskId = exactInteger(task, "task")
      if (operation.tag === "FreshTransitionWithoutOperation") {
        return [
          modelTaskId,
          { _tag: "FreshTransitionWithoutOperation" as const }
        ] as const
      }
      const operationValue = decodeSync(
        Schema.Struct({ operationId: BigIntWire }),
        operation.value,
        `malformed durable transition operation for model task ${modelTaskId}`
      )
      return [
        modelTaskId,
        {
          _tag: "DurableTransitionOperation" as const,
          modelOperationId: exactInteger(
            operationValue.operationId,
            "operation"
          )
        }
      ] as const
    })
  )
  const transitionTags = new Map(
    selector.transitionTags["#map"].map(([task, tag]) => [
      exactInteger(task, "task"),
      tag
    ])
  )
  if (
    executorResourceUses.size !== 4
    || transitionOperations.size !== 4
    || transitionTags.size !== 4
  ) {
    throw new TraceDecodeError({
      detail:
        "resource-use, transition-operation, and transition-tag maps must contain each bounded model task exactly once",
      reason: "MalformedIdentity"
    })
  }
  return { executorResourceUses, transitionOperations, transitionTags }
}

const decisionEntries = (
  taskIds: ReadonlyArray<ModelTaskId>,
  executorResourceUses: ReadonlyMap<
    ModelTaskId,
    DecisionEntry["executorResourceUse"]
  >,
  transitionOperations: ReadonlyMap<
    ModelTaskId,
    DecisionEntry["transitionOperation"]
  >,
  transitionTags: ReadonlyMap<ModelTaskId, string>
): ReadonlyArray<DecisionEntry> =>
  taskIds.map((modelTaskId) => {
    const executorResourceUse = executorResourceUses.get(modelTaskId)
    const transitionOperation = transitionOperations.get(modelTaskId)
    const transitionTag = transitionTags.get(modelTaskId)
    if (
      executorResourceUse === undefined
      || transitionOperation === undefined
      || transitionTag === undefined
    ) {
      throw new TraceDecodeError({
        detail: `missing decision mapping for model task ${modelTaskId}`,
        reason: "MissingDecisionField"
      })
    }
    return {
      executorResourceUse,
      modelTaskId,
      transitionOperation,
      transitionTag
    }
  })

const activationFrom = (
  state: typeof DisplayedModelStateWire.Type
): ActivationProjection => {
  const owners = state.activation.owners["#map"].flatMap(
    ([task, owner]): ReadonlyArray<ActivationProjection["owners"][number]> => {
      if (owner.tag === "NoActivationOwner") return []
      const modelTaskId = exactInteger(task, "task")
      if (owner.tag === "PreIntentActivationOwner") {
        return [{ modelTaskId, phase: "PreIntent" }]
      }
      const ownerValue = decodeSync(
        Schema.Struct({ operationId: BigIntWire }),
        owner.value,
        `malformed post-intent activation owner for model task ${modelTaskId}`
      )
      return [{
        modelOperationId: exactInteger(ownerValue.operationId, "operation"),
        modelTaskId,
        phase: "PostIntent"
      }]
    }
  )
  const reservedPositions = state.activation.positions["#map"].flatMap(
    ([task, position]): ReadonlyArray<
      ActivationProjection["reservedPositions"][number]
    > => {
      const modelTaskId = exactInteger(task, "task")
      if (
        position.tag === "ActivationPositionAvailable"
        || position.tag === "ActivationPositionOccupied"
      ) return []
      if (position.tag === "ActivationPositionReserved") {
        return [{ correlation: "SelectedTransition", modelTaskId }]
      }
      const positionValue = decodeSync(
        Schema.Struct({ operationId: BigIntWire }),
        position.value,
        `malformed retained activation position for model task ${modelTaskId}`
      )
      return [{
        correlation: "Operation",
        modelOperationId: exactInteger(positionValue.operationId, "operation"),
        modelTaskId
      }]
    }
  )
  return {
    activationInProgressModelTaskIds: sortedIdentities(
      state.activation.activationInProgress
    ),
    derivedModelTaskIds: sortedIdentities(
      state.activation.derivedTransitions
    ),
    freshlyObservedModelTaskIds: sortedIdentities(
      state.activation.freshlyObservedCapacity
    ),
    isolatedModelTaskIds: sortedIdentities(
      state.activation.isolatedSubjects
    ),
    owners: [...owners].sort(
      (left, right) => Number(left.modelTaskId) - Number(right.modelTaskId)
    ),
    postIntentExitedModelTaskIds: sortedIdentities(
      state.activation.postIntentExited
    ),
    preIntentInterruptedModelTaskIds: sortedIdentities(
      state.activation.preIntentInterrupted
    ),
    providerConsumingModelTaskIds: sortedIdentities(
      state.activation.providerConsuming
    ),
    reservedPositions: [...reservedPositions].sort(
      (left, right) => Number(left.modelTaskId) - Number(right.modelTaskId)
    ),
    resultsRecordedModelTaskIds: sortedIdentities(
      state.activation.resultsRecorded
    ),
    runnerModelTaskIds: sortedIdentities(state.activation.runners),
    selectedModelTaskIds: sortedIdentities(
      state.activation.selectedTransitions
    ),
    triggerPending: state.activation.triggerPending
  }
}

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

const storyTaskStatesFrom = (
  state: typeof DisplayedModelStateWire.Type
): ReadonlyArray<NormalizedTaskState> => {
  const authority = new Map(
    state.authority["#map"].map(([task, value]) => [
      exactInteger(task, "task"),
      value
    ])
  )
  const knowledge = new Map(
    state.knowledge["#map"].map(([task, value]) => [
      exactInteger(task, "task"),
      value
    ])
  )
  const paused = new Map(
    state.control.taskPaused["#map"].map(([task, value]) => [
      exactInteger(task, "task"),
      value
    ])
  )
  const workflow = new Map(
    state.workflow["#map"].map(([task, value]) => [
      exactInteger(task, "task"),
      value
    ])
  )
  const taskIds = ["0", "1", "2", "3"].map((task) =>
    decodeSync(ModelTaskId, task, `invalid bounded model task ${task}`)
  )
  if (
    authority.size !== taskIds.length
    || knowledge.size !== taskIds.length
    || paused.size !== taskIds.length
    || workflow.size !== taskIds.length
  ) {
    throw new TraceDecodeError({
      detail: "story projection maps must contain each bounded model task",
      reason: "MalformedIdentity"
    })
  }
  return taskIds.map((modelTaskId) => {
    const authorityState = authority.get(modelTaskId)
    const knowledgeState = knowledge.get(modelTaskId)
    const taskPaused = paused.get(modelTaskId)
    const workflowState = workflow.get(modelTaskId)
    if (
      authorityState === undefined
      || knowledgeState === undefined
      || taskPaused === undefined
      || workflowState === undefined
    ) {
      throw new TraceDecodeError({
        detail: `story projection is missing model task ${modelTaskId}`,
        reason: "MissingDecisionField"
      })
    }
    return {
      authorityRevision: exactInteger(
        decodeSync(
          BigIntWire,
          authorityState.revision,
          `invalid authority revision for model task ${modelTaskId}`
        ),
        "value"
      ),
      baseCompatible: authorityState.baseCompatible,
      boundary: workflowState.boundary.tag,
      claim: authorityState.claim.tag,
      inTarget: authorityState.inTarget,
      invocation: authorityState.invocation.tag,
      isolation: workflowState.isolation.tag,
      lifecycle: authorityState.lifecycle.tag,
      knowledgeActivation: exactInteger(
        decodeSync(
          BigIntWire,
          knowledgeState.activation,
          `invalid knowledge activation for model task ${modelTaskId}`
        ),
        "value"
      ),
      knowledgeRevision: exactInteger(
        decodeSync(
          BigIntWire,
          knowledgeState.durableRevision,
          `invalid knowledge revision for model task ${modelTaskId}`
        ),
        "value"
      ),
      modelTaskId,
      observation: knowledgeState.observation.tag,
      paused: taskPaused,
      promoted: authorityState.promoted,
      readability: authorityState.readability.tag,
      responsibility: workflowState.responsibility.tag,
      settlement: workflowState.settlement.tag,
      worktree: authorityState.worktree.tag
    }
  })
}

export const toMbtComparable = (
  frame: Omit<NormalizedFrame, "comparison">
): MbtComparableProjection => ({
  activation: frame.activation,
  admissionCapacity: frame.capacity,
  admittedTransitionOperations:
    frame.admission.map(({ transitionOperation }) => transitionOperation),
  admittedModelTaskIds:
    frame.admission.map(({ modelTaskId }) => modelTaskId),
  admittedTransitionTags:
    frame.admission.map(({ transitionTag }) => transitionTag),
  admissionExplanations: frame.explanations,
  admissionReservedModelTaskIds: frame.reservedModelTaskIds,
  coordinatorRunning: frame.coordinatorStatus === "Running",
  frontierTransitionOperations:
    frame.frontier.map(({ transitionOperation }) => transitionOperation),
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
  const {
    executorResourceUses,
    transitionOperations,
    transitionTags
  } = mapsFrom(selector)
  const pickedModelTaskId = pickedTaskFrom(rawState)
  const frame: Omit<NormalizedFrame, "comparison"> = {
    action: actionFrom(rawState, traceKind),
    activation: activationFrom(state),
    admission: decisionEntries(
      admittedTaskIds,
      executorResourceUses,
      transitionOperations,
      transitionTags
    ),
    capacity: exactInteger(selector.capacity, "value"),
    coordinatorStatus: state.coordinator.running ? "Running" : "Crashed",
    explanations: explanationsFrom(selector),
    frontier: decisionEntries(
      frontierTaskIds,
      executorResourceUses,
      transitionOperations,
      transitionTags
    ),
    occupiedModelTaskIds: sortedIdentities(selector.occupiedTaskIds),
    ...(pickedModelTaskId === undefined ? {} : { pickedModelTaskId }),
    position: decodeSync(
      TracePosition,
      `S${step}`,
      `invalid display position S${step}`
    ),
    rawItfState: rawState,
    reservedModelTaskIds: sortedIdentities(selector.reservationTaskIds),
    runPaused: state.control.runPaused,
    step,
    taskStates: storyTaskStatesFrom(state)
  }
  return {
    ...frame,
    comparison: comparisonFrom(frame, implementation)
  }
}

const decodeTraceUnsafe = (
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
  const expectedStatus =
    provenance.traceKind === "counterexample" ? "violation" : "ok"
  if (envelope["#meta"].status !== expectedStatus) {
    throw new TraceDecodeError({
      detail:
        `${provenance.traceKind} trace status ${envelope["#meta"].status}; expected ${expectedStatus}`,
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
        "authority blockers",
        "activation registration counts and release-correlation diagnostics",
        "control epochs",
        "effect identity sets and counters",
        "reconstructed knowledge facts and observed-authority revision",
        "request identity sets and counters",
        "workflow intent, request counters, and attempt outcome"
      ],
      unsupportedInputs: [
        "actions outside the retained reconstruction, story, and counterexample inventories",
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

/**
 * Decodes one retained ITF artifact without allowing malformed evidence to
 * escape the typed failure channel.
 */
export const decodeTrace = (
  input: unknown,
  provenance: ArtifactProvenance,
  implementation: ReadonlyArray<MbtComparableProjection> = []
): Effect.Effect<NormalizedTrace, TraceDecodeError> =>
  Effect.try({
    catch: (cause) =>
      cause instanceof TraceDecodeError
        ? cause
        : new TraceDecodeError({
          detail: `unexpected trace decode failure: ${String(cause)}`,
          reason: "InvalidItf"
        }),
    try: () => decodeTraceUnsafe(input, provenance, implementation)
  })
