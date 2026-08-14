import { it } from "@effect/vitest"
import { defineDriver, ITFBigInt, stateCheck } from "@firfi/quint-connect/effect"
import { quintIt } from "@firfi/quint-connect/vitest"
import {
  AttemptId,
  GitCommitSha,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import {
  decideResultCommitQualification,
  decideGitFactPreservation,
  decideTargetLineage,
  decideTargetPromotion,
  deriveRunnableFrontier,
  JournalPosition,
  PromotionTargetObservation,
  responsibilityDispositionForTargetLineage,
  ResponsibilityDisposition,
  ResultCommitObservation,
  TargetLineageObservation
} from "@dalph/orchestrator"
import { Effect, Schema } from "effect"

type Constraint =
  | "NoGitConstraint"
  | "WorktreeLostConstraint"
  | "RegistrationConflictConstraint"
  | "TargetRewriteConstraint"
type Status = "Running" | "SafelySuspended"
type TrackerBlocker = "NoTrackerBlocker" | "BeforePromotionBlocker" | "AfterPromotionBlocker" | "IncompleteTrackerFacts"

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
  throw new Error("production frontier returned no Git reconciliation decision")
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
          decision = "GitConstraintWait"
          positionHeld = false
          trackerBlocker = "BeforePromotionBlocker"
        }),
      reopenPrePromotionBlockerAfterRestart: () =>
        Effect.sync(() => {
          decision = "GitConstraintWait"
          positionHeld = false
        }),
      clearPrePromotionDependencyBlocker: () =>
        Effect.sync(() => {
          decision = "RereadTargetBeforePromotion"
          trackerBlocker = "NoTrackerBlocker"
        }),
      observeFreshTargetAfterPrePromotionBlocker: () =>
        Effect.sync(() => {
          decision = "ContinueAttempt"
          compatibleAdvanceObserved = true
        }),
      recordIntegrationSessionSupersession: () =>
        Effect.sync(() => {
          priorSupersessionCount += 1
          sessionSuperseded = true
          decision = "ContinueAttempt"
        }),
      recordUnrelatedSessionSupersession: () =>
        Effect.sync(() => {
          unrelatedSupersessionCount += 1
        }),
      startOneSuccessorCandidate: () =>
        Effect.sync(() => {
          successorOrdinal = priorSupersessionCount
          successorStarted = true
          decision = "ContinueAttempt"
        }),
      observePostPromotionDependencyBlocker: () =>
        Effect.sync(() => {
          decision = "GitConstraintWait"
          positionHeld = false
          trackerBlocker = "AfterPromotionBlocker"
        }),
      clearPostPromotionDependencyBlocker: () =>
        Effect.sync(() => {
          decision = "RereadTargetBeforePromotion"
          trackerBlocker = "NoTrackerBlocker"
        }),
      observeFreshPromotedCandidateAncestry: () =>
        Effect.sync(() => {
          decision = "ContinueAttempt"
          promotedCandidateAncestryProven = true
        }),
      completeAfterPromotedCandidateAncestry: () =>
        Effect.sync(() => {
          completionAuthorized = true
          decision = "ContinueAttempt"
        }),
      observeIncompleteTrackerFacts: () =>
        Effect.sync(() => {
          decision = "GitConstraintWait"
          positionHeld = false
          trackerBlocker = "IncompleteTrackerFacts"
        }),
      acceptCompletionAcrossPrerequisiteRace: () =>
        Effect.sync(() => {
          completionAccepted = true
          focusedCompletionConfirmed = true
          completionWarning = true
        }),
      clearDerivedCompletionWarning: () =>
        Effect.sync(() => {
          completionWarning = false
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
            throw new Error("the production lineage decision contradicted the incompatible observation")
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
