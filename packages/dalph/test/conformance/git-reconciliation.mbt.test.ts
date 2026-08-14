import { it } from "@effect/vitest"
import { defineDriver, ITFBigInt, stateCheck } from "@firfi/quint-connect/effect"
import { quintIt } from "@firfi/quint-connect/vitest"
import {
  AcceptedResult,
  EvidenceDigest,
  EvidenceReference,
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
import { Context, Effect, Layer, Option, Ref, Schema } from "effect"
import {
  CandidateContinuationLimit,
  CandidateCorrectionLimit,
  continueIntegrationCandidateConstruction,
  decideResultCommitQualification,
  decideGitFactPreservation,
  decideTargetLineage,
  decideTargetPromotion,
  deriveRunnableFrontier,
  deriveIntegrationFrontier,
  FixtureTarget,
  InitialControlPolicy,
  InRunJournal,
  IntegrationCandidateAgent,
  IntegrationCandidateAgentReport,
  IntegrationCandidateGit,
  IntegrationCandidateGitObservation,
  GitReadIntentRecordedEvent,
  IntegrationResponsibilityBeganEvent,
  IntegrationStartedEvent,
  intentRecordKey,
  integrationResponsibilityBeganRecordKey,
  integrationStartedRecordKey,
  JournalPosition,
  JournalStore,
  legacyMemoryJournalStoreLayer,
  makeIntegrationTargetResourceController,
  acquireStartedIntegrationTarget,
  makeTrackerGraphObservationOperation,
  makeTargetLineageObservationOperation,
  latestReconstructedTaskGraph,
  OperationId,
  PromotionTargetObservation,
  projectTrackerSnapshot,
  releaseStartedIntegrationTarget,
  reconstructRunState,
  responsibilityDispositionForTargetLineage,
  ResponsibilityDisposition,
  ResultCommitObservation,
  TaskWorkCapacity,
  TargetLineageObservation,
  TargetVerificationPlan,
  TargetVerificationPlanId,
  TrackerAdapterReadContext,
  TrackerAdapterReadError,
  TrackerAdapterReadFailureReason,
  TrackerGraphReader,
  WorkflowInterpreter,
  controlledWorkflowInterpreterLayer,
  journaledWorkflowInterpreterLayer,
  TargetLineageObservedEvent,
  workflowJournalEventVersion,
  outcomeRecordKey
} from "@dalph/orchestrator"

type Constraint =
  | "NoGitConstraint"
  | "WorktreeLostConstraint"
  | "RegistrationConflictConstraint"
  | "TargetRewriteConstraint"
type Status = "Running" | "SafelySuspended"
type TrackerBlocker = "NoTrackerBlocker" | "BeforePromotionBlocker" | "AfterPromotionBlocker" | "IncompleteTrackerFacts"
type ResourceTransition = Extract<
  ReturnType<typeof deriveIntegrationFrontier>["transitions"][number],
  { readonly _tag: "AcquireStartedIntegrationTarget" | "ReleaseStartedIntegrationTarget" }
>

const base = GitCommitSha.make("1".repeat(40))
const advanced = GitCommitSha.make("2".repeat(40))
const rewritten = GitCommitSha.make("3".repeat(40))
const candidate = GitCommitSha.make("4".repeat(40))
const acceptedProgress = { _tag: "ExecutorResponsibilityBegan" as const, acceptedAt: JournalPosition.make(1) }
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("git-reconciliation-model-attempt"),
  baseSha: base,
  branch: TaskBranchRef.make("refs/heads/dalph/git-reconciliation-model"),
  executor: TaskExecutorLocator.make("executor:model"),
  runId: RunId.make("git-reconciliation-model-run"),
  taskId: TaskId.make("git-reconciliation-model-A"),
  taskRevision: TaskRevision.make("git-reconciliation-model-revision"),
  worktree: WorktreeLocator.make("/worktrees/git-reconciliation-model")
})
const responsibility = {
  _tag: "PlannedAttemptExecutorWorkResponsibility" as const,
  beganAt: JournalPosition.make(1),
  plannedAttempt
}
const independentTask = {
  taskId: TaskId.make("git-reconciliation-model-C"),
  taskRevision: TaskRevision.make("git-reconciliation-model-C-revision")
}

/**
 * The issue-138 model actions use one real journal and one real target-resource
 * owner per driver.  The model projection below is still intentionally small,
 * but every blocker, reread, supersession, and restart goes through the same
 * production append/reconstruct/frontier seams as the coordinator.
 */
const makeProductionReconciliationTrace = () => {
  const context = Effect.runSync(Effect.scoped(Layer.build(legacyMemoryJournalStoreLayer)))
  const journalStore = Context.get(context, JournalStore)
  const journal = Context.get(context, InRunJournal)
  const runId = RunId.make("git-reconciliation-production-run")
  const target = FixtureTarget.make("git-reconciliation-production-target")
  const integrationTarget = IntegrationTarget.make({
    repository: GitRepositoryLocator.make("/repositories/git-reconciliation-production.git"),
    ref: IntegrationTargetRef.make("refs/heads/main")
  })
  const acceptedResult = AcceptedResult.make({
    commit: GitCommitSha.make("8".repeat(40)),
    evidenceManifest: EvidenceReference.make({ byteLength: 1, digest: EvidenceDigest.make("8".repeat(64)) })
  })
  const productionAttempt = PlannedTaskAttempt.make({
    attemptId: AttemptId.make("git-reconciliation-production-attempt"),
    baseSha: base,
    branch: TaskBranchRef.make("refs/heads/dalph/git-reconciliation-production"),
    executor: TaskExecutorLocator.make("executor:git-reconciliation-production"),
    runId,
    taskId: TaskId.make("git-reconciliation-production-A"),
    taskRevision: TaskRevision.make("git-reconciliation-production-revision"),
    worktree: WorktreeLocator.make("/worktrees/git-reconciliation-production")
  })
  const started = {
    _tag: "StartedIntegrationResponsibility" as const,
    acceptedResult,
    integrationTarget,
    plannedAttempt: productionAttempt,
    queuedAt: JournalPosition.make(2),
    startedAt: JournalPosition.make(3)
  }
  const candidateCorrectionLimit = CandidateCorrectionLimit.make(2)
  const candidateContinuationLimit = CandidateContinuationLimit.make(2)
  const targetVerificationPlan = TargetVerificationPlan.make({
    planId: TargetVerificationPlanId.make("git-reconciliation-production-plan"),
    target: integrationTarget
  })
  const candidateForHead = (head: GitCommitSha) => (head === base ? candidate : GitCommitSha.make("5".repeat(40)))
  const candidateAgent = IntegrationCandidateAgent.of({
    startOrContinue: (request) =>
      Effect.succeed(
        IntegrationCandidateAgentReport.cases.Submitted.make({
          candidateCommit: candidateForHead(request.correlation.expectedTargetHead),
          correlation: request.correlation,
          reviewManifest: EvidenceReference.make({ byteLength: 1, digest: EvidenceDigest.make("9".repeat(64)) })
        })
      )
  })
  const candidateGit = IntegrationCandidateGit.of({
    readSubmittedCommit: (_repository, submitted) =>
      Effect.succeed(
        IntegrationCandidateGitObservation.cases.Commit.make({
          directParents: [submitted === candidate ? base : advanced, acceptedResult.commit]
        })
      )
  })
  let resource = Effect.runSync(makeIntegrationTargetResourceController())
  const physicalResponsibility = { integrationTarget, queuedAt: started.queuedAt }
  const initialGraphProjection = projectTrackerSnapshot({
    revision: "git-reconciliation-production-initial",
    tasks: [
      {
        id: started.plannedAttempt.taskId,
        lifecycle: { _tag: "Open" as const },
        parentTaskId: null,
        prerequisiteIds: []
      }
    ]
  })
  if (initialGraphProjection._tag !== "Valid") return Effect.runSync(Effect.die("production MBT initial graph failed"))
  const graphSnapshot = Effect.runSync(Ref.make(initialGraphProjection.snapshot))
  const graphReadMode = Effect.runSync(Ref.make<"Complete" | "Incomplete">("Complete"))
  const trackerReader = TrackerGraphReader.of({
    read: Effect.fn("GitReconciliation.MBT.TrackerGraphReader.read")(function* () {
      if ((yield* Ref.get(graphReadMode)) === "Incomplete") {
        return yield* new TrackerAdapterReadError({
          context: TrackerAdapterReadContext.cases.Fixture.make({ operation: "TrackerGraphReader.selectAdapter" }),
          detail: "controlled tracker read returned an incomplete target closure",
          reason: TrackerAdapterReadFailureReason.cases.IncompleteSnapshot.make({})
        })
      }
      return yield* Ref.get(graphSnapshot)
    }),
    readTaskWorkSpecification: () =>
      Effect.fail(
        new TrackerAdapterReadError({
          context: TrackerAdapterReadContext.cases.Fixture.make({ operation: "TrackerGraphReader.selectAdapter" }),
          detail: "the reconciliation model does not authorize task-work specification reads",
          reason: TrackerAdapterReadFailureReason.cases.UnsupportedTarget.make({})
        })
      )
  })
  const trackerReaderLayer = Layer.succeed(TrackerGraphReader, trackerReader)
  const workflowInterpreterLayer = controlledWorkflowInterpreterLayer.pipe(Layer.provide(trackerReaderLayer))
  const makeJournaledInterpreter = () => {
    const context = Effect.runSync(
      Effect.scoped(
        Layer.build(
          journaledWorkflowInterpreterLayer(runId, workflowInterpreterLayer).pipe(
            Layer.provide(Layer.succeed(InRunJournal, journal))
          )
        )
      )
    )
    return Context.get(context, WorkflowInterpreter)
  }
  let interpreter = makeJournaledInterpreter()
  let targetLineage: TargetLineageObservation = TargetLineageObservation.make({
    plannedBaseIsAncestorOfTargetHead: true,
    plannedBaseSha: base,
    targetHeadSha: base
  })
  let operationOrdinal = 0

  const append = (
    key: Parameters<InRunJournal["Service"]["append"]>[1],
    event: Parameters<InRunJournal["Service"]["append"]>[2]
  ) => Effect.runSync(journal.append(runId, key, event))
  const records = () => Effect.runSync(journal.read(runId))
  const reconstruct = () => {
    const result = reconstructRunState(runId, records())
    if (result._tag !== "ValidReconstructedRun")
      return Effect.runSync(Effect.die(`production MBT trace reconstruction failed: ${result._tag}`))
    return result.state
  }
  const frontier = () => {
    const state = reconstruct()
    const resourceSnapshot = Effect.runSync(resource.snapshot)
    const currentGraph = latestReconstructedTaskGraph(state.graphKnowledge)
    const trackerReadUnavailable = state.graphKnowledge.taskTrackerFacts.at(-1)?._tag === "TaskTrackerFactsReadFailed"
    return {
      state,
      frontier: deriveIntegrationFrontier(state, {
        currentTrackerTaskIds: trackerReadUnavailable
          ? new Set()
          : Option.match(currentGraph, { onNone: () => new Set(), onSome: (graph) => new Set(graph.taskIds()) }),
        heldResponsibilityPositions: resourceSnapshot.heldResponsibilityPositions,
        integrationTarget: Option.some(integrationTarget),
        candidateCorrectionLimit: Option.some(candidateCorrectionLimit),
        candidateContinuationLimit: Option.some(candidateContinuationLimit),
        targetVerificationPlan: Option.some(targetVerificationPlan),
        targetLineageByAttemptId: new Map([[productionAttempt.attemptId, targetLineage]]),
        targetPromotionConfigured: true,
        taskClaimAuthorityByAttemptId: new Map([[productionAttempt.attemptId, { _tag: "Exact" as const }]])
      }),
      held: resourceSnapshot.heldResponsibilityPositions.has(started.queuedAt),
      records: records()
    }
  }
  const graphSnapshotFor = (revision: string, prerequisiteCleared: boolean, prerequisiteComplete: boolean) => {
    const blockerId = TaskId.make("git-reconciliation-production-B")
    const independentId = TaskId.make("git-reconciliation-production-C")
    const operation = makeTrackerGraphObservationOperation(
      OperationId.make(`git-reconciliation-production-graph-${revision}-${++operationOrdinal}`),
      target,
      [],
      [started.plannedAttempt.taskId, blockerId, independentId]
    )
    const projected = projectTrackerSnapshot({
      revision,
      tasks: [
        {
          id: started.plannedAttempt.taskId,
          lifecycle: { _tag: "Open" as const },
          parentTaskId: null,
          prerequisiteIds: prerequisiteCleared ? [] : [blockerId]
        },
        {
          id: blockerId,
          lifecycle: prerequisiteComplete ? { _tag: "CompletedSuccessfully" as const } : { _tag: "Open" as const },
          parentTaskId: null,
          prerequisiteIds: []
        },
        { id: independentId, lifecycle: { _tag: "Open" as const }, parentTaskId: null, prerequisiteIds: [] }
      ]
    })
    if (projected._tag !== "Valid") return Effect.runSync(Effect.die("production MBT graph projection failed"))
    return { operation, snapshot: projected.snapshot }
  }
  const readGraph = (revision: string, prerequisiteCleared: boolean, prerequisiteComplete: boolean) => {
    const { operation, snapshot } = graphSnapshotFor(revision, prerequisiteCleared, prerequisiteComplete)
    Effect.runSync(Ref.set(graphSnapshot, snapshot))
    Effect.runSync(Ref.set(graphReadMode, "Complete"))
    return Effect.runSync(
      interpreter.readTrackerGraph(operation).pipe(Effect.andThen(Effect.sync(frontier)), Effect.orDie)
    )
  }
  const readIncompleteTrackerGraph = () => {
    const operation = makeTrackerGraphObservationOperation(
      OperationId.make(`git-reconciliation-production-incomplete-${++operationOrdinal}`),
      target,
      [],
      [started.plannedAttempt.taskId]
    )
    Effect.runSync(Ref.set(graphReadMode, "Incomplete"))
    const failure = Effect.runSync(interpreter.readTrackerGraph(operation).pipe(Effect.flip, Effect.orDie))
    if (failure._tag !== "TrackerGraphReader.AdapterReadError") {
      return Effect.runSync(Effect.die(`production MBT read failure changed surface to ${failure._tag}`))
    }
    interpreter = makeJournaledInterpreter()
    const replay = Effect.runSync(interpreter.readTrackerGraph(operation).pipe(Effect.flip, Effect.orDie))
    if (replay._tag !== "TaskTrackerFactsReadUnavailable") {
      return Effect.runSync(Effect.die(`production MBT restart replay changed surface to ${replay._tag}`))
    }
    const blocked = frontier()
    if (
      !blocked.frontier.explanations.some(({ _tag }) => _tag === "IntegrationTrackerFactsWait") ||
      blocked.held !== true
    ) {
      return Effect.runSync(Effect.die("production MBT incomplete read did not produce a held-resource wait"))
    }
    applyResourceTransition()
    Effect.runSync(Ref.set(graphReadMode, "Complete"))
    const recovery = makeTrackerGraphObservationOperation(
      OperationId.make(`git-reconciliation-production-recovery-${++operationOrdinal}`),
      target,
      [operation.operationId]
    )
    Effect.runSync(interpreter.readTrackerGraph(recovery).pipe(Effect.orDie))
    return frontier()
  }
  const applyResourceTransition = () => {
    const isResourceTransition = (
      candidate: ReturnType<typeof frontier>["frontier"]["transitions"][number]
    ): candidate is ResourceTransition =>
      candidate._tag === "AcquireStartedIntegrationTarget" || candidate._tag === "ReleaseStartedIntegrationTarget"
    const transition = frontier().frontier.transitions.find(isResourceTransition)
    if (transition === undefined) return Effect.runSync(Effect.die("production MBT expected a resource transition"))
    if (transition._tag === "AcquireStartedIntegrationTarget") {
      Effect.runSync(acquireStartedIntegrationTarget(resource, transition).pipe(Effect.orDie))
    } else {
      Effect.runSync(releaseStartedIntegrationTarget(resource, transition).pipe(Effect.orDie))
    }
    return frontier()
  }
  const targetRead = (head: GitCommitSha, compatible: boolean) => {
    const operation = makeTargetLineageObservationOperation({
      integrationTarget,
      operationId: OperationId.make(`git-reconciliation-production-lineage-${++operationOrdinal}`),
      plannedAttempt: productionAttempt,
      predecessorOperationIds: []
    })
    targetLineage = TargetLineageObservation.make({
      plannedBaseIsAncestorOfTargetHead: compatible,
      plannedBaseSha: base,
      targetHeadSha: head
    })
    append(
      intentRecordKey(operation.operationId),
      GitReadIntentRecordedEvent.make({
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        operation,
        version: workflowJournalEventVersion
      })
    )
    append(
      outcomeRecordKey(operation.operationId),
      TargetLineageObservedEvent.make({
        observation: targetLineage,
        occurrenceClassification: "NonActionOccurrence",
        operationId: operation.operationId,
        plannedAttempt: productionAttempt,
        version: workflowJournalEventVersion
      })
    )
    return frontier()
  }
  const candidateProtocol = (lineage: TargetLineageObservation) =>
    Effect.runSync(
      continueIntegrationCandidateConstruction(
        started,
        lineage,
        candidateCorrectionLimit,
        candidateContinuationLimit
      ).pipe(
        Effect.provideService(InRunJournal, journal),
        Effect.provideService(IntegrationCandidateAgent, candidateAgent),
        Effect.provideService(IntegrationCandidateGit, candidateGit)
      )
    )
  const recordUnrelatedSession = () => {
    const unrelatedAttempt = PlannedTaskAttempt.make({
      attemptId: AttemptId.make("git-reconciliation-production-unrelated-attempt"),
      baseSha: base,
      branch: TaskBranchRef.make("refs/heads/dalph/git-reconciliation-production-unrelated"),
      executor: TaskExecutorLocator.make("executor:git-reconciliation-production-unrelated"),
      runId,
      taskId: TaskId.make("git-reconciliation-production-C"),
      taskRevision: TaskRevision.make("git-reconciliation-production-unrelated-revision"),
      worktree: WorktreeLocator.make("/worktrees/git-reconciliation-production-unrelated")
    })
    const unrelatedTarget = IntegrationTarget.make({
      repository: GitRepositoryLocator.make("/repositories/git-reconciliation-production-unrelated.git"),
      ref: IntegrationTargetRef.make("refs/heads/main")
    })
    const unrelatedResult = AcceptedResult.make({
      commit: acceptedResult.commit,
      evidenceManifest: acceptedResult.evidenceManifest
    })
    const began = append(
      integrationResponsibilityBeganRecordKey(unrelatedAttempt.attemptId),
      IntegrationResponsibilityBeganEvent.make({
        acceptedResult: unrelatedResult,
        integrationTarget: unrelatedTarget,
        plannedAttempt: unrelatedAttempt,
        version: workflowJournalEventVersion
      })
    )
    const startedRecord = append(
      integrationStartedRecordKey(unrelatedAttempt.attemptId),
      IntegrationStartedEvent.make({
        acceptedResult: unrelatedResult,
        integrationTarget: unrelatedTarget,
        plannedAttempt: unrelatedAttempt,
        responsibilityBeganAt: began.position,
        version: workflowJournalEventVersion
      })
    )
    const unrelated = {
      _tag: "StartedIntegrationResponsibility" as const,
      acceptedResult: unrelatedResult,
      integrationTarget: unrelatedTarget,
      plannedAttempt: unrelatedAttempt,
      queuedAt: began.position,
      startedAt: startedRecord.position
    }
    Effect.runSync(
      continueIntegrationCandidateConstruction(
        unrelated,
        TargetLineageObservation.make({
          plannedBaseIsAncestorOfTargetHead: true,
          plannedBaseSha: base,
          targetHeadSha: base
        }),
        candidateCorrectionLimit,
        candidateContinuationLimit
      ).pipe(
        Effect.provideService(InRunJournal, journal),
        Effect.provideService(IntegrationCandidateAgent, candidateAgent),
        Effect.provideService(IntegrationCandidateGit, candidateGit)
      )
    )
    return records().filter(
      ({ event }) =>
        event._tag === "IntegrationCandidateConstructionIntended" &&
        event.plannedAttempt.taskId === unrelatedAttempt.taskId
    ).length
  }

  Effect.runSync(
    journalStore.beginRun(runId, target, InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(2) }))
  )
  append(
    integrationResponsibilityBeganRecordKey(productionAttempt.attemptId),
    IntegrationResponsibilityBeganEvent.make({
      acceptedResult,
      integrationTarget,
      plannedAttempt: productionAttempt,
      version: workflowJournalEventVersion
    })
  )
  append(
    integrationStartedRecordKey(productionAttempt.attemptId),
    IntegrationStartedEvent.make({
      acceptedResult,
      integrationTarget,
      plannedAttempt: productionAttempt,
      responsibilityBeganAt: started.queuedAt,
      version: workflowJournalEventVersion
    })
  )
  Effect.runSync(resource.acquire(physicalResponsibility))
  Effect.runSync(resource.publishAcceptedOwnership(physicalResponsibility))
  candidateProtocol(targetLineage)

  return {
    readGraph,
    readIncompleteTrackerGraph,
    appendTargetRead: targetRead,
    candidateProtocol,
    recordUnrelatedSession,
    frontier,
    records,
    applyResourceTransition,
    restart: () => {
      resource = Effect.runSync(makeIntegrationTargetResourceController())
      interpreter = makeJournaledInterpreter()
    },
    started,
    targetLineage
  }
}

const SpecProjection = Schema.Struct({
  state: Schema.Struct({
    candidateVerified: Schema.Boolean,
    candidatePreserved: Schema.Boolean,
    claimPreserved: Schema.Boolean,
    compareAndSetAuthorized: Schema.Boolean,
    completionAccepted: Schema.Boolean,
    completionAuthorized: Schema.Boolean,
    completionWarning: Schema.Boolean,
    compatibleAdvanceObserved: Schema.Boolean,
    constraint: Schema.Unknown,
    decision: Schema.Unknown,
    evidencePreserved: Schema.Boolean,
    exactExpectedHeadObserved: Schema.Boolean,
    focusedCompletionConfirmed: Schema.Boolean,
    independentTaskEligible: Schema.Boolean,
    independentTaskSelected: Schema.Boolean,
    overwriteAuthorized: Schema.Boolean,
    positionHeld: Schema.Boolean,
    repairAuthorized: Schema.Boolean,
    resultRejected: Schema.Boolean,
    resultRejection: Schema.Unknown,
    priorSupersessionCount: ITFBigInt,
    promotedCandidateAncestryProven: Schema.Boolean,
    promotionProof: Schema.Boolean,
    reintegrationAuthorized: Schema.Boolean,
    sessionSuperseded: Schema.Boolean,
    status: Schema.Unknown,
    successorOrdinal: ITFBigInt,
    successorStarted: Schema.Boolean,
    trackerBlocker: Schema.Unknown,
    unrelatedSupersessionCount: ITFBigInt,
    worktreePreserved: Schema.Boolean
  })
})

const variantTag = (value: unknown): string =>
  typeof value === "object" && value !== null && "tag" in value ? String(value.tag) : String(value)

const gitDecisionFromFrontier = (constraint: Constraint, status: Status): string => {
  const disposition =
    constraint === "NoGitConstraint"
      ? { _tag: "Ready" as const, acceptedProgress }
      : status === "Running"
        ? ResponsibilityDisposition.PlannedAttemptExecutorSuspensionRequested()
        : ResponsibilityDisposition.PlannedAttemptGitConstraint({
            gitState:
              constraint === "TargetRewriteConstraint"
                ? "TargetRewrite"
                : constraint === "WorktreeLostConstraint"
                  ? "WorktreeLost"
                  : "CompetingWorktreeRegistrations"
          })
  const frontier = deriveRunnableFrontier({
    freshEligibleTasks: [],
    responsibility: { entries: [responsibility] },
    responsibilityFacts: [{ _tag: "PlannedAttemptExecutorFreshFacts", disposition, responsibility }]
  })
  if (frontier.transitions[0]?._tag === "ContinuePlannedAttemptExecutorWork") return "ContinueAttempt"
  if (frontier.transitions[0]?._tag === "SuspendPlannedAttemptExecutorWork") return "RequestSafeSuspension"
  if (frontier.explanations[0]?._tag === "PlannedAttemptGitConstraint") return "GitConstraintWait"
  return Effect.runSync(Effect.die("production frontier returned no Git reconciliation decision"))
}

const gitReconciliationDriver = defineDriver(
  {
    init: {},
    acceptCompletionAcrossPrerequisiteRace: {},
    observeAmbiguousTargetAfterVerification: {},
    observeCompatibleTargetAdvance: {},
    observeEligibleResultCommit: {},
    observeExactExpectedTargetWithVerifiedCandidate: {},
    observeExactTargetWithUnverifiedCandidate: {},
    observeFreshPromotedCandidateAncestry: {},
    observeFreshTargetAfterPrePromotionBlocker: {},
    observeIncompleteTrackerFacts: {},
    observeIncompatibleTargetRewrite: {},
    observeLostWorktree: {},
    observeMissingResultCommit: {},
    observePostPromotionDependencyBlocker: {},
    observePrePromotionDependencyBlocker: {},
    reopenPrePromotionBlockerAfterRestart: {},
    observeNonDescendantResultCommit: {},
    observeRegistrationConflict: {},
    observeStaleTargetAfterVerification: {},
    clearDerivedCompletionWarning: {},
    clearPostPromotionDependencyBlocker: {},
    clearPrePromotionDependencyBlocker: {},
    completeAfterPromotedCandidateAncestry: {},
    recordIntegrationSessionSupersession: {},
    recordUnrelatedSessionSupersession: {},
    reportSafelySuspended: {},
    selectIndependentTask: {},
    startOneSuccessorCandidate: {}
  },
  () => {
    const production = makeProductionReconciliationTrace()
    let status: Status = "Running"
    let constraint: Constraint = "NoGitConstraint"
    let decision = "ContinueAttempt"
    let compatibleAdvanceObserved = false
    let resultRejected = false
    let resultRejection = "NoResultRejection"
    let candidatePreserved = true
    let promotionProof = false
    let trackerBlocker: TrackerBlocker = "NoTrackerBlocker"
    let priorSupersessionCount = 0
    let unrelatedSupersessionCount = 0
    let successorOrdinal = 0
    let sessionSuperseded = false
    let successorStarted = false
    let promotedCandidateAncestryProven = false
    let completionAuthorized = false
    let completionAccepted = false
    let focusedCompletionConfirmed = false
    let completionWarning = false
    let reintegrationAuthorized = false
    let independentTaskSelected = false
    let exactExpectedHeadObserved = false
    let candidateVerified = false
    let compareAndSetAuthorized = false
    let overwriteAuthorized = false
    let claimPreserved = true
    let evidencePreserved = true
    let repairAuthorized = false
    let worktreePreserved = true
    let positionHeld = true

    const applyPreservation = (proof: {
      readonly claimPreserved: true
      readonly evidencePreserved: true
      readonly repairAuthorized: false
      readonly worktreePreserved: true
    }) => {
      claimPreserved = proof.claimPreserved
      evidencePreserved = proof.evidencePreserved
      repairAuthorized = proof.repairAuthorized
      worktreePreserved = proof.worktreePreserved
    }

    const constrain = (next: Exclude<Constraint, "NoGitConstraint">) =>
      Effect.sync(() => {
        applyPreservation(decideGitFactPreservation(next))
        constraint = next
        compatibleAdvanceObserved = false
        decision = gitDecisionFromFrontier(constraint, status)
      })
    const qualifyResult = (observation: ResultCommitObservation) =>
      Effect.sync(() => {
        const result = decideResultCommitQualification(observation)
        decision = result._tag
        resultRejected = result._tag === "ResultCommitRejected"
        if (result._tag === "ResultCommitRejected") {
          claimPreserved = result.claimPreserved
          evidencePreserved = result.evidencePreserved
          worktreePreserved = result.preserveWorktree
        }
        resultRejection =
          result._tag === "ResultCommitRejected"
            ? result.reason === "Missing"
              ? "MissingResultCommit"
              : "NonDescendantResultCommit"
            : "NoResultRejection"
      })
    const decidePromotion = (target: PromotionTargetObservation, candidateVerifiedAgainstExpectedHead: boolean) =>
      Effect.sync(() => {
        const result = decideTargetPromotion({
          candidateSha: candidate,
          candidateVerifiedAgainstExpectedHead,
          expectedHeadSha: advanced,
          target
        })
        decision = result._tag
        exactExpectedHeadObserved = target._tag === "ExactTargetHead" && target.currentHeadSha === advanced
        candidateVerified = candidateVerifiedAgainstExpectedHead
        compareAndSetAuthorized = result.compareAndSetAuthorized
        overwriteAuthorized = result.overwriteAuthorized
        promotionProof = result._tag === "PromoteByExactCompareAndSet" && candidateVerifiedAgainstExpectedHead
      })

    return {
      init: () =>
        Effect.sync(() => {
          status = "Running"
          constraint = "NoGitConstraint"
          decision = "ContinueAttempt"
          compatibleAdvanceObserved = false
          resultRejected = false
          resultRejection = "NoResultRejection"
          candidatePreserved = true
          promotionProof = false
          trackerBlocker = "NoTrackerBlocker"
          priorSupersessionCount = 0
          unrelatedSupersessionCount = 0
          successorOrdinal = 0
          sessionSuperseded = false
          successorStarted = false
          promotedCandidateAncestryProven = false
          completionAuthorized = false
          completionAccepted = false
          focusedCompletionConfirmed = false
          completionWarning = false
          reintegrationAuthorized = false
          positionHeld = true
          independentTaskSelected = false
          exactExpectedHeadObserved = false
          candidateVerified = false
          compareAndSetAuthorized = false
          overwriteAuthorized = false
          applyPreservation(decideGitFactPreservation("NoGitConstraint"))
        }),
      observeAmbiguousTargetAfterVerification: () =>
        decidePromotion(PromotionTargetObservation.cases.AmbiguousTargetHead.make({}), true),
      observePrePromotionDependencyBlocker: () =>
        Effect.sync(() => {
          const result = production.readGraph("before-promotion-blocker", false, false)
          production.applyResourceTransition()
          const current = production.frontier()
          positionHeld = current.held
          decision = current.frontier.explanations.some(({ _tag }) => _tag === "IntegrationDependencyWait")
            ? "GitConstraintWait"
            : "ContinueAttempt"
          trackerBlocker = result.frontier.explanations.some(({ _tag }) => _tag === "IntegrationDependencyWait")
            ? "BeforePromotionBlocker"
            : "NoTrackerBlocker"
        }),
      reopenPrePromotionBlockerAfterRestart: () =>
        Effect.sync(() => {
          production.restart()
          const current = production.frontier()
          positionHeld = current.held
          decision = "GitConstraintWait"
        }),
      clearPrePromotionDependencyBlocker: () =>
        Effect.sync(() => {
          production.readGraph("clear-pre-promotion-edge", true, false)
          production.applyResourceTransition()
          const current = production.frontier()
          positionHeld = current.held
          exactExpectedHeadObserved = false
          compareAndSetAuthorized = false
          overwriteAuthorized = false
          decision = "RereadTargetBeforePromotion"
          trackerBlocker = current.frontier.explanations.some(({ _tag }) => _tag === "IntegrationDependencyWait")
            ? "BeforePromotionBlocker"
            : "NoTrackerBlocker"
        }),
      observeFreshTargetAfterPrePromotionBlocker: () =>
        Effect.sync(() => {
          const current = production.appendTargetRead(advanced, true)
          compatibleAdvanceObserved = current.records.some(
            ({ event }) => event._tag === "TargetLineageObserved" && event.observation.targetHeadSha === advanced
          )
          decision = "ContinueAttempt"
        }),
      recordIntegrationSessionSupersession: () =>
        Effect.sync(() => {
          production.candidateProtocol(
            TargetLineageObservation.make({
              plannedBaseIsAncestorOfTargetHead: true,
              plannedBaseSha: base,
              targetHeadSha: advanced
            })
          )
          priorSupersessionCount = production
            .records()
            .filter(({ event }) => event._tag === "IntegrationCandidateSessionSuperseded").length
          sessionSuperseded = priorSupersessionCount === 1
          decision = "ContinueAttempt"
        }),
      recordUnrelatedSessionSupersession: () =>
        Effect.sync(() => {
          unrelatedSupersessionCount = production.recordUnrelatedSession()
        }),
      startOneSuccessorCandidate: () =>
        Effect.sync(() => {
          production.candidateProtocol(
            TargetLineageObservation.make({
              plannedBaseIsAncestorOfTargetHead: true,
              plannedBaseSha: base,
              targetHeadSha: advanced
            })
          )
          const successorIntents = production
            .records()
            .filter(
              ({ event }) =>
                event._tag === "IntegrationCandidateConstructionIntended" &&
                event.plannedAttempt.attemptId === production.started.plannedAttempt.attemptId
            ).length
          successorOrdinal = Math.max(0, successorIntents - 1)
          successorStarted = successorIntents === 2
          decision = "ContinueAttempt"
        }),
      observePostPromotionDependencyBlocker: () =>
        Effect.sync(() => {
          const current = production.readGraph("after-promotion-blocker", false, false)
          production.applyResourceTransition()
          positionHeld = production.frontier().held
          exactExpectedHeadObserved = false
          compareAndSetAuthorized = false
          overwriteAuthorized = false
          decision = current.frontier.explanations.some(({ _tag }) => _tag === "IntegrationDependencyWait")
            ? "GitConstraintWait"
            : "ContinueAttempt"
          trackerBlocker = "AfterPromotionBlocker"
        }),
      clearPostPromotionDependencyBlocker: () =>
        Effect.sync(() => {
          production.readGraph("clear-post-promotion-blocker", false, true)
          production.applyResourceTransition()
          positionHeld = production.frontier().held
          exactExpectedHeadObserved = false
          compareAndSetAuthorized = false
          overwriteAuthorized = false
          decision = "RereadTargetBeforePromotion"
          trackerBlocker = "NoTrackerBlocker"
        }),
      observeFreshPromotedCandidateAncestry: () =>
        Effect.sync(() => {
          const current = production.appendTargetRead(candidate, true)
          promotedCandidateAncestryProven = current.records.some(
            ({ event }) => event._tag === "TargetLineageObserved" && event.observation.targetHeadSha === candidate
          )
          decision = "ContinueAttempt"
        }),
      completeAfterPromotedCandidateAncestry: () =>
        Effect.sync(() => {
          const current = production.frontier()
          completionAuthorized = current.frontier.explanations.every(({ _tag }) => _tag !== "IntegrationDependencyWait")
          decision = "ContinueAttempt"
        }),
      observeIncompleteTrackerFacts: () =>
        Effect.sync(() => {
          production.readIncompleteTrackerGraph()
          positionHeld = production.frontier().held
          decision = "GitConstraintWait"
          trackerBlocker = "IncompleteTrackerFacts"
        }),
      acceptCompletionAcrossPrerequisiteRace: () =>
        Effect.sync(() => {
          const current = production.readGraph("completion-race-reopened", false, false)
          completionAccepted = current.records.some(({ event }) => event._tag === "TaskTrackerFactsObserved")
          focusedCompletionConfirmed = completionAccepted
          completionWarning = current.frontier.explanations.some(({ _tag }) => _tag === "IntegrationDependencyWait")
        }),
      clearDerivedCompletionWarning: () =>
        Effect.sync(() => {
          const current = production.readGraph("completion-race-cleared", false, true)
          completionWarning = current.frontier.explanations.some(({ _tag }) => _tag === "IntegrationDependencyWait")
        }),
      observeCompatibleTargetAdvance: () =>
        Effect.sync(() => {
          const lineage = decideTargetLineage(
            TargetLineageObservation.make({
              plannedBaseIsAncestorOfTargetHead: true,
              plannedBaseSha: base,
              targetHeadSha: advanced
            })
          )
          compatibleAdvanceObserved = true
          decision =
            responsibilityDispositionForTargetLineage(acceptedProgress, lineage, false)._tag === "Ready"
              ? "ContinueAttempt"
              : "RequestSafeSuspension"
        }),
      observeEligibleResultCommit: () =>
        qualifyResult(
          ResultCommitObservation.cases.ResultCommitPresent.make({
            plannedBaseIsAncestorOfResultCommit: true,
            plannedBaseSha: base,
            resultCommitSha: candidate
          })
        ),
      observeExactExpectedTargetWithVerifiedCandidate: () =>
        decidePromotion(PromotionTargetObservation.cases.ExactTargetHead.make({ currentHeadSha: advanced }), true),
      observeExactTargetWithUnverifiedCandidate: () =>
        decidePromotion(PromotionTargetObservation.cases.ExactTargetHead.make({ currentHeadSha: advanced }), false),
      observeIncompatibleTargetRewrite: () =>
        Effect.sync(() => {
          const lineage = decideTargetLineage(
            TargetLineageObservation.make({
              plannedBaseIsAncestorOfTargetHead: false,
              plannedBaseSha: base,
              targetHeadSha: rewritten
            })
          )
          if (lineage._tag !== "IncompatibleTargetRewrite") {
            return Effect.runSync(
              Effect.die("the production lineage decision contradicted the incompatible observation")
            )
          }
          constraint = "TargetRewriteConstraint"
          applyPreservation(lineage)
          compatibleAdvanceObserved = false
          decision =
            responsibilityDispositionForTargetLineage(acceptedProgress, lineage, false)._tag ===
            "PlannedAttemptExecutorSuspensionRequested"
              ? "RequestSafeSuspension"
              : "ContinueAttempt"
        }),
      observeLostWorktree: () => constrain("WorktreeLostConstraint"),
      observeMissingResultCommit: () =>
        qualifyResult(ResultCommitObservation.cases.ResultCommitMissing.make({ plannedBaseSha: base })),
      observeNonDescendantResultCommit: () =>
        qualifyResult(
          ResultCommitObservation.cases.ResultCommitPresent.make({
            plannedBaseIsAncestorOfResultCommit: false,
            plannedBaseSha: base,
            resultCommitSha: candidate
          })
        ),
      observeRegistrationConflict: () => constrain("RegistrationConflictConstraint"),
      observeStaleTargetAfterVerification: () =>
        decidePromotion(PromotionTargetObservation.cases.ExactTargetHead.make({ currentHeadSha: rewritten }), true),
      reportSafelySuspended: () =>
        Effect.sync(() => {
          status = "SafelySuspended"
          positionHeld = false
          decision = gitDecisionFromFrontier(constraint, status)
        }),
      selectIndependentTask: () =>
        Effect.sync(() => {
          const disposition =
            constraint === "TargetRewriteConstraint"
              ? ResponsibilityDisposition.PlannedAttemptGitConstraint({ gitState: "TargetRewrite" })
              : constraint === "WorktreeLostConstraint"
                ? ResponsibilityDisposition.PlannedAttemptGitConstraint({ gitState: "WorktreeLost" })
                : constraint === "RegistrationConflictConstraint"
                  ? ResponsibilityDisposition.PlannedAttemptGitConstraint({
                      gitState: "CompetingWorktreeRegistrations"
                    })
                  : { _tag: "Ready" as const, acceptedProgress }
          independentTaskSelected = deriveRunnableFrontier({
            freshEligibleTasks: [independentTask],
            responsibility: { entries: [responsibility] },
            responsibilityFacts: [{ _tag: "PlannedAttemptExecutorFreshFacts", disposition, responsibility }]
          }).transitions.some(
            (transition) =>
              transition._tag === "CommitFreshTaskClaimIntent" && transition.taskId === independentTask.taskId
          )
        }),
      getState: () =>
        Effect.sync(() => ({
          candidateVerified,
          candidatePreserved,
          claimPreserved,
          compareAndSetAuthorized,
          compatibleAdvanceObserved,
          completionAccepted,
          completionAuthorized,
          completionWarning,
          constraint,
          decision,
          evidencePreserved,
          exactExpectedHeadObserved,
          focusedCompletionConfirmed,
          independentTaskEligible: true,
          independentTaskSelected,
          overwriteAuthorized,
          positionHeld,
          repairAuthorized,
          resultRejected,
          resultRejection,
          priorSupersessionCount,
          promotedCandidateAncestryProven,
          promotionProof,
          reintegrationAuthorized,
          sessionSuperseded,
          status,
          successorOrdinal,
          successorStarted,
          trackerBlocker,
          unrelatedSupersessionCount,
          worktreePreserved
        }))
    }
  }
)

quintIt(
  it.effect,
  "replays Git reconciliation through production decisions and frontier dispositions",
  {
    backend: "typescript",
    driverFactory: gitReconciliationDriver,
    maxSteps: 12,
    nTraces: 100,
    seed: "139",
    spec: "specs/gitReconciliation.qnt",
    stateCheck: stateCheck(
      (raw) =>
        Effect.sync(() => {
          return raw
        }).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(SpecProjection)),
          Effect.map(({ state }) => ({
            ...state,
            constraint: variantTag(state.constraint),
            decision: variantTag(state.decision),
            priorSupersessionCount: Number(state.priorSupersessionCount),
            resultRejection: variantTag(state.resultRejection),
            status: variantTag(state.status),
            successorOrdinal: Number(state.successorOrdinal),
            trackerBlocker: variantTag(state.trackerBlocker),
            unrelatedSupersessionCount: Number(state.unrelatedSupersessionCount)
          })),
          Effect.orDie
        ),
      (spec, implementation) =>
        spec.candidateVerified === implementation.candidateVerified &&
        spec.candidatePreserved === implementation.candidatePreserved &&
        spec.claimPreserved === implementation.claimPreserved &&
        spec.compareAndSetAuthorized === implementation.compareAndSetAuthorized &&
        spec.compatibleAdvanceObserved === implementation.compatibleAdvanceObserved &&
        spec.completionAccepted === implementation.completionAccepted &&
        spec.completionAuthorized === implementation.completionAuthorized &&
        spec.completionWarning === implementation.completionWarning &&
        spec.constraint === implementation.constraint &&
        spec.decision === implementation.decision &&
        spec.evidencePreserved === implementation.evidencePreserved &&
        spec.exactExpectedHeadObserved === implementation.exactExpectedHeadObserved &&
        spec.focusedCompletionConfirmed === implementation.focusedCompletionConfirmed &&
        spec.independentTaskEligible === implementation.independentTaskEligible &&
        spec.independentTaskSelected === implementation.independentTaskSelected &&
        spec.overwriteAuthorized === implementation.overwriteAuthorized &&
        spec.positionHeld === implementation.positionHeld &&
        spec.repairAuthorized === implementation.repairAuthorized &&
        spec.resultRejected === implementation.resultRejected &&
        spec.resultRejection === implementation.resultRejection &&
        Number(spec.priorSupersessionCount) === implementation.priorSupersessionCount &&
        spec.promotedCandidateAncestryProven === implementation.promotedCandidateAncestryProven &&
        spec.promotionProof === implementation.promotionProof &&
        spec.reintegrationAuthorized === implementation.reintegrationAuthorized &&
        spec.sessionSuperseded === implementation.sessionSuperseded &&
        spec.status === implementation.status &&
        Number(spec.successorOrdinal) === implementation.successorOrdinal &&
        spec.successorStarted === implementation.successorStarted &&
        spec.trackerBlocker === implementation.trackerBlocker &&
        Number(spec.unrelatedSupersessionCount) === implementation.unrelatedSupersessionCount &&
        spec.worktreePreserved === implementation.worktreePreserved
    )
  },
  30_000
)
