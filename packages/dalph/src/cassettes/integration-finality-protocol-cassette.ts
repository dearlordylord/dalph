/* eslint-disable max-lines -- The cassette seam keeps the exact boundary script and production protocol together. */
import { Effect, Match, Ref } from "effect"
import {
  AcceptedResult,
  AttemptId,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import {
  ActiveTaskClaim,
  authorizedClaimForAttempt,
  ClaimOwner,
  ClaimToken,
  CompletionClaimBoundary,
  type CompletionClaimBoundaryService,
  CompletionClaimReadFailure,
  CompletionClaimReplacementIntendedEvent,
  CompletionClaimDeletionIntendedEvent,
  CompletionClaimDeletionFailure,
  CompletionClaimReplacementFailure,
  CompletionTaskAuthorizationReadOrdinal,
  CompletionTaskFocusedReadPurpose,
  CompletionTaskIntendedEvent,
  CompletionTaskRequestOrdinal,
  CompletionTaskClaim,
  controlledCompletionClaimBoundaryLayerFrom,
  completionClaimDeletionRequestFor,
  completionClaimDeletionOperationIdFor,
  completionClaimReplacementOperationIdFor,
  completionClaimReplacementRequestFor,
  describeJournalEvent,
  EvidenceDigest,
  EvidenceReference,
  FocusedCompletedTaskObservation,
  FrontierExplanation,
  FixtureTarget,
  InRunJournal,
  IntegratorCandidateResourceLocator,
  IntegratorCandidateText,
  IntegratorSessionCorrelation,
  IntegratorRunCorrelation,
  IntegratorRunOrdinal,
  IntegratorRunQualifiedCandidate,
  IntegratorSessionId,
  JournalPosition,
  JournalRecord,
  makeTaskAttemptPlanOperation,
  OperationId,
  completionTaskRequestFor,
  readCompletionFocusedFacts,
  deriveRunFinalityDecision,
  runCompletionClaimDeletionProtocol,
  runCompletionClaimReplacementProtocol,
  TargetPromotionAttemptOrdinal,
  TargetPromotionObservedSuccessEvent,
  TargetPromotionSuccessObservation,
  targetPromotionCorrelationFor,
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  type CompletionTaskBoundaryService,
  type TrackerTarget,
  TrackerRevision,
  type WorkflowJournalEvent,
  workflowJournalEventVersion
} from "@dalph/orchestrator"
import {
  type CompletionClaimBoundaryResult as CompletionClaimProtocolBoundaryResult,
  type CompletionClaimProtocolStoryItem,
  type IntegrationFinalityProtocolCassette,
  IntegrationFinalityProtocolCassetteRun
} from "./integration-finality-protocol-cassette-domain.js"

export * from "./integration-finality-protocol-cassette-domain.js"

type AppendableWorkflowJournalEvent = Exclude<
  WorkflowJournalEvent,
  { readonly _tag: "WorkflowRunBegan" | "WorkflowRunTerminated" }
>

const gitShaLength = 40
const evidenceDigestLength = 64
const candidateConstructedPosition = 3
const integratorStartedPosition = 2
const initialClaimPosition = 1
const initialAttemptPosition = 2
const initialPromotionPosition = 3
const noInitialRecords = (): ReadonlyArray<JournalRecord> | null => null

const makePreparedFinality = Effect.fn("IntegrationFinalityProtocolCassette.makePreparedFinality")(() =>
  Effect.sync(() => {
    const runId = RunId.make("integration-finality-protocol-cassette-run")
    const taskId = TaskId.make("integration-finality-protocol-cassette-task")
    const target = FixtureTarget.make("integration-finality-protocol-cassette-target")
    const integrationTarget = IntegrationTarget.make({
      ref: IntegrationTargetRef.make("refs/heads/main"),
      repository: GitRepositoryLocator.make("/repositories/integration-finality-protocol.git")
    })
    const expectedTargetHead = GitCommitSha.make("1".repeat(gitShaLength))
    const candidateCommit = GitCommitSha.make("3".repeat(gitShaLength))
    const acceptedResult = AcceptedResult.make({
      commit: GitCommitSha.make("2".repeat(gitShaLength)),
      evidenceManifest: EvidenceReference.make({
        byteLength: 1,
        digest: EvidenceDigest.make("a".repeat(evidenceDigestLength))
      })
    })
    const plannedAttempt = PlannedTaskAttempt.make({
      attemptId: AttemptId.make("integration-finality-protocol-attempt"),
      baseSha: expectedTargetHead,
      branch: TaskBranchRef.make("refs/heads/dalph/integration-finality-protocol"),
      executor: TaskExecutorLocator.make("executor:integration-finality-protocol"),
      runId,
      taskId,
      taskRevision: TaskRevision.make("integration-finality-protocol-revision"),
      worktree: WorktreeLocator.make("/worktrees/integration-finality-protocol")
    })
    const integratorCorrelation = IntegratorSessionCorrelation.make({
      acceptedResult,
      candidateResource: IntegratorCandidateResourceLocator.make("/candidate/integration-finality-protocol"),
      expectedTargetHead,
      integrationTarget,
      plannedAttempt,
      queuedAt: JournalPosition.make(1),
      sessionId: IntegratorSessionId.make("integration-finality-protocol-session"),
      startedAt: JournalPosition.make(integratorStartedPosition),
      targetLineageObservedAt: JournalPosition.make(integratorStartedPosition)
    })
    const qualifiedCandidate = IntegratorRunQualifiedCandidate.make({
      candidateCommit,
      candidateText: IntegratorCandidateText.make("refs/heads/integration-finality-protocol-candidate"),
      directParents: [expectedTargetHead, acceptedResult.commit],
      qualifiedAt: JournalPosition.make(candidateConstructedPosition),
      run: IntegratorRunCorrelation.make({ ordinal: IntegratorRunOrdinal.make(1), session: integratorCorrelation })
    })
    const promotionCorrelation = targetPromotionCorrelationFor(qualifiedCandidate)
    const activeClaim = ActiveTaskClaim.make({
      operationId: OperationId.make("integration-finality-protocol-active-claim"),
      owner: ClaimOwner.make("dalph:integration-finality-protocol"),
      taskId,
      token: ClaimToken.make("integration-finality-protocol-token")
    })
    const claim = CompletionTaskClaim.make({ originalClaim: activeClaim, plannedAttempt, promotionCorrelation })
    const planOperation = makeTaskAttemptPlanOperation({
      operationId: OperationId.make("integration-finality-protocol-plan-attempt"),
      plannedAttempt,
      predecessorOperationIds: [activeClaim.operationId]
    })
    const promotionSuccess = TargetPromotionObservedSuccessEvent.make({
      basis: { _tag: "AfterAttempt", attemptOrdinal: TargetPromotionAttemptOrdinal.make(1) },
      correlation: promotionCorrelation,
      observation: TargetPromotionSuccessObservation.cases.CompareAndSetApplied.make({
        candidateAncestry: "Current",
        targetHeadSha: candidateCommit
      }),
      version: workflowJournalEventVersion
    })
    return {
      activeClaim,
      claim,
      initialRecords: noInitialRecords(),
      planOperation,
      plannedAttempt,
      promotionCorrelation,
      promotionSuccess,
      runId,
      target,
      taskId
    }
  })
)

type PreparedFinality = Omit<Effect.Success<ReturnType<typeof makePreparedFinality>>, "target"> & {
  readonly target: TrackerTarget
}

const journalRecordFor = (runId: RunId, position: number, event: AppendableWorkflowJournalEvent): JournalRecord =>
  JournalRecord.make({
    event,
    key: describeJournalEvent(event).expectedKey,
    position: JournalPosition.make(position),
    runId
  })

const initialRecordsFor = (prepared: PreparedFinality) => {
  if (prepared.initialRecords !== null) return prepared.initialRecords
  return [
    journalRecordFor(
      prepared.runId,
      initialClaimPosition,
      TaskClaimAcquiredEvent.make({ claim: prepared.activeClaim, version: workflowJournalEventVersion })
    ),
    journalRecordFor(
      prepared.runId,
      initialAttemptPosition,
      TaskAttemptPlannedEvent.make({ operation: prepared.planOperation, version: workflowJournalEventVersion })
    ),
    journalRecordFor(prepared.runId, initialPromotionPosition, prepared.promotionSuccess)
  ] satisfies ReadonlyArray<JournalRecord>
}

const promotedPlanFor = (records: ReadonlyArray<JournalRecord>) => {
  const promotion = records.findLast(({ event }) => event._tag === "TargetPromotionObservedSuccess")?.event
  if (promotion?._tag !== "TargetPromotionObservedSuccess") return undefined
  const promotedAttempt = promotion.correlation.qualifiedCandidate.run.session.plannedAttempt
  const planned = records
    .flatMap(({ event }) =>
      event._tag === "TaskAttemptPlanned"
        ? [event.operation]
        : event._tag === "PlannedAttemptReplaced"
          ? [event.successorPlan]
          : []
    )
    .findLast(
      ({ plannedAttempt }) =>
        plannedAttempt.attemptId === promotedAttempt.attemptId && plannedAttempt.runId === promotedAttempt.runId
    )
  return planned === undefined ? undefined : { planned, promotion }
}

const completeGraphCoveringTask = (records: ReadonlyArray<JournalRecord>, taskId: TaskId) =>
  records.findLast(
    ({ event }) =>
      event._tag === "TaskTrackerFactsObserved" &&
      event.observation._tag === "CompleteTaskTrackerFacts" &&
      event.observation.factFamilies[0].taskIds.includes(taskId)
  )?.event

const preparedFinalityFromPromotedRecords = Effect.fn(
  "IntegrationFinalityProtocolCassette.preparedFromPromotedRecords"
)(function* (records: ReadonlyArray<JournalRecord>) {
  const premises = promotedPlanFor(records)
  if (premises === undefined) {
    return yield* Effect.die("promoted finality cassette requires the promoted planned attempt")
  }
  const { planned, promotion } = premises
  const plannedAttempt = planned.plannedAttempt
  const acquired = authorizedClaimForAttempt(records, plannedAttempt)
  if (acquired === undefined) return yield* Effect.die("promoted finality cassette requires its authorized exact claim")
  const activeClaim = acquired.claim
  const runId = plannedAttempt.runId
  const taskId = plannedAttempt.taskId
  const graph = completeGraphCoveringTask(records, taskId)
  if (graph?._tag !== "TaskTrackerFactsObserved" || graph.observation._tag !== "CompleteTaskTrackerFacts") {
    return yield* Effect.die("promoted finality cassette requires a complete tracker observation covering its task")
  }
  const target = graph.observation.target
  const claim = CompletionTaskClaim.make({
    originalClaim: activeClaim,
    plannedAttempt,
    promotionCorrelation: promotion.correlation
  })
  return {
    activeClaim,
    claim,
    initialRecords: records,
    planOperation: planned,
    plannedAttempt,
    promotionCorrelation: promotion.correlation,
    promotionSuccess: promotion,
    runId,
    target,
    taskId
  } satisfies PreparedFinality
})

interface FinalityJournal {
  readonly baselineLength: number
  readonly records: Ref.Ref<ReadonlyArray<JournalRecord>>
  readonly service: InRunJournal["Service"]
}

const makeJournal = Effect.fn("IntegrationFinalityProtocolCassette.makeJournal")(function* (
  initial: ReadonlyArray<JournalRecord>
) {
  const records = yield* Ref.make(initial)
  return {
    baselineLength: initial.length,
    records,
    service: InRunJournal.of({
      append: (runId, key, event) =>
        Ref.modify(records, (current) => {
          const existing = current.find((record) => record.key === key)
          /* v8 ignore next -- @preserve Schema-closed stories never append the same stable occurrence twice. */
          if (existing !== undefined) return [Effect.succeed(existing), current] as const
          const appended = JournalRecord.make({ event, key, position: JournalPosition.make(current.length + 1), runId })
          return [Effect.succeed(appended), [...current, appended]] as const
        }).pipe(Effect.flatten),
      read: () => Ref.get(records)
    })
  } satisfies FinalityJournal
})

const takeBoundaryResult = Effect.fn("IntegrationFinalityProtocolCassette.takeBoundaryResult")(function* (
  results: Ref.Ref<ReadonlyArray<CompletionClaimProtocolBoundaryResult>>
) {
  const result = yield* Ref.modify(results, (current) => [current[0], current.slice(1)] as const)
  /* v8 ignore next -- @preserve Cassette closure validation and terminal expectations supply every scripted boundary result. */
  if (result === undefined) return yield* Effect.die("integration finality cassette exhausted boundary results")
  return result
})

const expectedReadTagByResult: ReadonlyMap<CompletionClaimProtocolBoundaryResult["_tag"], string> = new Map([
  ["ReadActiveClaim", "ActiveTaskClaim"],
  ["ReadCompletionClaim", "CompletionTaskClaim"],
  ["ReadForeignClaim", "ActiveTaskClaim"],
  ["ReadUnclaimed", "UnclaimedTask"]
])

const expectedReadTag = (result: CompletionClaimProtocolBoundaryResult): string | undefined =>
  expectedReadTagByResult.get(result._tag)

type BoundaryCall = "deleteTaskClaim" | "readTaskClaim" | "replaceTaskClaim"

const recordBoundaryCall = (calls: Ref.Ref<ReadonlyArray<BoundaryCall>>, call: BoundaryCall) =>
  Ref.update(calls, (current) => [...current, call])

const scriptedBoundaryFor = Effect.fn("IntegrationFinalityProtocolCassette.scriptedBoundaryFor")(function* (
  prepared: PreparedFinality,
  initialClaim: "Active" | "Completion" | "Foreign",
  declaredResults: ReadonlyArray<CompletionClaimProtocolBoundaryResult>
) {
  const controlled = yield* CompletionClaimBoundary
  const results = yield* Ref.make(declaredResults)
  const boundaryCalls = yield* Ref.make<ReadonlyArray<BoundaryCall>>([])
  const readCalls = yield* Ref.make(0)
  const replacementCalls = yield* Ref.make(0)
  const deletionCalls = yield* Ref.make(0)
  const readTaskClaim: CompletionClaimBoundaryService["readTaskClaim"] = (taskId) =>
    Effect.gen(function* () {
      yield* recordBoundaryCall(boundaryCalls, "readTaskClaim")
      yield* Ref.update(readCalls, (count) => count + 1)
      const result = yield* takeBoundaryResult(results)
      if (result._tag === "ReadFailed") {
        return yield* new CompletionClaimReadFailure({ detail: result.detail, taskId })
      }
      const expected = expectedReadTag(result)
      /* v8 ignore next -- @preserve Story/boundary schemas keep mutation results out of read positions. */
      if (expected === undefined) return yield* Effect.die(`expected a read result, received ${result._tag}`)
      const observed = yield* controlled.readTaskClaim(taskId)
      /* v8 ignore next -- @preserve The controlled boundary and declarative initial claim are constructed coherently. */
      if (observed._tag !== expected)
        return yield* Effect.die(`read result ${result._tag} contradicted controlled claim state`)
      const foreignClaimRead = new Set([
        "ReadForeignClaim:Active",
        "ReadForeignClaim:Completion",
        "ReadForeignClaim:Foreign",
        "ReadActiveClaim:Foreign"
      ]).has(`${result._tag}:${initialClaim}`)
      if (foreignClaimRead) {
        /* v8 ignore next -- @preserve The maintained foreign-claim cassette constructs a distinct active operation identity. */
        if (observed._tag !== "ActiveTaskClaim" || observed.operationId === prepared.activeClaim.operationId) {
          return yield* Effect.die("foreign claim cassette did not preserve a foreign active claim")
        }
      }
      return observed
    })

  const replaceTaskClaim: CompletionClaimBoundaryService["replaceTaskClaim"] = (request) =>
    Effect.gen(function* () {
      yield* recordBoundaryCall(boundaryCalls, "replaceTaskClaim")
      yield* Ref.update(replacementCalls, (count) => count + 1)
      const result = yield* takeBoundaryResult(results)
      /* v8 ignore next -- @preserve Story/boundary schemas keep deletion and read results out of replacement positions. */
      if (!result._tag.startsWith("Replacement")) {
        return yield* Effect.die(`expected a replacement result, received ${result._tag}`)
      }
      if (result._tag === "ReplacementApplied" || result._tag === "ReplacementUnknownApplied") {
        const applied = yield* controlled.replaceTaskClaim(request).pipe(Effect.result)
        /* v8 ignore next -- @preserve The controlled boundary is seeded with the exact active claim for applied replacement results. */
        if (applied._tag === "Failure") return yield* applied.failure
        if (result._tag === "ReplacementUnknownApplied") {
          return yield* new CompletionClaimReplacementFailure({
            detail: "replacement response was lost after the tracker applied it",
            outcome: "Unknown",
            request
          })
        }
        return applied.success
      }
      return yield* new CompletionClaimReplacementFailure({
        detail: result._tag === "ReplacementDefinitelyNotApplied" ? result.detail : "replacement response was lost",
        outcome: result._tag === "ReplacementDefinitelyNotApplied" ? "DefinitelyNotApplied" : "Unknown",
        request
      })
    })

  const deleteTaskClaim: CompletionClaimBoundaryService["deleteTaskClaim"] = (request) =>
    Effect.gen(function* () {
      yield* recordBoundaryCall(boundaryCalls, "deleteTaskClaim")
      yield* Ref.update(deletionCalls, (count) => count + 1)
      const result = yield* takeBoundaryResult(results)
      /* v8 ignore next -- @preserve Story/boundary schemas keep replacement and read results out of deletion positions. */
      if (!result._tag.startsWith("Deletion")) {
        return yield* Effect.die(`expected a deletion result, received ${result._tag}`)
      }
      if (result._tag === "DeletionApplied" || result._tag === "DeletionUnknownApplied") {
        const applied = yield* controlled.deleteTaskClaim(request).pipe(Effect.result)
        /* v8 ignore next -- @preserve The controlled boundary is seeded with the exact completion claim for applied deletion results. */
        if (applied._tag === "Failure") return yield* applied.failure
        if (result._tag === "DeletionUnknownApplied") {
          return yield* new CompletionClaimDeletionFailure({
            detail: "deletion response was lost after the tracker applied it",
            outcome: "Unknown",
            request
          })
        }
        return
      }
      return yield* new CompletionClaimDeletionFailure({
        detail: result._tag === "DeletionDefinitelyNotApplied" ? result.detail : "deletion response was lost",
        outcome: result._tag === "DeletionDefinitelyNotApplied" ? "DefinitelyNotApplied" : "Unknown",
        request
      })
    })

  return {
    boundaryCalls,
    deletionCalls,
    readCalls,
    remainingResults: results,
    replacementCalls,
    service: CompletionClaimBoundary.of({ deleteTaskClaim, readTaskClaim, replaceTaskClaim })
  } satisfies ScriptedBoundary
})

const appendFocusedSuccess = Effect.fn("IntegrationFinalityProtocolCassette.appendFocusedSuccess")(function* (
  prepared: PreparedFinality,
  journal: FinalityJournal
) {
  const request = completionTaskRequestFor(prepared.claim)
  const intent = CompletionTaskIntendedEvent.make({ request, version: workflowJournalEventVersion })
  yield* journal.service.append(prepared.runId, describeJournalEvent(intent).expectedKey, intent)
  const trackerRevision = TrackerRevision.make(`integration-finality-protocol-focused:${request.operationId}`)
  const completionBoundary: CompletionTaskBoundaryService = {
    readFocusedTaskCompletion: (taskId, target, operationId) =>
      Effect.succeed({
        currentClaim: prepared.claim,
        lifecycle: "CompletedSuccessfully",
        operationId,
        target,
        targetMembership: "Member",
        taskId,
        taskRevision: prepared.plannedAttempt.taskRevision,
        trackerRevision,
        unfinishedPrerequisiteTaskIds: []
      }),
    completeTask: () => Effect.die("focused-success cassette must not complete the task again"),
    readCompletionRequest: () => Effect.die("focused-success cassette has no ambiguous completion request")
  }
  const focused = yield* readCompletionFocusedFacts(
    completionBoundary,
    request,
    prepared.target,
    CompletionTaskFocusedReadPurpose.cases.Authorization.make({
      attemptOrdinal: CompletionTaskRequestOrdinal.make(1),
      authorizationOrdinal: CompletionTaskAuthorizationReadOrdinal.make(1)
    })
  ).pipe(Effect.provideService(InRunJournal, journal.service))
  return FocusedCompletedTaskObservation.make({
    claim: prepared.claim,
    lifecycle: "CompletedSuccessfully",
    observedAt: focused.observedAt,
    operationId: focused.operationId,
    taskId: prepared.taskId,
    taskRevision: prepared.plannedAttempt.taskRevision,
    trackerRevision,
    target: prepared.target
  })
})

const runReplacement = Effect.fn("IntegrationFinalityProtocolCassette.runReplacement")(function* (
  prepared: PreparedFinality,
  boundary: CompletionClaimBoundaryService,
  journal: FinalityJournal
) {
  const result = yield* runCompletionClaimReplacementProtocol(
    boundary,
    completionClaimReplacementRequestFor(prepared.claim)
  ).pipe(Effect.result, Effect.provideService(InRunJournal, journal.service))
  return result._tag === "Failure" ? result.failure._tag : null
})

const runDeletion = Effect.fn("IntegrationFinalityProtocolCassette.runDeletion")(function* (
  prepared: PreparedFinality,
  boundary: CompletionClaimBoundaryService,
  journal: FinalityJournal,
  successObservation: FocusedCompletedTaskObservation
) {
  const result = yield* runCompletionClaimDeletionProtocol(
    boundary,
    completionClaimDeletionRequestFor(prepared.claim, successObservation),
    completionClaimReplacementOperationIdFor(prepared.claim)
  ).pipe(Effect.result, Effect.provideService(InRunJournal, journal.service))
  return result._tag === "Failure" ? result.failure._tag : null
})

interface StoryState {
  readonly failureTag: string | null
  readonly sawEmptyFrontierWhilePending: boolean
  readonly successObservation: FocusedCompletedTaskObservation | undefined
}

interface ScriptedBoundary {
  readonly boundaryCalls: Ref.Ref<ReadonlyArray<BoundaryCall>>
  readonly deletionCalls: Ref.Ref<number>
  readonly readCalls: Ref.Ref<number>
  readonly remainingResults: Ref.Ref<ReadonlyArray<CompletionClaimProtocolBoundaryResult>>
  readonly replacementCalls: Ref.Ref<number>
  readonly service: CompletionClaimBoundaryService
}

const assertTerminalExpectation = Effect.fn("IntegrationFinalityProtocolCassette.assertTerminalExpectation")(function* (
  state: StoryState,
  boundary: ScriptedBoundary,
  journal: FinalityJournal,
  expected: Extract<CompletionClaimProtocolStoryItem, { readonly _tag: "AwaitSettlement" }>["expected"]
) {
  const records = yield* Ref.get(journal.records)
  const remainingResults = yield* Ref.get(boundary.remainingResults)
  /* v8 ignore next -- @preserve Schema closure proves every declared boundary result belongs to a bounded story. */
  if (remainingResults.length !== 0) {
    return yield* Effect.die(`integration finality cassette left ${remainingResults.length} boundary results unused`)
  }
  const actualTerminal = {
    deletionCalls: yield* Ref.get(boundary.deletionCalls),
    failureTag: state.failureTag,
    journalTags: records.slice(journal.baselineLength).map(({ event }) => event._tag),
    readCalls: yield* Ref.get(boundary.readCalls),
    replacementCalls: yield* Ref.get(boundary.replacementCalls)
  }
  /* v8 ignore next -- @preserve Every maintained cassette asserts its exact terminal observation; mismatch is a cassette authoring defect. */
  if (JSON.stringify(actualTerminal) !== JSON.stringify(expected)) {
    return yield* Effect.die(
      `integration finality terminal mismatch: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actualTerminal)}`
    )
  }
})

const interpretReplacementStep = Effect.fn("IntegrationFinalityProtocolCassette.interpretReplacementStep")(function* (
  state: StoryState,
  prepared: PreparedFinality,
  boundary: ScriptedBoundary,
  journal: FinalityJournal
) {
  return { ...state, failureTag: yield* runReplacement(prepared, boundary.service, journal) }
})

const appendRestartReplacementIntent = Effect.fn("IntegrationFinalityProtocolCassette.appendRestartReplacementIntent")(
  function* (prepared: PreparedFinality, journal: FinalityJournal) {
    const request = completionClaimReplacementRequestFor(prepared.claim)
    const event = CompletionClaimReplacementIntendedEvent.make({
      claim: request.claim,
      operationId: request.operationId,
      version: workflowJournalEventVersion
    })
    yield* journal.service.append(prepared.runId, describeJournalEvent(event).expectedKey, event)
  }
)

const appendRestartDeletionIntent = Effect.fn("IntegrationFinalityProtocolCassette.appendRestartDeletionIntent")(
  function* (
    prepared: PreparedFinality,
    journal: FinalityJournal,
    successObservation: FocusedCompletedTaskObservation
  ) {
    const request = completionClaimDeletionRequestFor(prepared.claim, successObservation)
    const event = CompletionClaimDeletionIntendedEvent.make({
      claim: request.claim,
      operationId: request.operationId,
      successObservation: request.successObservation,
      version: workflowJournalEventVersion
    })
    yield* journal.service.append(prepared.runId, describeJournalEvent(event).expectedKey, event)
  }
)

const interpretDeletionStep = Effect.fn("IntegrationFinalityProtocolCassette.interpretDeletionStep")(function* (
  state: StoryState,
  prepared: PreparedFinality,
  boundary: ScriptedBoundary,
  journal: FinalityJournal
) {
  /* v8 ignore next -- @preserve Schema closure rejects deletion before ObserveFocusedTaskCompletionSuccess. */
  if (state.successObservation === undefined)
    return yield* Effect.die("deletion story has no focused task-completion observation")
  return { ...state, failureTag: yield* runDeletion(prepared, boundary.service, journal, state.successObservation) }
})

type MutationStoryItem = Exclude<
  CompletionClaimProtocolStoryItem,
  { readonly _tag: "ObserveEmptyFrontier" | "AwaitSettlement" }
>

const interpretMutationStoryItem = Effect.fn("IntegrationFinalityProtocolCassette.interpretMutationStoryItem")(
  function* (
    state: StoryState,
    item: MutationStoryItem,
    prepared: PreparedFinality,
    boundary: ScriptedBoundary,
    journal: FinalityJournal
  ) {
    return yield* Match.valueTags(item, {
      RunReplacement: () => interpretReplacementStep(state, prepared, boundary, journal),
      RestartReplacement: () =>
        Effect.gen(function* () {
          yield* appendRestartReplacementIntent(prepared, journal)
          return yield* interpretReplacementStep(state, prepared, boundary, journal)
        }),
      ObserveFocusedTaskCompletionSuccess: () =>
        Effect.gen(function* () {
          return { ...state, successObservation: yield* appendFocusedSuccess(prepared, journal) }
        }),
      RunDeletion: () => interpretDeletionStep(state, prepared, boundary, journal),
      RestartDeletion: () =>
        Effect.gen(function* () {
          /* v8 ignore next -- @preserve Schema ordering rejects deletion restart before ObserveFocusedTaskCompletionSuccess. */
          if (state.successObservation === undefined)
            return yield* Effect.die("deletion restart has no focused task-completion observation")
          yield* appendRestartDeletionIntent(prepared, journal, state.successObservation)
          return yield* interpretDeletionStep(state, prepared, boundary, journal)
        })
    })
  }
)

const interpretStoryItem = Effect.fn("IntegrationFinalityProtocolCassette.interpretStoryItem")(function* (
  state: StoryState,
  item: CompletionClaimProtocolStoryItem,
  prepared: PreparedFinality,
  boundary: ScriptedBoundary,
  journal: FinalityJournal
) {
  if (item._tag === "ObserveEmptyFrontier") {
    return {
      ...state,
      sawEmptyFrontierWhilePending:
        deriveRunFinalityDecision(
          {
            explanations: [
              FrontierExplanation.IntegrationFinalityNonConvergence({
                claim: prepared.claim,
                operationId:
                  state.successObservation === undefined
                    ? completionClaimReplacementOperationIdFor(prepared.claim)
                    : completionClaimDeletionOperationIdFor(prepared.claim),
                phase: state.successObservation === undefined ? "Replacement" : "Deletion",
                plannedAttempt: prepared.plannedAttempt,
                wakeCondition: "ProcessRestartedOrAcceptedFactsChanged"
              })
            ],
            transitions: []
          },
          { entries: [] },
          true
        )._tag === "RunMustRemainActive"
    }
  }
  if (item._tag !== "AwaitSettlement") {
    return yield* interpretMutationStoryItem(state, item, prepared, boundary, journal)
  }
  yield* assertTerminalExpectation(state, boundary, journal, item.expected)
  return state
})

const runPreparedIntegrationFinalityProtocolCassette = Effect.fn("IntegrationFinalityProtocolCassette.runPrepared")(
  function* (cassette: IntegrationFinalityProtocolCassette, prepared: PreparedFinality) {
    const initialRecords = initialRecordsFor(prepared)
    const journal = yield* makeJournal(initialRecords)
    const boundary = yield* scriptedBoundaryFor(prepared, cassette.initialClaim, cassette.boundaryResults).pipe(
      Effect.provide(
        controlledCompletionClaimBoundaryLayerFrom([
          cassette.initialClaim === "Completion"
            ? prepared.claim
            : cassette.initialClaim === "Foreign"
              ? ActiveTaskClaim.make({
                  ...prepared.activeClaim,
                  operationId: OperationId.make("integration-finality-protocol-foreign-claim")
                })
              : prepared.activeClaim
        ])
      )
    )
    let state: StoryState = { failureTag: null, sawEmptyFrontierWhilePending: false, successObservation: undefined }
    for (const item of cassette.story) {
      state = yield* interpretStoryItem(state, item, prepared, boundary, journal)
    }
    const records = yield* Ref.get(journal.records)
    return IntegrationFinalityProtocolCassetteRun.make({
      boundaryCalls: yield* Ref.get(boundary.boundaryCalls),
      deletionCalls: yield* Ref.get(boundary.deletionCalls),
      failureTag: state.failureTag,
      journalTags: records.map(({ event }) => event._tag),
      readCalls: yield* Ref.get(boundary.readCalls),
      records,
      replacementCalls: yield* Ref.get(boundary.replacementCalls),
      sawEmptyFrontierWhilePending: state.sawEmptyFrontierWhilePending
    })
  }
)

/** Replays a bounded completion-claim story through the ordinary production protocols. */
export const runIntegrationFinalityProtocolCassette = Effect.fn("IntegrationFinalityProtocolCassette.run")(function* (
  cassette: IntegrationFinalityProtocolCassette
) {
  return yield* runPreparedIntegrationFinalityProtocolCassette(cassette, yield* makePreparedFinality())
})

/** Continues a valid whole-Run candidate, verification, and promotion history through the finality protocol. */
export const runIntegrationFinalityProtocolCassetteFromPromotedRecords = Effect.fn(
  "IntegrationFinalityProtocolCassette.runFromPromotedRecords"
)(function* (cassette: IntegrationFinalityProtocolCassette, records: ReadonlyArray<JournalRecord>) {
  return yield* runPreparedIntegrationFinalityProtocolCassette(
    cassette,
    yield* preparedFinalityFromPromotedRecords(records)
  )
})
