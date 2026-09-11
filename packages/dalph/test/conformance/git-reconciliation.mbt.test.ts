import { expect, it } from "@effect/vitest"
import { defineDriver, quintRun, stateCheck } from "@firfi/quint-connect/effect"
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
  WorktreeLocator,
  makeTaskWorkSpecification
} from "@dalph/contracts"
import { Context, Effect, Layer, Option, Ref, Schema, Scope, ScopedRef } from "effect"
import { ActiveTaskClaim } from "../../../orchestrator/src/authorities/task-tracker/claim-mutation.js"
import { ClaimOwner, ClaimToken } from "../../../orchestrator/src/authorities/task-tracker/claim.js"
import { makeAcceptedIntegrationHistory } from "../../../orchestrator/test/support/accepted-integration-history.js"
import { observeWorkflowJournalValidationSteps } from "../../../orchestrator/src/coordination/reconstruction/history.js"
import {
  decideResultCommitQualification,
  decideGitFactPreservation,
  decideTargetLineage,
  decideTargetPromotion,
  PromotionTargetObservation,
  ResultCommitObservation
} from "../../../orchestrator/src/workflow/protocols/git-reconciliation/decision.js"
import { responsibilityDispositionForTargetLineage } from "../../../orchestrator/src/workflow/protocols/git-reconciliation/frontier-adapter.js"
import { deriveRunnableFrontier } from "../../../orchestrator/src/coordination/frontier/frontier.js"
import { deriveIntegrationFrontier } from "../../../orchestrator/src/coordination/frontier/integration-frontier.js"
import { ResponsibilityDisposition } from "../../../orchestrator/src/coordination/frontier/fresh-facts.js"
import { FixtureTarget } from "../../../orchestrator/src/authorities/task-tracker/fixture/target.js"
import {
  TrackerGraphReader,
  TrackerAdapterReadContext,
  TrackerAdapterReadError,
  TrackerAdapterReadFailureReason
} from "../../../orchestrator/src/authorities/task-tracker/graph-reader.js"
import { InRunJournal } from "../../../orchestrator/src/workflow-journal/store.js"
import { AcceptedJournalReader } from "../../../orchestrator/src/workflow-journal/accepted-reader.js"
import { liveJournalTestLayer } from "../../../orchestrator/src/coordination/delivery/live-journal-test-layer.js"
import { JournalPosition } from "../../../orchestrator/src/workflow-journal/identity.js"
import {
  makeIntegrationTargetResourceController,
  acquireStartedIntegrationTarget,
  releaseStartedIntegrationTarget
} from "../../../orchestrator/src/coordination/admission/integration-target-resource.js"
import { makeTrackerGraphObservationOperation } from "../../../orchestrator/src/workflow/registry/operation.js"
import { latestReconstructedTaskGraph } from "../../../orchestrator/src/coordination/reconstruction/graph-knowledge.js"
import { reconstructRunState } from "../../../orchestrator/src/coordination/reconstruction/reduce.js"
import { OperationId } from "../../../orchestrator/src/workflow/identity.js"
import { projectTrackerSnapshot } from "../../../orchestrator/src/authorities/task-tracker/graph.js"
import { WorkflowInterpreter } from "../../../orchestrator/src/workflow/interpretation/interpreter.js"
import { controlledWorkflowInterpreterLayer } from "../../../orchestrator/src/workflow/interpretation/layers.js"
import { journaledWorkflowInterpreterLayer } from "../../../orchestrator/src/workflow-journal/journaled-interpreter.js"
import { TargetLineageObservation } from "../../../orchestrator/src/authorities/git/target-lineage.js"
import {
  Integrator,
  IntegratorGit,
  IntegratorPreparationInput,
  deriveIntegratorRunState,
  integratorCorrelationFor,
  prepareIntegrationCandidateRun
} from "../../../orchestrator/src/workflow/protocols/integrator/protocol.js"
import {
  IntegratorCandidateText,
  IntegratorGitObservation,
  IntegratorResult,
  IntegratorRunCorrelation,
  IntegratorRunOrdinal,
  integratorRunCorrelationsEqual
} from "../../../orchestrator/src/workflow/protocols/integrator/events.js"

type Constraint =
  | "NoGitConstraint"
  | "WorktreeLostConstraint"
  | "RegistrationConflictConstraint"
  | "TargetRewriteConstraint"
type Status = "Executing" | "SafelySuspended"
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
const makeProductionReconciliationTrace = Effect.gen(function* () {
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
  const specification = makeTaskWorkSpecification({
    body: "Exercise the production Git reconciliation boundary.",
    taskId: TaskId.make("git-reconciliation-production-A"),
    title: "Git reconciliation production trace"
  })
  const productionAttempt = PlannedTaskAttempt.make({
    attemptId: AttemptId.make("git-reconciliation-production-attempt"),
    baseSha: base,
    branch: TaskBranchRef.make("refs/heads/dalph/git-reconciliation-production"),
    executor: TaskExecutorLocator.make("executor:git-reconciliation-production"),
    runId,
    taskId: specification.taskId,
    taskRevision: specification.fingerprint,
    worktree: WorktreeLocator.make("/worktrees/git-reconciliation-production")
  })
  const acceptedHistory = makeAcceptedIntegrationHistory({
    acceptedResult,
    activeClaim: ActiveTaskClaim.make({
      operationId: OperationId.make("git-reconciliation-production-claim"),
      owner: ClaimOwner.make("dalph:git-reconciliation-production"),
      taskId: productionAttempt.taskId,
      token: ClaimToken.make("git-reconciliation-production-token")
    }),
    integrationTarget,
    plannedAttempt: productionAttempt,
    runId,
    targetHeadSha: base,
    taskSpecification: specification,
    trackerTarget: target
  })
  const context = yield* Layer.build(liveJournalTestLayer({ records: acceptedHistory.records, runId, target }))
  const journal = Context.get(context, InRunJournal)
  const accepted = Context.get(context, AcceptedJournalReader)
  const scope = yield* Effect.scope
  const started = acceptedHistory.responsibility
  const reportedCandidate = IntegratorCandidateText.make("git-reconciliation-reported-candidate")
  const candidateForHead = (head: GitCommitSha) => (head === base ? candidate : GitCommitSha.make("5".repeat(40)))
  let gitExpectedTargetHead = base
  const integrator = Integrator.of({
    prepare: (request) =>
      Effect.succeed(
        IntegratorResult.cases.PreparedCandidate.make({
          candidateText: reportedCandidate,
          correlation: request.correlation
        })
      )
  })
  const integratorGit = IntegratorGit.of({
    readCandidate: (_target, candidateText) =>
      Effect.succeed(
        IntegratorGitObservation.cases.Commit.make({
          candidateText,
          commit: candidateForHead(gitExpectedTargetHead),
          directParents: [gitExpectedTargetHead, acceptedResult.commit]
        })
      )
  })
  const resource = yield* makeIntegrationTargetResourceController()
  const physicalResponsibility = {
    integrationTarget,
    plannedAttempt: started.plannedAttempt,
    queuedAt: started.queuedAt
  }
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
  const graphSnapshot = yield* Ref.make(initialGraphProjection.snapshot)
  const graphReadMode = yield* Ref.make<"Complete" | "Incomplete">("Complete")
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
    const interpreterContext = Effect.runSync(
      Layer.build(
        journaledWorkflowInterpreterLayer(runId, workflowInterpreterLayer).pipe(
          Layer.provide(Layer.succeed(InRunJournal, journal)),
          Layer.provide(Layer.succeed(AcceptedJournalReader, accepted))
        )
      ).pipe(Effect.provideService(Scope.Scope, scope))
    )
    return Context.get(interpreterContext, WorkflowInterpreter)
  }
  let interpreter = makeJournaledInterpreter()
  const targetLineage = acceptedHistory.targetLineage
  let operationOrdinal = 0

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
        heldResponsibilities: resourceSnapshot.heldResponsibilities,
        integrationTarget: Option.some(integrationTarget),
        targetLineageByAttemptId: new Map([[productionAttempt.attemptId, targetLineage]]),
        targetPromotionConfigured: true,
        taskClaimAuthorityByAttemptId: new Map([[productionAttempt.attemptId, { _tag: "Exact" as const }]])
      }),
      held: resourceSnapshot.heldResponsibilities.some(
        ({ queuedAt, runId: heldRunId }) => queuedAt === started.queuedAt && heldRunId === started.plannedAttempt.runId
      ),
      records: records()
    }
  }
  const graphSnapshotFor = (revision: string, prerequisiteCleared: boolean, prerequisiteComplete: boolean) => {
    const blockerId = TaskId.make("git-reconciliation-production-B")
    const independentId = TaskId.make("git-reconciliation-production-C")
    const operation = makeTrackerGraphObservationOperation(
      { _tag: "WorkflowEstablishment" },
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
      { _tag: "WorkflowEstablishment" },
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
      { _tag: "WorkflowEstablishment" },
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
  const integratorProtocol = (
    integratorResponsibility: typeof started,
    lineage: TargetLineageObservation,
    observedAt: JournalPosition
  ) => {
    gitExpectedTargetHead = lineage.targetHeadSha
    const input = IntegratorPreparationInput.make({
      responsibility: integratorResponsibility,
      targetLineage: lineage,
      targetLineageObservedAt: observedAt
    })
    const run = IntegratorRunCorrelation.make({
      ordinal: IntegratorRunOrdinal.make(1),
      session: integratorCorrelationFor(input)
    })
    return Effect.runSync(
      Effect.exit(
        prepareIntegrationCandidateRun({ preparation: input, run }).pipe(
          Effect.provideService(InRunJournal, journal),
          Effect.provideService(AcceptedJournalReader, accepted),
          Effect.provideService(Integrator, integrator),
          Effect.provideService(IntegratorGit, integratorGit)
        )
      )
    )
  }
  Effect.runSync(resource.acquire(physicalResponsibility))
  Effect.runSync(resource.publishAcceptedOwnership(physicalResponsibility))
  const initialIntegratorResult = integratorProtocol(started, targetLineage, acceptedHistory.targetLineageObservedAt)
  if (initialIntegratorResult._tag === "Failure") {
    return Effect.runSync(Effect.die("production MBT initial Integrator call failed"))
  }

  const qualifiedCandidate = () => {
    const currentRecords = records()
    const initialInput = IntegratorPreparationInput.make({
      responsibility: started,
      targetLineage,
      targetLineageObservedAt: acceptedHistory.targetLineageObservedAt
    })
    const run = IntegratorRunCorrelation.make({
      ordinal: IntegratorRunOrdinal.make(1),
      session: integratorCorrelationFor(initialInput)
    })
    const state = deriveIntegratorRunState(currentRecords, started, run)
    if (state._tag !== "GitQualifiedPrepared") {
      return Effect.runSync(Effect.die(`production MBT expected GitQualifiedPrepared, received ${state._tag}`))
    }
    const expectedHead = state.run.session.expectedTargetHead
    const resultRecord = currentRecords.findLast(
      (record) =>
        record.event._tag === "IntegratorRunResultRecorded" &&
        record.event.run.session.sessionId === state.run.session.sessionId &&
        record.event.run.ordinal === state.run.ordinal
    )
    if (
      resultRecord === undefined ||
      resultRecord.event._tag !== "IntegratorRunResultRecorded" ||
      resultRecord.event.result._tag !== "PreparedCandidate" ||
      resultRecord.event.result.candidateText !== state.candidateText ||
      !integratorRunCorrelationsEqual(resultRecord.event.result.correlation, state.run) ||
      resultRecord.position >= state.qualifiedAt
    ) {
      return Effect.runSync(Effect.die("production MBT qualified candidate lacks its exact Integrator result"))
    }
    const readIntent = currentRecords.findLast(
      (record) =>
        record.event._tag === "IntegratorRunCandidateGitReadIntended" &&
        integratorRunCorrelationsEqual(record.event.run, state.run) &&
        record.event.candidateText === state.candidateText
    )
    const observationRecord = currentRecords.find((record) => record.position === state.qualifiedAt)
    if (
      readIntent === undefined ||
      observationRecord === undefined ||
      observationRecord.event._tag !== "IntegratorRunCandidateGitObserved" ||
      readIntent.position >= observationRecord.position ||
      !integratorRunCorrelationsEqual(observationRecord.event.run, state.run) ||
      observationRecord.event.candidateText !== state.candidateText ||
      observationRecord.event.observation._tag !== "Commit"
    ) {
      return Effect.runSync(Effect.die("production MBT qualified candidate lacks exact Git observation chronology"))
    }
    const observation = observationRecord.event.observation
    if (
      expectedHead !== base ||
      state.candidateCommit !== candidate ||
      observation.commit !== candidate ||
      observation.directParents.length !== 2 ||
      observation.directParents[0] !== expectedHead ||
      observation.directParents[1] !== acceptedResult.commit
    ) {
      return Effect.runSync(Effect.die("production MBT Git qualification did not prove the exact candidate parents"))
    }
    return { candidateCommit: state.candidateCommit, expectedHead }
  }

  return {
    applyResourceTransition,
    frontier,
    qualifiedCandidate,
    readGraph,
    readIncompleteTrackerGraph,
    recordCount: () => records().length,
    started
  }
})

const SpecProjection = Schema.Struct({
  state: Schema.Struct({
    candidateGitQualified: Schema.Boolean,
    candidatePreserved: Schema.Boolean,
    claimPreserved: Schema.Boolean,
    compareAndSetAuthorized: Schema.Boolean,
    compatibleAdvanceObserved: Schema.Boolean,
    constraint: Schema.Unknown,
    decision: Schema.Unknown,
    evidencePreserved: Schema.Boolean,
    exactExpectedHeadObserved: Schema.Boolean,
    independentTaskEligible: Schema.Boolean,
    independentTaskSelected: Schema.Boolean,
    overwriteAuthorized: Schema.Boolean,
    positionHeld: Schema.Boolean,
    repairAuthorized: Schema.Boolean,
    resultRejected: Schema.Boolean,
    resultRejection: Schema.Unknown,
    promotionProof: Schema.Boolean,
    status: Schema.Unknown,
    trackerBlocker: Schema.Unknown,
    worktreePreserved: Schema.Boolean
  })
})

const variantTag = (value: unknown): string =>
  typeof value === "object" && value !== null && "tag" in value ? String(value.tag) : String(value)

const gitDecisionFromFrontier = (constraint: Constraint, status: Status): string => {
  const disposition =
    constraint === "NoGitConstraint"
      ? { _tag: "Ready" as const, acceptedProgress }
      : status === "Executing"
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
  if (frontier.transitions[0]?._tag === "ObservePlannedAttemptExecutorWork") return "ContinueAttempt"
  if (frontier.transitions[0]?._tag === "SuspendPlannedAttemptExecutorWork") return "RequestSafeSuspension"
  if (frontier.explanations[0]?._tag === "PlannedAttemptGitConstraint") return "GitConstraintWait"
  return Effect.runSync(Effect.die("production frontier returned no Git reconciliation decision"))
}

// The default Quint `step` used by this executable replay intentionally stops
// at the current Integrator/Git/frontier boundary. Pure Quint still checks the
// target-promotion/finality and blocker-session projections through
// `gitReconciliationStep`, but this adapter does not manufacture those missing
// outer-Integrator or target-promotion Journal events.
type ProductionReconciliationTrace = Effect.Success<typeof makeProductionReconciliationTrace>
type GitReconciliationRuntime = Option.Option<ProductionReconciliationTrace>

const makeGitReconciliationDriver = (runtime: ScopedRef.ScopedRef<GitReconciliationRuntime>) =>
  defineDriver(
    {
      init: {},
      observeAmbiguousTargetAfterGitQualification: {},
      observeCompatibleTargetAdvance: {},
      observeEligibleResultCommit: {},
      observeExactExpectedTargetWithGitQualifiedCandidate: {},
      observeExactTargetWithUnqualifiedCandidate: {},
      observeIncompleteTrackerFacts: {},
      observeIncompatibleTargetRewrite: {},
      observeLostWorktree: {},
      observeMissingResultCommit: {},
      observePrePromotionDependencyBlocker: {},
      observeNonDescendantResultCommit: {},
      observeRegistrationConflict: {},
      observeStaleTargetAfterGitQualification: {},
      reportSafelySuspended: {},
      selectIndependentTask: {}
    },
    () => {
      const production = () =>
        Option.match(ScopedRef.getUnsafe(runtime), {
          onNone: () => Effect.runSync(Effect.die("Git reconciliation driver action preceded init")),
          onSome: (current) => current
        })
      let status: Status = "Executing"
      let constraint: Constraint = "NoGitConstraint"
      let decision = "ContinueAttempt"
      let compatibleAdvanceObserved = false
      let resultRejected = false
      let resultRejection = "NoResultRejection"
      let candidatePreserved = true
      let promotionProof = false
      let trackerBlocker: TrackerBlocker = "NoTrackerBlocker"
      let independentTaskSelected = false
      let exactExpectedHeadObserved = false
      let candidateGitQualified = false
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
      const decidePromotion = (
        target: PromotionTargetObservation,
        candidateGitQualifiedAgainstExpectedHead: boolean,
        candidateSha: GitCommitSha = candidate,
        expectedHeadSha: GitCommitSha = advanced
      ) =>
        Effect.sync(() => {
          const result = decideTargetPromotion({
            candidateSha,
            candidateVerifiedAgainstExpectedHead: candidateGitQualifiedAgainstExpectedHead,
            expectedHeadSha,
            target
          })
          decision = result._tag === "RejectUnverifiedCandidate" ? "RejectUnqualifiedCandidate" : result._tag
          exactExpectedHeadObserved = target._tag === "ExactTargetHead" && target.currentHeadSha === expectedHeadSha
          candidateGitQualified = candidateGitQualifiedAgainstExpectedHead
          compareAndSetAuthorized = result.compareAndSetAuthorized
          overwriteAuthorized = result.overwriteAuthorized
          promotionProof = result._tag === "PromoteByExactCompareAndSet" && candidateGitQualifiedAgainstExpectedHead
        })
      const decideQualifiedPromotion = (target: PromotionTargetObservation) => {
        const qualified = production().qualifiedCandidate()
        return decidePromotion(target, true, qualified.candidateCommit, qualified.expectedHead)
      }

      return {
        init: () =>
          Effect.gen(function* () {
            yield* ScopedRef.set(runtime, makeProductionReconciliationTrace.pipe(Effect.map(Option.some)))
            status = "Executing"
            constraint = "NoGitConstraint"
            decision = "ContinueAttempt"
            compatibleAdvanceObserved = false
            resultRejected = false
            resultRejection = "NoResultRejection"
            candidatePreserved = true
            promotionProof = false
            trackerBlocker = "NoTrackerBlocker"
            positionHeld = true
            independentTaskSelected = false
            exactExpectedHeadObserved = false
            candidateGitQualified = false
            compareAndSetAuthorized = false
            overwriteAuthorized = false
            applyPreservation(decideGitFactPreservation("NoGitConstraint"))
          }),
        observeAmbiguousTargetAfterGitQualification: () =>
          decideQualifiedPromotion(PromotionTargetObservation.cases.AmbiguousTargetHead.make({})),
        observePrePromotionDependencyBlocker: () =>
          Effect.sync(() => {
            const result = production().readGraph("before-promotion-blocker", false, false)
            production().applyResourceTransition()
            const current = production().frontier()
            positionHeld = current.held
            decision = current.frontier.explanations.some(({ _tag }) => _tag === "IntegrationDependencyWait")
              ? "GitConstraintWait"
              : "ContinueAttempt"
            trackerBlocker = result.frontier.explanations.some(({ _tag }) => _tag === "IntegrationDependencyWait")
              ? "BeforePromotionBlocker"
              : "NoTrackerBlocker"
          }),
        observeIncompleteTrackerFacts: () =>
          Effect.sync(() => {
            production().readIncompleteTrackerGraph()
            positionHeld = production().frontier().held
            decision = "GitConstraintWait"
            trackerBlocker = "IncompleteTrackerFacts"
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
        observeExactExpectedTargetWithGitQualifiedCandidate: () =>
          (() => {
            const qualified = production().qualifiedCandidate()
            return decidePromotion(
              PromotionTargetObservation.cases.ExactTargetHead.make({ currentHeadSha: qualified.expectedHead }),
              true,
              qualified.candidateCommit,
              qualified.expectedHead
            )
          })(),
        observeExactTargetWithUnqualifiedCandidate: () =>
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
        observeStaleTargetAfterGitQualification: () =>
          decideQualifiedPromotion(
            PromotionTargetObservation.cases.ExactTargetHead.make({ currentHeadSha: rewritten })
          ),
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
            candidateGitQualified,
            candidatePreserved,
            claimPreserved,
            compareAndSetAuthorized,
            compatibleAdvanceObserved,
            constraint,
            decision,
            evidencePreserved,
            exactExpectedHeadObserved,
            independentTaskEligible: true,
            independentTaskSelected,
            overwriteAuthorized,
            positionHeld,
            repairAuthorized,
            resultRejected,
            resultRejection,
            promotionProof,
            status,
            trackerBlocker,
            worktreePreserved
          }))
      }
    }
  )

const gitReconciliationDriver = {
  create: () =>
    Effect.gen(function* () {
      const runtime = yield* ScopedRef.fromAcquire(Effect.succeed(Option.none<ProductionReconciliationTrace>()))
      return yield* makeGitReconciliationDriver(runtime).create()
    })
}

it.effect("imports the Git driver journal once on first init", () =>
  Effect.scoped(
    Effect.gen(function* () {
      let validationSteps = 0
      const stop = observeWorkflowJournalValidationSteps(() => {
        validationSteps += 1
      })
      yield* Effect.addFinalizer(() => Effect.sync(stop))
      yield* makeProductionReconciliationTrace
      const oneAcquisitionSteps = validationSteps
      expect(oneAcquisitionSteps).toBeGreaterThan(0)
      validationSteps = 0
      const driver = yield* gitReconciliationDriver.create()
      expect(validationSteps).toBe(0)
      const init = driver.actions["init"]
      if (init === undefined) return yield* Effect.die("Git driver must expose init")
      yield* init.handler({})
      expect(validationSteps).toBe(oneAcquisitionSteps)
    })
  )
)

it.effect("keeps restart replay on one live journal and replaces the complete runtime on init", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const runtime = yield* ScopedRef.fromAcquire(makeProductionReconciliationTrace)
      const first = yield* ScopedRef.get(runtime)
      const initialCount = first.recordCount()
      first.readIncompleteTrackerGraph()
      expect(first.recordCount() - initialCount).toBe(4)

      yield* ScopedRef.set(runtime, makeProductionReconciliationTrace)
      const second = yield* ScopedRef.get(runtime)
      expect(second).not.toBe(first)
      expect(second.recordCount()).toBe(initialCount)
    })
  )
)

it.effect(
  "replays Git reconciliation through production decisions and frontier dispositions",
  () =>
    quintRun({
      backend: "typescript",
      driverFactory: gitReconciliationDriver,
      maxSteps: 12,
      nTraces: 100,
      seed: "139",
      spec: "specs/gitReconciliation.qnt",
      stateCheck: stateCheck(
        (raw) =>
          Effect.gen(function* () {
            const { state } = yield* Schema.decodeUnknownEffect(SpecProjection)(raw).pipe(Effect.orDie)
            return {
              ...state,
              constraint: variantTag(state.constraint),
              decision: variantTag(state.decision),
              resultRejection: variantTag(state.resultRejection),
              status: variantTag(state.status),
              trackerBlocker: variantTag(state.trackerBlocker)
            }
          }),
        (spec, implementation) =>
          spec.candidateGitQualified === implementation.candidateGitQualified &&
          spec.candidatePreserved === implementation.candidatePreserved &&
          spec.claimPreserved === implementation.claimPreserved &&
          spec.compareAndSetAuthorized === implementation.compareAndSetAuthorized &&
          spec.compatibleAdvanceObserved === implementation.compatibleAdvanceObserved &&
          spec.constraint === implementation.constraint &&
          spec.decision === implementation.decision &&
          spec.evidencePreserved === implementation.evidencePreserved &&
          spec.exactExpectedHeadObserved === implementation.exactExpectedHeadObserved &&
          spec.independentTaskEligible === implementation.independentTaskEligible &&
          spec.independentTaskSelected === implementation.independentTaskSelected &&
          spec.overwriteAuthorized === implementation.overwriteAuthorized &&
          spec.positionHeld === implementation.positionHeld &&
          spec.repairAuthorized === implementation.repairAuthorized &&
          spec.resultRejected === implementation.resultRejected &&
          spec.resultRejection === implementation.resultRejection &&
          spec.promotionProof === implementation.promotionProof &&
          spec.status === implementation.status &&
          spec.trackerBlocker === implementation.trackerBlocker &&
          spec.worktreePreserved === implementation.worktreePreserved
      )
    }),
  { timeout: 30_000 }
)
