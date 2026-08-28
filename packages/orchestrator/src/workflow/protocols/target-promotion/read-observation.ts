import type {
  TargetPromotionCompareAndSetResult,
  TargetPromotionGitReadObservation,
  TargetPromotionGitRequest
} from "./events.js"
import { TargetPromotionSuccessObservation } from "./events.js"

export const successObservationForCompareAndSet = (
  result: Extract<TargetPromotionCompareAndSetResult, { readonly _tag: "Applied" }>
): TargetPromotionSuccessObservation =>
  TargetPromotionSuccessObservation.cases.CompareAndSetApplied.make({
    candidateAncestry: "Current",
    targetHeadSha: result.newHeadSha
  })

export const successObservationForRead = (
  observation: TargetPromotionGitReadObservation
): TargetPromotionSuccessObservation | undefined => {
  if (observation._tag === "CandidateCurrent") {
    return TargetPromotionSuccessObservation.cases.ReconciledCandidateCurrent.make({
      candidateAncestry: "Current",
      targetHeadSha: observation.currentHeadSha
    })
  }
  if (observation._tag === "CandidateAncestor") {
    return TargetPromotionSuccessObservation.cases.ReconciledCandidateAncestor.make({
      candidateAncestry: "Ancestor",
      targetHeadSha: observation.currentHeadSha
    })
  }
  return undefined
}

export const readObservationContradiction = (
  request: TargetPromotionGitRequest,
  observation: TargetPromotionGitReadObservation
): string | undefined => {
  if (observation._tag === "CandidateCurrent" && observation.currentHeadSha !== request.candidateCommit)
    return "Git classified a non-candidate head as the candidate current head"
  if (observation._tag !== "CandidateCurrent" && observation.currentHeadSha === request.candidateCommit)
    return "Git classified the exact candidate current head as not current"
  if (observation._tag === "CandidateAncestor" && observation.currentHeadSha === request.expectedTargetHead)
    return "Git classified the candidate as an ancestor of its own expected first parent"
  return undefined
}
