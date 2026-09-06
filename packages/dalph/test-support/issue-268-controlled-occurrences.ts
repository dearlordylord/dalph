import { Effect, Ref } from "effect"

export type Issue268OccurrenceSource =
  | "Action"
  | "Control"
  | "Executor"
  | "Git"
  | "Journal"
  | "Publication"
  | "Tracker"
  | "Trace"

/** One actual test-boundary observation in the order the controlled run saw it. */
export interface Issue268ObservedOccurrence {
  readonly detail: string
  readonly kind: string
  readonly ordinal: number
  readonly source: Issue268OccurrenceSource
  readonly sourceSequence: number
}

/** One finer ordering point used to prove a required happens-before edge. */
export interface Issue268CausalLandmark extends Issue268ObservedOccurrence {
  readonly key: string
}

interface Issue268OccurrenceInput {
  readonly detail?: string
  readonly kind: string
  readonly source: Issue268OccurrenceSource
}

export interface Issue268OccurrenceEvidence {
  readonly observedOccurrences: ReadonlyArray<Issue268ObservedOccurrence>
}

// eslint-disable-next-line functional/no-mixed-types -- The recorder intentionally exposes one operation and one snapshot effect.
export interface Issue268OccurrenceRecorder {
  readonly record: (input: Issue268OccurrenceInput) => Effect.Effect<void>
  readonly snapshot: Effect.Effect<Issue268OccurrenceEvidence>
}

/** Makes one shared monotonic recorder; Ref.modify keeps cross-fiber stamps atomic. */
export const makeIssue268OccurrenceRecorder = Effect.gen(function* () {
  interface RecorderNode {
    readonly entry: Issue268ObservedOccurrence
    readonly previous: RecorderNode | undefined
  }
  interface RecorderState {
    readonly count: number
    readonly head: RecorderNode | undefined
    readonly sourceSequences: ReadonlyMap<Issue268OccurrenceSource, number>
  }
  const occurrenceLimit = 20_000
  const state = yield* Ref.make<RecorderState>({ count: 0, head: undefined, sourceSequences: new Map() })
  const record = (input: Issue268OccurrenceInput) =>
    Ref.modify(state, (current) => {
      if (current.count >= occurrenceLimit) return [false, current] as const
      const sourceSequence = (current.sourceSequences.get(input.source) ?? 0) + 1
      const entry = {
        detail: input.detail ?? "",
        kind: input.kind,
        ordinal: current.count + 1,
        source: input.source,
        sourceSequence
      }
      return [
        true,
        {
          count: current.count + 1,
          head: { entry, previous: current.head },
          sourceSequences: new Map(current.sourceSequences).set(input.source, sourceSequence)
        }
      ] as const
    }).pipe(
      Effect.flatMap((accepted) =>
        accepted
          ? Effect.void
          : Effect.die(
              `issue 268 occurrence recorder exceeded ${occurrenceLimit} items at ${input.source}:${input.kind}`
            )
      )
    )
  const snapshot = Ref.get(state).pipe(
    Effect.map(({ head }) => {
      const reversed: Array<Issue268ObservedOccurrence> = []
      let current = head
      while (current !== undefined) {
        // eslint-disable-next-line functional/immutable-data -- One bounded mutable pass preserves O(n) snapshot cost.
        reversed.push(current.entry)
        current = current.previous
      }
      const entries = reversed.toReversed()
      return { observedOccurrences: entries }
    })
  )
  return { record, snapshot } satisfies Issue268OccurrenceRecorder
})

export interface Issue268RequiredEdge {
  readonly after: string
  readonly before: string
  readonly claim: number
  readonly id: string
}

export interface Issue268RequiredEdgeViolation {
  readonly edge: Issue268RequiredEdge
  readonly reason: "AfterNotAfterBefore" | "DuplicateEndpoint" | "MissingEndpoint"
}

const requiredOrderingClaimCount = 20

const occurrencesFor = (landmarks: ReadonlyArray<Issue268CausalLandmark>, key: string) =>
  landmarks.filter((landmark) => landmark.key === key)

/** Validates exact endpoint identity before comparing observed monotonic positions. */
export const validateIssue268RequiredEdges = (
  landmarks: ReadonlyArray<Issue268CausalLandmark>,
  edges: ReadonlyArray<Issue268RequiredEdge>
): ReadonlyArray<Issue268RequiredEdgeViolation> =>
  edges.flatMap<Issue268RequiredEdgeViolation>((edge) => {
    const before = occurrencesFor(landmarks, edge.before)
    const after = occurrencesFor(landmarks, edge.after)
    if (before.length === 0 || after.length === 0) return [{ edge, reason: "MissingEndpoint" as const }]
    if (before.length !== 1 || after.length !== 1) return [{ edge, reason: "DuplicateEndpoint" as const }]
    return (before[0]?.ordinal ?? Number.MAX_SAFE_INTEGER) < (after[0]?.ordinal ?? Number.MIN_SAFE_INTEGER)
      ? []
      : [{ edge, reason: "AfterNotAfterBefore" as const }]
  })

/** Moves the after endpoint immediately before its predecessor while preserving all evidence members. */
export const reverseIssue268RequiredEdge = (
  landmarks: ReadonlyArray<Issue268CausalLandmark>,
  edge: Issue268RequiredEdge
): ReadonlyArray<Issue268CausalLandmark> => {
  const beforeIndex = landmarks.findIndex(({ key }) => key === edge.before)
  const afterIndex = landmarks.findIndex(({ key }) => key === edge.after)
  if (beforeIndex < 0 || afterIndex < 0 || beforeIndex === afterIndex) return landmarks
  const after = landmarks[afterIndex]
  if (after === undefined) return landmarks
  const withoutAfter = landmarks.filter((_, index) => index !== afterIndex)
  const adjustedBeforeIndex = withoutAfter.findIndex(({ key }) => key === edge.before)
  const reordered = [...withoutAfter.slice(0, adjustedBeforeIndex), after, ...withoutAfter.slice(adjustedBeforeIndex)]
  return reordered.map((landmark, index) => ({ ...landmark, ordinal: index + 1 }))
}

export const issue268RequiredClaimCoverageIsComplete = (edges: ReadonlyArray<Issue268RequiredEdge>): boolean => {
  const claims = new Set(edges.map(({ claim }) => claim))
  return (
    claims.size === requiredOrderingClaimCount &&
    Array.from({ length: requiredOrderingClaimCount }, (_, index) => index + 1).every((claim) => claims.has(claim))
  )
}

/** Exact observed boundary inventory for the accepted DS-01 through DS-13 controlled run. */
export const issue268ExpectedOccurrenceCounts: Readonly<Record<string, number>> = {
  "Action:DeliveryActionExecuting": 64,
  "Action:DeliveryActionReturned": 64,
  "Control:ActiveRefreshStarted": 1,
  "Control:AliceTaskClosure": 1,
  "Control:AliceTaskSpecificationEditAccepted": 1,
  "Control:ClaimResponseReadinessReleased": 3,
  "Control:CoordinatorProcessLoss": 1,
  "Control:ExecutorSafeReportReady": 2,
  "Control:ExecutorTerminalReportReady": 1,
  "Control:OperatorCapacityChangeCalled": 1,
  "Control:OperatorCapacityChangeReturned": 1,
  "Control:OperatorContinueCalled": 1,
  "Control:OperatorContinueReturned": 1,
  "Control:OrdinaryActivationReturned": 1,
  "Control:PostQuiescenceWitnessObserved": 2,
  "Control:TrackerNotificationDelivered": 1,
  "Executor:ExecutorBeginCalled": 4,
  "Executor:ExecutorBeginReturned": 4,
  "Executor:ExecutorObserveCalled": 7,
  "Executor:ExecutorObserveReturned": 7,
  "Executor:ExecutorResumeCalled": 1,
  "Executor:ExecutorResumeReturned": 1,
  "Executor:ExecutorSuspendCalled": 2,
  "Executor:ExecutorSuspendReturned": 2,
  "Git:TargetLineageReadCalled": 5,
  "Git:TargetLineageReadReturned": 5,
  "Git:WorktreeCreateCalled": 4,
  "Git:WorktreeCreateReturned": 4,
  "Git:WorktreeReadCalled": 13,
  "Git:WorktreeReadReturned": 13,
  "Journal:AttemptChoiceApplied": 1,
  "Journal:GitReadIntentRecorded": 10,
  "Journal:JournalRecoveryReadCalled": 4,
  "Journal:JournalRecoveryReadReturned": 4,
  "Journal:PlannedAttemptContinuationAuthorized": 1,
  "Journal:PlannedAttemptExecutorCommandIntended": 7,
  "Journal:PlannedAttemptExecutorCommandResponseObserved": 7,
  "Journal:PlannedAttemptExecutorStateObserved": 3,
  "Journal:PlannedAttemptExecutorWorkReported": 8,
  "Journal:PlannedAttemptExecutorWorkResponsibilityBegan": 4,
  "Journal:PlannedAttemptWorktreeObserved": 5,
  "Journal:TargetLineageObserved": 5,
  "Journal:TaskAttemptPlanned": 4,
  "Journal:TaskClaimAcquired": 4,
  "Journal:TaskClaimAcquisitionIntended": 4,
  "Journal:TaskTrackerFactsObserved": 30,
  "Journal:TaskTrackerReadIntentRecorded": 30,
  "Journal:TaskWorkCapacityChanged": 1,
  "Journal:TaskWorktreeReady": 4,
  "Journal:TaskWorktreeReconciliationIntended": 4,
  "Journal:WorkflowRunBegan": 1,
  "Publication:B1ResumeResponsibilityPublished": 1,
  "Publication:DeliveryPublicationObserved": 73,
  "Publication:DeliveryRuntimeObservationPublished": 378,
  "Publication:TaskEligibilityPublished": 3,
  "Publication:TaskWorkPositionAdmissionBound": 22,
  "Publication:TaskWorkPositionBound": 7,
  "Publication:TaskWorkPositionReleased": 3,
  "Trace:OperationSelected": 52,
  "Trace:TaskAttemptPlanAcknowledged": 4,
  "Trace:TaskClaimAcquired": 4,
  "Trace:TaskClaimAcquisitionIntended": 4,
  "Trace:TaskTrackerFactsObserved": 12,
  "Trace:TaskWorktreeReady": 4,
  "Trace:TrackerExecutionAdmitted": 4,
  "Tracker:TaskClaimAcquireCalled": 4,
  "Tracker:TaskClaimAcquireReturned": 4,
  "Tracker:TaskClaimReadCalled": 13,
  "Tracker:TaskClaimReadReturned": 13,
  "Tracker:TaskWorkSpecificationReadCalled": 10,
  "Tracker:TaskWorkSpecificationReadReturned": 10,
  "Tracker:TrackerGraphReadCalled": 15,
  "Tracker:TrackerGraphReadReturned": 15
}

/** Proves contiguous stamping plus the exact classified boundary inventory; subsets and unknown kinds fail. */
export const issue268OccurrenceEvidenceIsComplete = (evidence: Issue268OccurrenceEvidence): boolean => {
  const ordinals = evidence.observedOccurrences.map(({ ordinal }) => ordinal)
  if (new Set(ordinals).size !== ordinals.length || ordinals.some((ordinal, index) => ordinal !== index + 1))
    return false
  const latestSourceSequences = new Map<Issue268OccurrenceSource, number>()
  const actualCounts = new Map<string, number>()
  for (const { kind, source, sourceSequence } of evidence.observedOccurrences) {
    const expectedSourceSequence = (latestSourceSequences.get(source) ?? 0) + 1
    if (sourceSequence !== expectedSourceSequence) return false
    // eslint-disable-next-line functional/immutable-data -- Bounded local counters keep the completeness check O(n).
    latestSourceSequences.set(source, sourceSequence)
    const category = `${source}:${kind}`
    // eslint-disable-next-line functional/immutable-data -- Bounded local counters keep the completeness check O(n).
    actualCounts.set(category, (actualCounts.get(category) ?? 0) + 1)
  }
  const expectedEntries = Object.entries(issue268ExpectedOccurrenceCounts)
  return (
    actualCounts.size === expectedEntries.length &&
    expectedEntries.every(([key, expected]) => actualCounts.get(key) === expected)
  )
}
