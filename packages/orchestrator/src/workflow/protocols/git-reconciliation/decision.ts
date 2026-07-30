import { GitCommitSha } from "@dalph/contracts"
import { Schema } from "effect"
import {
  TargetLineageObservation,
  type TargetLineageObservation as TargetLineageObservationType
} from "../../../authorities/git/target-lineage.js"

export { TargetLineageObservation }

/** Whether the observed target remains in the planned attempt's allowed lineage. */
export const TargetLineageDecision = Schema.TaggedUnion({
  CompatibleTargetAdvance: { plannedBaseSha: GitCommitSha, targetHeadSha: GitCommitSha },
  IncompatibleTargetRewrite: {
    claimPreserved: Schema.Literal(true),
    evidencePreserved: Schema.Literal(true),
    plannedBaseSha: GitCommitSha,
    repairAuthorized: Schema.Literal(false),
    targetHeadSha: GitCommitSha,
    worktreePreserved: Schema.Literal(true)
  }
})
export type TargetLineageDecision = typeof TargetLineageDecision.Type

export const decideTargetLineage = (observation: TargetLineageObservationType): TargetLineageDecision =>
  observation.plannedBaseIsAncestorOfTargetHead
    ? TargetLineageDecision.cases.CompatibleTargetAdvance.make({
        plannedBaseSha: observation.plannedBaseSha,
        targetHeadSha: observation.targetHeadSha
      })
    : TargetLineageDecision.cases.IncompatibleTargetRewrite.make({
        claimPreserved: true,
        evidencePreserved: true,
        plannedBaseSha: observation.plannedBaseSha,
        repairAuthorized: false,
        targetHeadSha: observation.targetHeadSha,
        worktreePreserved: true
      })

export const GitFactConstraint = Schema.Literals([
  "NoGitConstraint",
  "RegistrationConflictConstraint",
  "TargetRewriteConstraint",
  "WorktreeLostConstraint"
])
export type GitFactConstraint = typeof GitFactConstraint.Type

/** Preservation authorization shared by every read-only Git-fact outcome. */
export const GitFactPreservationDecision = Schema.Struct({
  claimPreserved: Schema.Literal(true),
  constraint: GitFactConstraint,
  evidencePreserved: Schema.Literal(true),
  repairAuthorized: Schema.Literal(false),
  worktreePreserved: Schema.Literal(true)
})
export type GitFactPreservationDecision = typeof GitFactPreservationDecision.Type

export const decideGitFactPreservation = (constraint: GitFactConstraint): GitFactPreservationDecision =>
  GitFactPreservationDecision.make({
    claimPreserved: true,
    constraint,
    evidencePreserved: true,
    repairAuthorized: false,
    worktreePreserved: true
  })

/** Git either cannot resolve the result commit or proves its relationship to the immutable Base. */
export const ResultCommitObservation = Schema.TaggedUnion({
  ResultCommitMissing: { plannedBaseSha: GitCommitSha },
  ResultCommitPresent: {
    plannedBaseIsAncestorOfResultCommit: Schema.Boolean,
    plannedBaseSha: GitCommitSha,
    resultCommitSha: GitCommitSha
  }
})
export type ResultCommitObservation = typeof ResultCommitObservation.Type

/** A rejected result always leaves the planned worktree available for evidence and repair. */
const ResultCommitEligible = Schema.TaggedStruct("ResultCommitEligible", {
  plannedBaseSha: GitCommitSha,
  resultCommitSha: GitCommitSha
})
const MissingResultCommitRejected = Schema.TaggedStruct("ResultCommitRejected", {
  claimPreserved: Schema.Literal(true),
  evidencePreserved: Schema.Literal(true),
  plannedBaseSha: GitCommitSha,
  preserveWorktree: Schema.Literal(true),
  reason: Schema.Literal("Missing")
})
const NonDescendantResultCommitRejected = Schema.TaggedStruct("ResultCommitRejected", {
  claimPreserved: Schema.Literal(true),
  evidencePreserved: Schema.Literal(true),
  plannedBaseSha: GitCommitSha,
  preserveWorktree: Schema.Literal(true),
  reason: Schema.Literal("NonDescendant"),
  resultCommitSha: GitCommitSha
})
export const ResultCommitQualificationDecision = Schema.Union([
  ResultCommitEligible,
  MissingResultCommitRejected,
  NonDescendantResultCommitRejected
])
export type ResultCommitQualificationDecision = typeof ResultCommitQualificationDecision.Type

export const decideResultCommitQualification = (
  observation: ResultCommitObservation
): ResultCommitQualificationDecision =>
  observation._tag === "ResultCommitMissing"
    ? MissingResultCommitRejected.make({
        claimPreserved: true,
        evidencePreserved: true,
        plannedBaseSha: observation.plannedBaseSha,
        preserveWorktree: true,
        reason: "Missing"
      })
    : observation.plannedBaseIsAncestorOfResultCommit
      ? ResultCommitEligible.make({
          plannedBaseSha: observation.plannedBaseSha,
          resultCommitSha: observation.resultCommitSha
        })
      : NonDescendantResultCommitRejected.make({
          claimPreserved: true,
          evidencePreserved: true,
          plannedBaseSha: observation.plannedBaseSha,
          preserveWorktree: true,
          reason: "NonDescendant",
          resultCommitSha: observation.resultCommitSha
        })

/** A promotion boundary either knows one exact current head or must reread after ambiguity. */
export const PromotionTargetObservation = Schema.TaggedUnion({
  AmbiguousTargetHead: {},
  ExactTargetHead: { currentHeadSha: GitCommitSha }
})
export type PromotionTargetObservation = typeof PromotionTargetObservation.Type

export interface TargetPromotionDecisionInput {
  readonly candidateSha: GitCommitSha
  readonly candidateVerifiedAgainstExpectedHead: boolean
  readonly expectedHeadSha: GitCommitSha
  readonly target: PromotionTargetObservation
}

/** Pure authorization consumed before a future concrete compare-and-set promotion protocol. */
export const TargetPromotionDecision = Schema.TaggedUnion({
  PromoteByExactCompareAndSet: {
    candidateSha: GitCommitSha,
    compareAndSetAuthorized: Schema.Literal(true),
    expectedHeadSha: GitCommitSha,
    overwriteAuthorized: Schema.Literal(false)
  },
  ReconcileCandidateFromCurrentTarget: {
    candidateSha: GitCommitSha,
    compareAndSetAuthorized: Schema.Literal(false),
    currentHeadSha: GitCommitSha,
    expectedHeadSha: GitCommitSha,
    overwriteAuthorized: Schema.Literal(false)
  },
  RejectUnverifiedCandidate: {
    candidateSha: GitCommitSha,
    compareAndSetAuthorized: Schema.Literal(false),
    expectedHeadSha: GitCommitSha,
    overwriteAuthorized: Schema.Literal(false)
  },
  RereadTargetBeforePromotion: {
    candidateSha: GitCommitSha,
    compareAndSetAuthorized: Schema.Literal(false),
    expectedHeadSha: GitCommitSha,
    overwriteAuthorized: Schema.Literal(false)
  }
})
export type TargetPromotionDecision = typeof TargetPromotionDecision.Type

export const decideTargetPromotion = (input: TargetPromotionDecisionInput): TargetPromotionDecision =>
  input.target._tag === "AmbiguousTargetHead"
    ? TargetPromotionDecision.cases.RereadTargetBeforePromotion.make({
        candidateSha: input.candidateSha,
        compareAndSetAuthorized: false,
        expectedHeadSha: input.expectedHeadSha,
        overwriteAuthorized: false
      })
    : input.target.currentHeadSha !== input.expectedHeadSha
      ? TargetPromotionDecision.cases.ReconcileCandidateFromCurrentTarget.make({
          candidateSha: input.candidateSha,
          compareAndSetAuthorized: false,
          currentHeadSha: input.target.currentHeadSha,
          expectedHeadSha: input.expectedHeadSha,
          overwriteAuthorized: false
        })
      : input.candidateVerifiedAgainstExpectedHead
        ? TargetPromotionDecision.cases.PromoteByExactCompareAndSet.make({
            candidateSha: input.candidateSha,
            compareAndSetAuthorized: true,
            expectedHeadSha: input.expectedHeadSha,
            overwriteAuthorized: false
          })
        : TargetPromotionDecision.cases.RejectUnverifiedCandidate.make({
            candidateSha: input.candidateSha,
            compareAndSetAuthorized: false,
            expectedHeadSha: input.expectedHeadSha,
            overwriteAuthorized: false
          })
