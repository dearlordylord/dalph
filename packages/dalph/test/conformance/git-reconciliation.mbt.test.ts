import { it } from "@effect/vitest"
import { defineDriver, stateCheck } from "@firfi/quint-connect/effect"
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
    status: Schema.Unknown,
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
    observeAmbiguousTargetAfterVerification: {},
    observeCompatibleTargetAdvance: {},
    observeEligibleResultCommit: {},
    observeExactExpectedTargetWithVerifiedCandidate: {},
    observeExactTargetWithUnverifiedCandidate: {},
    observeIncompatibleTargetRewrite: {},
    observeLostWorktree: {},
    observeMissingResultCommit: {},
    observeNonDescendantResultCommit: {},
    observeRegistrationConflict: {},
    observeStaleTargetAfterVerification: {},
    reportSafelySuspended: {},
    selectIndependentTask: {}
  },
  () => {
    let status: Status = "Running"
    let constraint: Constraint = "NoGitConstraint"
    let decision = "ContinueAttempt"
    let compatibleAdvanceObserved = false
    let resultRejected = false
    let resultRejection = "NoResultRejection"
    let independentTaskSelected = false
    let exactExpectedHeadObserved = false
    let candidateVerified = false
    let compareAndSetAuthorized = false
    let overwriteAuthorized = false
    let claimPreserved = true
    let evidencePreserved = true
    let repairAuthorized = false
    let worktreePreserved = true

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
          independentTaskSelected = false
          exactExpectedHeadObserved = false
          candidateVerified = false
          compareAndSetAuthorized = false
          overwriteAuthorized = false
          applyPreservation(decideGitFactPreservation("NoGitConstraint"))
        }),
      observeAmbiguousTargetAfterVerification: () =>
        decidePromotion(PromotionTargetObservation.cases.AmbiguousTargetHead.make({}), true),
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
          positionHeld: status === "Running",
          repairAuthorized,
          resultRejected,
          resultRejection,
          status,
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
        Schema.decodeUnknownEffect(SpecProjection)(raw).pipe(
          Effect.map(({ state }) => ({
            ...state,
            constraint: variantTag(state.constraint),
            decision: variantTag(state.decision),
            resultRejection: variantTag(state.resultRejection),
            status: variantTag(state.status)
          })),
          Effect.orDie
        ),
      (spec, implementation) =>
        spec.candidateVerified === implementation.candidateVerified &&
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
        spec.status === implementation.status &&
        spec.worktreePreserved === implementation.worktreePreserved
    )
  },
  30_000
)
