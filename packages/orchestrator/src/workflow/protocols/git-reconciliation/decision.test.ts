import { GitCommitSha } from "@dalph/contracts"
import { expect, it } from "vitest"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import {
  decideResultCommitQualification,
  decideGitFactPreservation,
  decideTargetLineage,
  decideTargetPromotion,
  PromotionTargetObservation,
  ResultCommitObservation,
  TargetLineageObservation
} from "./decision.js"
import { responsibilityDispositionForTargetLineage } from "./frontier-adapter.js"

const base = GitCommitSha.make("1".repeat(40))
const advanced = GitCommitSha.make("2".repeat(40))
const rewritten = GitCommitSha.make("3".repeat(40))
const candidate = GitCommitSha.make("4".repeat(40))
const acceptedProgress = { _tag: "ExecutorResponsibilityBegan" as const, acceptedAt: JournalPosition.make(1) }

it("preserves claim worktree and evidence for every read-only Git constraint", () => {
  expect(decideGitFactPreservation("WorktreeLostConstraint")).toEqual({
    claimPreserved: true,
    constraint: "WorktreeLostConstraint",
    evidencePreserved: true,
    repairAuthorized: false,
    worktreePreserved: true
  })
})

it("continues after Git proves the target advanced from the planned Base", () => {
  expect(
    decideTargetLineage(
      TargetLineageObservation.make({
        plannedBaseIsAncestorOfTargetHead: true,
        plannedBaseSha: base,
        targetHeadSha: advanced
      })
    )
  ).toEqual({ _tag: "CompatibleTargetAdvance", plannedBaseSha: base, targetHeadSha: advanced })
})

it("isolates the affected attempt after Git proves an incompatible target rewrite", () => {
  const decision = decideTargetLineage(
    TargetLineageObservation.make({
      plannedBaseIsAncestorOfTargetHead: false,
      plannedBaseSha: base,
      targetHeadSha: rewritten
    })
  )
  expect(decision).toEqual({
    _tag: "IncompatibleTargetRewrite",
    claimPreserved: true,
    evidencePreserved: true,
    plannedBaseSha: base,
    repairAuthorized: false,
    targetHeadSha: rewritten,
    worktreePreserved: true
  })
  expect(responsibilityDispositionForTargetLineage(acceptedProgress, decision, false)._tag).toBe(
    "PlannedAttemptExecutorSuspensionRequested"
  )
  expect(responsibilityDispositionForTargetLineage(acceptedProgress, decision, true)).toEqual({
    _tag: "PlannedAttemptGitConstraint",
    gitState: "TargetRewrite"
  })
})

it("rejects missing and non-descendant result commits while preserving the worktree", () => {
  expect(
    decideResultCommitQualification(ResultCommitObservation.cases.ResultCommitMissing.make({ plannedBaseSha: base }))
  ).toEqual({
    _tag: "ResultCommitRejected",
    claimPreserved: true,
    evidencePreserved: true,
    plannedBaseSha: base,
    preserveWorktree: true,
    reason: "Missing"
  })
  expect(
    decideResultCommitQualification(
      ResultCommitObservation.cases.ResultCommitPresent.make({
        plannedBaseIsAncestorOfResultCommit: false,
        plannedBaseSha: base,
        resultCommitSha: candidate
      })
    )
  ).toEqual({
    _tag: "ResultCommitRejected",
    claimPreserved: true,
    evidencePreserved: true,
    plannedBaseSha: base,
    preserveWorktree: true,
    reason: "NonDescendant",
    resultCommitSha: candidate
  })
  expect(
    decideResultCommitQualification(
      ResultCommitObservation.cases.ResultCommitPresent.make({
        plannedBaseIsAncestorOfResultCommit: true,
        plannedBaseSha: base,
        resultCommitSha: candidate
      })
    )
  ).toEqual({ _tag: "ResultCommitEligible", plannedBaseSha: base, resultCommitSha: candidate })
})

it("selects candidate reconciliation when the target differs from the expected head", () => {
  expect(
    decideTargetPromotion({
      candidateSha: candidate,
      candidateVerifiedAgainstExpectedHead: true,
      expectedHeadSha: advanced,
      target: PromotionTargetObservation.cases.ExactTargetHead.make({ currentHeadSha: rewritten })
    })
  ).toEqual({
    _tag: "ReconcileCandidateFromCurrentTarget",
    candidateSha: candidate,
    compareAndSetAuthorized: false,
    currentHeadSha: rewritten,
    expectedHeadSha: advanced,
    overwriteAuthorized: false
  })
})

it("never authorizes overwrite from a stale or ambiguous target observation", () => {
  const stale = decideTargetPromotion({
    candidateSha: candidate,
    candidateVerifiedAgainstExpectedHead: true,
    expectedHeadSha: advanced,
    target: PromotionTargetObservation.cases.ExactTargetHead.make({ currentHeadSha: rewritten })
  })
  const ambiguous = decideTargetPromotion({
    candidateSha: candidate,
    candidateVerifiedAgainstExpectedHead: true,
    expectedHeadSha: advanced,
    target: PromotionTargetObservation.cases.AmbiguousTargetHead.make({})
  })
  const exact = decideTargetPromotion({
    candidateSha: candidate,
    candidateVerifiedAgainstExpectedHead: true,
    expectedHeadSha: advanced,
    target: PromotionTargetObservation.cases.ExactTargetHead.make({ currentHeadSha: advanced })
  })
  const unverified = decideTargetPromotion({
    candidateSha: candidate,
    candidateVerifiedAgainstExpectedHead: false,
    expectedHeadSha: advanced,
    target: PromotionTargetObservation.cases.ExactTargetHead.make({ currentHeadSha: advanced })
  })

  expect(stale._tag).toBe("ReconcileCandidateFromCurrentTarget")
  expect(ambiguous._tag).toBe("RereadTargetBeforePromotion")
  expect(exact).toEqual({
    _tag: "PromoteByExactCompareAndSet",
    candidateSha: candidate,
    compareAndSetAuthorized: true,
    expectedHeadSha: advanced,
    overwriteAuthorized: false
  })
  expect(unverified).toEqual({
    _tag: "RejectUnverifiedCandidate",
    candidateSha: candidate,
    compareAndSetAuthorized: false,
    expectedHeadSha: advanced,
    overwriteAuthorized: false
  })
  expect(JSON.stringify([stale, ambiguous, exact, unverified])).not.toContain("ForceUpdate")
})
